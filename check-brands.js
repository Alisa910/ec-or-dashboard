/**
 * check-brands.js — 查询 Snowflake 中实际的 BRD_CD 和 ANLYS_AREA_NM 值
 * 运行：node check-brands.js
 */
const fs = require('fs');
const path = require('path');
const snowflake = require('snowflake-sdk');

// 加载 .env.local
const envPath = path.join(__dirname, '.env.local');
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const [k, ...v] = line.trim().split('=');
  if (k && !k.startsWith('#')) process.env[k] = v.join('=');
});

const conn = snowflake.createConnection({
  account:   process.env.SNOWFLAKE_ACCOUNT,
  username:  process.env.SNOWFLAKE_USER,
  password:  process.env.SNOWFLAKE_PASSWORD,
  warehouse: process.env.SNOWFLAKE_WAREHOUSE,
  database:  process.env.SNOWFLAKE_DATABASE,
  schema:    'CHN',
  role:      process.env.SNOWFLAKE_ROLE,
});

conn.connect(err => {
  if (err) { console.error('连接失败:', err); process.exit(1); }
  console.log('✓ Snowflake 连接成功\n');

  // 1. 查询品牌代码
  conn.execute({
    sqlText: `
      SELECT DISTINCT d.BRD_CD, COUNT(*) AS cnt
      FROM FNF.CHN.DW_SHOP_WH_DETAIL d
      WHERE d.ANLYS_AREA_NM = 'Online OR'
      GROUP BY d.BRD_CD
      ORDER BY cnt DESC
    `,
    complete: (e, _s, rows) => {
      if (e) { console.error('品牌查询失败:', e); }
      else {
        console.log('=== 实际 BRD_CD 值 ===');
        rows.forEach(r => console.log(`  ${r.BRD_CD}  (${r.CNT} 条)`));
      }

      // 2. 查询部分店铺名称和对应品牌
      conn.execute({
        sqlText: `
          SELECT DISTINCT d.BRD_CD, d.WH_NM_CN
          FROM FNF.CHN.DW_SHOP_WH_DETAIL d
          WHERE d.ANLYS_AREA_NM = 'Online OR'
          ORDER BY d.BRD_CD, d.WH_NM_CN
          LIMIT 30
        `,
        complete: (e2, _s2, rows2) => {
          if (e2) { console.error('店铺查询失败:', e2); }
          else {
            console.log('\n=== 品牌 → 店铺名称 ===');
            rows2.forEach(r => console.log(`  [${r.BRD_CD}]  ${r.WH_NM_CN}`));
          }
          conn.destroy(() => process.exit(0));
        }
      });
    }
  });
});
