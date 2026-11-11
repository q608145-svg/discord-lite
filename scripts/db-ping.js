const { PrismaClient } = require("@prisma/client");
const url = process.env.TEST_URL;
(async () => {
  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    const r = await p.$queryRaw`select 1 as ok`;
    console.log("OK:", JSON.stringify(r));
  } catch (e) {
    console.log("ERR:", (e.message || String(e)).slice(0, 400));
  } finally {
    await p.$disconnect().catch(() => {});
  }
})();
