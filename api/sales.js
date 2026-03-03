/**
 * api/sales.js  —  Vercel Serverless Function
 * 连接 Snowflake，查询 EC OR 销售退货数据，转换为 Dashboard 所需格式
 *
 * GET /api/sales?year=2026
 * Response: { sales: {...}, rr: {...} }
 */

const snowflake = require('snowflake-sdk');

/* ── 渠道推断（与前端 chOf() 保持一致） ── */
function chOf(shopName) {
  if (!shopName) return 'OTHER';
  if (shopName.includes('唯品会')) return 'VIP';
  if (shopName.includes('天猫'))   return 'TM';
  if (shopName.includes('抖音'))   return 'DOUYIN';
  if (shopName.includes('微商城')) return 'WeChat';
  if (shopName.includes('京东'))   return 'JD';
  if (shopName.includes('奥莱') || shopName.includes('淘宝奥莱')) return 'OUTLETS';
  return 'OTHER';
}

// Snowflake BRD_CD → 前端显示名映射
// I=MLB Kids(MK), M=MLB(ML/MM), V=DISCOVERY V(DV), X=DISCOVERY X(DX)
// W=SP 不纳入品牌维度展示
const BRD_MAP = { I: 'MLBKIDS', M: 'MLB', V: 'DISCOVERY', X: 'DISCOVERY' };
const BR = ['MLBKIDS', 'MLB', 'DISCOVERY'];
const CH = ['VIP', 'TM', 'DOUYIN', 'WeChat', 'JD', 'OUTLETS'];

// 有效店铺前缀（过滤掉大仓/暂存仓等仓储记录）
const SHOP_PREFIXES = ['MK ', 'ML ', 'MM ', 'DV ', 'DX ', 'SP '];
function isRealShop(name) {
  if (!name) return false;
  return SHOP_PREFIXES.some(p => name.startsWith(p));
}

/* ── Snowflake 连接（Promise 包装） ── */
function createConnection() {
  return snowflake.createConnection({
    account:   process.env.SNOWFLAKE_ACCOUNT,
    username:  process.env.SNOWFLAKE_USER,
    password:  process.env.SNOWFLAKE_PASSWORD,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database:  process.env.SNOWFLAKE_DATABASE,   // FNF
    schema:    'CHN',                             // FNF.CHN.*
    role:      process.env.SNOWFLAKE_ROLE,
  });
}

function connectAsync(conn) {
  return new Promise((resolve, reject) =>
    conn.connect(err => (err ? reject(err) : resolve(conn)))
  );
}

function queryAsync(conn, sqlText, binds = []) {
  return new Promise((resolve, reject) =>
    conn.execute({
      sqlText,
      binds,
      complete: (err, _stmt, rows) => (err ? reject(err) : resolve(rows)),
    })
  );
}

function destroyAsync(conn) {
  return new Promise(resolve => conn.destroy(() => resolve()));
}

/* ── SQL：查询指定年份范围内的月度店铺数据（原始数字）── */
const SQL = `
  WITH raw AS (
    SELECT
      CONCAT(YEAR(s.SALE_DT), '-', LPAD(MONTH(s.SALE_DT), 2, '0')) AS sale_month,
      d.BRD_CD,
      d.WH_NM_CN                                              AS shop_name_cn,
      SUM(CASE WHEN s.QTY > 0 THEN s.SALE_AMT  ELSE 0 END)   AS sale_amt,
      SUM(CASE WHEN s.QTY > 0 THEN s.TAG_AMT   ELSE 0 END)   AS sale_tag_amt,
      SUM(CASE WHEN s.QTY < 0 THEN ABS(s.SALE_AMT) ELSE 0 END) AS return_amt,
      SUM(CASE WHEN s.QTY < 0 THEN ABS(s.TAG_AMT)  ELSE 0 END) AS return_tag_amt
    FROM FNF.CHN.DW_SALE s
    INNER JOIN FNF.CHN.DW_SHOP_WH_DETAIL d
      ON (
        s.OA_SHOP_ID = d.OA_SHOP_ID
        OR (s.OA_SHOP_ID IS NULL AND s.SHOP_ID = d.SHOP_ID)
        OR s.SHOP_ID = d.OA_SHOP_ID
      )
    WHERE
      d.ANLYS_AREA_NM = 'Online OR'
      AND YEAR(s.SALE_DT) IN (?, ?, ?)
    GROUP BY 1, 2, 3
  )
  SELECT * FROM raw
  ORDER BY sale_month, BRD_CD, shop_name_cn
`;

/* ── 数据转换：行数据 → Dashboard 所需格式 ── */
function transformRows(rows) {
  // 按月分组
  const byMonth = {};
  for (const row of rows) {
    const mo = row.SALE_MONTH;
    if (!byMonth[mo]) byMonth[mo] = [];
    byMonth[mo].push(row);
  }

  const sales = {};
  const rr    = {};

  for (const [mo, monthRows] of Object.entries(byMonth)) {
    // 品牌销售额 & 退货额
    const brandSale   = Object.fromEntries(BR.map(b => [b, 0]));
    const brandReturn = Object.fromEntries(BR.map(b => [b, 0]));
    // 渠道销售额 & 退货额
    const chSale   = Object.fromEntries(CH.map(c => [c, 0]));
    const chReturn = Object.fromEntries(CH.map(c => [c, 0]));
    // 店铺毛销售额 & 退货额（均为正数）
    const shopGross  = {};
    const shopReturn = {};
    let totalSale = 0, totalReturn = 0;

    for (const row of monthRows) {
      const rawBrd = row.BRD_CD       || '';
      const brand  = BRD_MAP[rawBrd]  || 'OTHER';
      const shop   = row.SHOP_NAME_CN || '';
      const sale   = Number(row.SALE_AMT)   || 0;
      const ret    = Number(row.RETURN_AMT) || 0;
      const ch     = chOf(shop);

      totalSale   += sale;
      totalReturn += ret;

      if (BR.includes(brand)) {
        brandSale[brand]   += sale;
        brandReturn[brand] += ret;
      }
      if (CH.includes(ch)) {
        chSale[ch]   += sale;
        chReturn[ch] += ret;
      }

      // 只汇总真实店铺（过滤大仓/暂存仓）
      if (isRealShop(shop)) {
        shopGross[shop]  = (shopGross[shop]  || 0) + sale;
        shopReturn[shop] = (shopReturn[shop] || 0) + ret;
      }
    }

    // 净额 = 毛销售 - 退货（所有层级）
    const totalNet = totalSale - totalReturn;
    const chNet    = Object.fromEntries(CH.map(c => [c, chSale[c] - chReturn[c]]));

    // 店铺净额 & TTL
    const shopSales = {};
    for (const s of Object.keys(shopGross)) {
      shopSales[s] = (shopGross[s] || 0) - (shopReturn[s] || 0);
    }
    shopSales['TTL'] = totalNet;

    // 品牌占比（基于毛销售额，用于 Donut 图）
    const cur = Object.fromEntries(
      BR.map(b => [b, totalSale ? brandSale[b] / totalSale : 0])
    );

    // 品牌净额（= 毛销售 - 退货，供 A 列所有净额展示使用）
    const brandNet = Object.fromEntries(
      BR.map(b => [b, brandSale[b] - brandReturn[b]])
    );

    // 退货率（分母为毛销售额，行业标准：退货额 / 发货额）
    const ttlRR = totalSale ? totalReturn / totalSale : 0;
    const brandRR = {
      ...Object.fromEntries(BR.map(b => [b, brandSale[b] ? brandReturn[b] / brandSale[b] : 0])),
      TTL: ttlRR,
    };
    const channelRR = {
      ...Object.fromEntries(CH.map(c => [c, chSale[c] ? chReturn[c] / chSale[c] : 0])),
      TTL: ttlRR,
    };

    // 店铺退货率
    const storeRR = {};
    for (const s of Object.keys(shopGross)) {
      storeRR[s] = shopGross[s] ? (shopReturn[s] || 0) / shopGross[s] : 0;
    }

    // total = 净额；gross = 毛销售额（退货率加权）；brandNet = 品牌净额；chGross = 渠道毛额
    sales[mo] = { total: totalNet, gross: totalSale, cur, brandNet, chT: chNet, chGross: chSale, shopSales };
    rr[mo]    = { ttl: ttlRR, brand: brandRR, channel: channelRR, store: storeRR };
  }

  // 补充 ly（去年同月的品牌占比）
  for (const mo of Object.keys(sales)) {
    const lyMo = `${String(parseInt(mo.slice(0, 4)) - 1)}-${mo.slice(5)}`;
    sales[mo].ly = sales[lyMo]?.cur || sales[mo].cur;
  }

  // 汇总所有月份出现过的真实店铺列表（按销售额降序排列）
  const shopTotals = {};
  for (const mo of Object.values(sales)) {
    for (const [s, v] of Object.entries(mo.shopSales)) {
      if (s === 'TTL') continue;
      shopTotals[s] = (shopTotals[s] || 0) + v;
    }
  }
  const shops = Object.entries(shopTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s);

  // 汇总有效品牌列表（有销售额的品牌）
  const brandTotals = Object.fromEntries(BR.map(b => [b, 0]));
  for (const mo of Object.values(sales)) {
    for (const b of BR) {
      brandTotals[b] += (mo.brandNet?.[b] || 0);
    }
  }
  const brands = BR.filter(b => (brandTotals[b] || 0) > 0);

  return { sales, rr, shops, brands };
}

/* ── Vercel Serverless Handler ── */
module.exports = async (req, res) => {
  // CORS（Vercel 本地 dev & 浏览器直访均可用）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const year     = parseInt(req.query.year || new Date().getFullYear(), 10);
  const prevYear = year - 1;
  const prev2Year = year - 2;  // 多取一年，支持 2024 同比/YTD 计算

  let conn;
  try {
    conn = createConnection();
    await connectAsync(conn);

    const rows = await queryAsync(conn, SQL, [year, prevYear, prev2Year]);
    const data = transformRows(rows);

    // 查询 Snowflake 中该范围内的最早/最新有数据日期
    const dateRangeRows = await queryAsync(conn,
      `SELECT TO_CHAR(MIN(s.SALE_DT),'YYYY-MM-DD') AS EARLIEST_DT,
              TO_CHAR(MAX(s.SALE_DT),'YYYY-MM-DD') AS LATEST_DT
       FROM FNF.CHN.DW_SALE s
       INNER JOIN FNF.CHN.DW_SHOP_WH_DETAIL d
         ON (s.OA_SHOP_ID=d.OA_SHOP_ID
          OR (s.OA_SHOP_ID IS NULL AND s.SHOP_ID=d.SHOP_ID)
          OR s.SHOP_ID=d.OA_SHOP_ID)
       WHERE d.ANLYS_AREA_NM='Online OR'
         AND YEAR(s.SALE_DT) IN (?,?,?)`,
      [year, prevYear, prev2Year]
    );
    const latestDate   = dateRangeRows[0]?.LATEST_DT   || null;
    const earliestDate = dateRangeRows[0]?.EARLIEST_DT || null;

    res.status(200).json({ ...data, latestDate, earliestDate });
  } catch (err) {
    console.error('[api/sales] Snowflake error:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  } finally {
    if (conn) await destroyAsync(conn);
  }
};
