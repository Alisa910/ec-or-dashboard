const fs=require('fs'),sf=require('snowflake-sdk');
fs.readFileSync('.env.local','utf8').split('\n').forEach(l=>{const[k,...v]=l.trim().split('=');if(k&&!k.startsWith('#'))process.env[k]=v.join('=')});
const conn=sf.createConnection({account:process.env.SNOWFLAKE_ACCOUNT,username:process.env.SNOWFLAKE_USER,password:process.env.SNOWFLAKE_PASSWORD,warehouse:process.env.SNOWFLAKE_WAREHOUSE,database:process.env.SNOWFLAKE_DATABASE,schema:'CHN',role:process.env.SNOWFLAKE_ROLE});
conn.connect(err=>{
  if(err){console.error('连接失败:',err.message);process.exit(1);}
  console.log('连接成功');
  conn.execute({
    sqlText:`SELECT CONCAT(YEAR(s.SALE_DT),'-',LPAD(MONTH(s.SALE_DT),2,'0')) AS MO,
             COUNT(*) AS CNT,
             SUM(CASE WHEN s.QTY>0 THEN s.SALE_AMT ELSE 0 END) AS SALE
             FROM FNF.CHN.DW_SALE s
             INNER JOIN FNF.CHN.DW_SHOP_WH_DETAIL d
               ON (s.OA_SHOP_ID=d.OA_SHOP_ID OR (s.OA_SHOP_ID IS NULL AND s.SHOP_ID=d.SHOP_ID) OR s.SHOP_ID=d.OA_SHOP_ID)
             WHERE d.ANLYS_AREA_NM='Online OR'
               AND YEAR(s.SALE_DT) IN (2024,2025,2026)
             GROUP BY 1 ORDER BY 1`,
    complete:(_e,_s,rows)=>{
      if(_e){console.error('查询失败:',_e.message);conn.destroy(()=>process.exit(1));return;}
      console.log('\n月份        行数       销售额(万)');
      rows.forEach(r=>console.log(r.MO+'  '+String(r.CNT).padStart(6)+'  ¥'+Math.round(r.SALE/1e4).toLocaleString()+'万'));
      conn.destroy(()=>process.exit(0));
    }
  });
});
