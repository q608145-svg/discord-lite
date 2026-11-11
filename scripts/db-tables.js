const { PrismaClient } = require("@prisma/client");
const url = process.env.TEST_URL;
(async () => {
  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await p.$queryRawUnsafe(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name"
    );
    console.log("tables:", rows.map((r) => r.table_name).join(", ") || "(нет)");
  } catch (e) {
    console.log("ERR:", (e.message || String(e)).slice(0, 300));
  } finally {
    await p.$disconnect().catch(() => {});
  }
})();
