/**
 * 诊断脚本：检查 2026-02 销售数据差异
 * 1. 检查 JOIN 是否产生重复行（导致金额膨胀）
 * 2. 对比加/不加 JOIN 的销售总额
 * 3. 拆解 净销售额 = 销售额 - 退货额
 */
const fs = require('fs'), sf = require('snowflake-sdk');
fs.readFileSync('.env.local', 'utf8').split('\n').forEach(l => {
  const [k, ...v] = l.trim().split('=');
  if (k && !k.startsWith('#')) process.env[k] = v.join('=');
});
const conn = sf.createConnection({
  account: process.env.SNOWFLAKE_ACCOUNT, username: process.env.SNOWFLAKE_USER,
  password: process.env.SNOWFLAKE_PASSWORD, warehouse: process.env.SNOWFLAKE_WAREHOUSE,
  database: process.env.SNOWFLAKE_DATABASE, schema: 'CHN', role: process.env.SNOWFLAKE_ROLE,
});

const q = (sql) => new Promise((res, rej) =>
  conn.execute({ sqlText: sql, complete: (e, _s, rows) => e ? rej(e) : res(rows) })
);

conn.connect(async err => {
  if (err) { console.error(err.message); process.exit(1); }
  console.log('✓ 连接成功\n');

  // 1. 不加 JOIN — 直接从 DW_SALE 统计
  const [r1] = await q(`
    SELECT
      COUNT(*)                                                    AS total_rows,
      COUNT(DISTINCT REG_NO)                                      AS orders,
      SUM(CASE WHEN QTY>0 THEN SALE_AMT ELSE 0 END)              AS sale_amt,
      SUM(CASE WHEN QTY<0 THEN ABS(SALE_AMT) ELSE 0 END)         AS return_amt,
      SUM(CASE WHEN QTY>0 THEN SALE_AMT ELSE 0 END)
        - SUM(CASE WHEN QTY<0 THEN ABS(SALE_AMT) ELSE 0 END)     AS net_amt
    FROM FNF.CHN.DW_SALE
    WHERE SALE_DT BETWEEN '2026-02-01' AND '2026-02-28'
  `);
  console.log('【无过滤 DW_SALE 全量 2026-02】');
  console.log(`  行数: ${r1.TOTAL_ROWS}  订单: ${r1.ORDERS}`);
  console.log(`  销售额: ¥${Math.round(r1.SALE_AMT/1e4)}万  退货额: ¥${Math.round(r1.RETURN_AMT/1e4)}万  净额: ¥${Math.round(r1.NET_AMT/1e4)}万\n`);

  // 2. 加 JOIN + ANLYS_AREA_NM 过滤 — 检查是否有重复
  const [r2] = await q(`
    SELECT
      COUNT(*)                                                    AS total_rows,
      COUNT(DISTINCT s.REG_NO)                                    AS orders,
      SUM(CASE WHEN s.QTY>0 THEN s.SALE_AMT ELSE 0 END)          AS sale_amt,
      SUM(CASE WHEN s.QTY<0 THEN ABS(s.SALE_AMT) ELSE 0 END)     AS return_amt,
      SUM(CASE WHEN s.QTY>0 THEN s.SALE_AMT ELSE 0 END)
        - SUM(CASE WHEN s.QTY<0 THEN ABS(s.SALE_AMT) ELSE 0 END) AS net_amt
    FROM FNF.CHN.DW_SALE s
    INNER JOIN FNF.CHN.DW_SHOP_WH_DETAIL d
      ON (s.OA_SHOP_ID = d.OA_SHOP_ID
          OR (s.OA_SHOP_ID IS NULL AND s.SHOP_ID = d.SHOP_ID)
          OR s.SHOP_ID = d.OA_SHOP_ID)
    WHERE d.ANLYS_AREA_NM = 'Online OR'
      AND s.SALE_DT BETWEEN '2026-02-01' AND '2026-02-28'
  `);
  console.log('【JOIN + Online OR 过滤 2026-02】');
  console.log(`  行数: ${r2.TOTAL_ROWS}  订单(去重): ${r2.ORDERS}`);
  console.log(`  销售额: ¥${Math.round(r2.SALE_AMT/1e4)}万  退货额: ¥${Math.round(r2.RETURN_AMT/1e4)}万  净额: ¥${Math.round(r2.NET_AMT/1e4)}万\n`);

  // 3. 检查 JOIN 是否造成重复（同一 REG_NO 匹配多条 DW_SHOP_WH_DETAIL）
  const dup = await q(`
    SELECT s.REG_NO, COUNT(*) AS match_cnt
    FROM FNF.CHN.DW_SALE s
    INNER JOIN FNF.CHN.DW_SHOP_WH_DETAIL d
      ON (s.OA_SHOP_ID = d.OA_SHOP_ID
          OR (s.OA_SHOP_ID IS NULL AND s.SHOP_ID = d.SHOP_ID)
          OR s.SHOP_ID = d.OA_SHOP_ID)
    WHERE d.ANLYS_AREA_NM = 'Online OR'
      AND s.SALE_DT BETWEEN '2026-02-01' AND '2026-02-28'
    GROUP BY s.REG_NO
    HAVING COUNT(*) > 1
    LIMIT 5
  `);
  console.log(`【重复 JOIN 检测】 重复 REG_NO 数量: ${dup.length} 条（展示最多5条）`);
  if (dup.length) dup.forEach(r => console.log(`  REG_NO=${r.REG_NO}  匹配次数=${r.MATCH_CNT}`));

  // 4. 用 DISTINCT/QUALIFY 去重后的净额
  const [r4] = await q(`
    WITH dedup AS (
      SELECT s.*,
             d.BRD_CD, d.WH_NM_CN,
             ROW_NUMBER() OVER (PARTITION BY s.REG_NO, s.ITEM_CD ORDER BY d.OA_SHOP_ID NULLS LAST) AS rn
      FROM FNF.CHN.DW_SALE s
      INNER JOIN FNF.CHN.DW_SHOP_WH_DETAIL d
        ON (s.OA_SHOP_ID = d.OA_SHOP_ID
            OR (s.OA_SHOP_ID IS NULL AND s.SHOP_ID = d.SHOP_ID)
            OR s.SHOP_ID = d.OA_SHOP_ID)
      WHERE d.ANLYS_AREA_NM = 'Online OR'
        AND s.SALE_DT BETWEEN '2026-02-01' AND '2026-02-28'
    )
    SELECT
      COUNT(*)                                                    AS total_rows,
      SUM(CASE WHEN QTY>0 THEN SALE_AMT ELSE 0 END)              AS sale_amt,
      SUM(CASE WHEN QTY<0 THEN ABS(SALE_AMT) ELSE 0 END)         AS return_amt,
      SUM(CASE WHEN QTY>0 THEN SALE_AMT ELSE 0 END)
        - SUM(CASE WHEN QTY<0 THEN ABS(SALE_AMT) ELSE 0 END)     AS net_amt
    FROM dedup WHERE rn = 1
  `);
  console.log('\n【JOIN 去重后（ROW_NUMBER rn=1）2026-02】');
  console.log(`  行数: ${r4.TOTAL_ROWS}`);
  console.log(`  销售额: ¥${Math.round(r4.SALE_AMT/1e4)}万  退货额: ¥${Math.round(r4.RETURN_AMT/1e4)}万  净额: ¥${Math.round(r4.NET_AMT/1e4)}万`);

  conn.destroy(() => process.exit(0));
});
