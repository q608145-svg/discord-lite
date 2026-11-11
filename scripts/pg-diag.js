const { Client } = require("pg");
const url = process.env.TEST_URL;

(async () => {
  let ok = 0, fail = 0;
  for (let i = 1; i <= 12; i++) {
    const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    c.on("error", (e) => console.log(`  conn error: ${e.message}`));
    try {
      await c.connect();
      const r = await c.query("select now() as t");
      ok++;
      if (i <= 3 || i === 12) console.log(`  #${i} ok ${r.rows[0].t.toISOString()}`);
    } catch (e) {
      fail++;
      console.log(`  #${i} FAIL ${e.message}`);
    } finally {
      await c.end().catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`итог: ok=${ok} fail=${fail}`);
})();
