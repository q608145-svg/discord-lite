const { Client } = require("pg");
(async () => {
  const c = new Client({ connectionString: process.env.TEST_URL, ssl: { rejectUnauthorized: false } });
  const t0 = Date.now();
  const ts = () => ((Date.now() - t0) / 1000).toFixed(2) + "s";
  c.on("error", (e) => console.log(`  [${ts()}] client error: ${e.message}`));
  c.on("end", () => console.log(`  [${ts()}] client end`));
  await c.connect();
  console.log(`  [${ts()}] connected`);
  for (let i = 1; i <= 10; i++) {
    try {
      await c.query("select 1 as x");
      console.log(`  [${ts()}] #${i} ok`);
    } catch (e) {
      console.log(`  [${ts()}] #${i} FAIL ${e.message}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  await c.end().catch(() => {});
})();
