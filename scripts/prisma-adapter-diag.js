const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.TEST_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 15000,
});
const adapter = new PrismaPg(pool);
const p = new PrismaClient({ adapter });

(async () => {
  let ok = 0, fail = 0;
  for (let i = 1; i <= 15; i++) {
    try {
      await p.$queryRaw`select 1 as x`;
      ok++;
    } catch (e) {
      fail++;
      console.log(`  #${i} FAIL ${String(e.message).split("\n").filter(Boolean).pop()}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`итог: ok=${ok} fail=${fail}`);
  await p.$disconnect();
  await pool.end();
})();
