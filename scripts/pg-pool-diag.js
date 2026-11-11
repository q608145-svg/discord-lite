const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.TEST_URL, ssl: { rejectUnauthorized: false }, max: 5 });

(async () => {
  let ok = 0, fail = 0;
  pool.on("error", (e) => console.log("  pool error:", e.message));
  pool.on("remove", () => console.log("  client removed"));
  for (let i = 1; i <= 15; i++) {
    try {
      const r = await pool.query("select 1 as x");
      ok++;
      if (i <= 3 || i % 5 === 0) console.log(`  #${i} ok (total ${pool.totalCount}, idle ${pool.idleCount})`);
    } catch (e) {
      fail++;
      console.log(`  #${i} FAIL ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`итог: ok=${ok} fail=${fail}`);
  await pool.end();
})();
