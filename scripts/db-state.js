const { PrismaClient } = require("@prisma/client");
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.TEST_URL } } });
  const q = (s) => p.$queryRawUnsafe(s);
  try {
    const idx = await q("select indexname from pg_indexes where schemaname='public' order by indexname");
    const fk = await q("select conname from pg_constraint where contype='f' and connamespace='public'::regnamespace order by conname");
    console.log("indexes:", idx.map(r=>r.indexname).join(", "));
    console.log("fks:", fk.map(r=>r.conname).join(", "));
  } catch (e) { console.log("ERR", e.message.slice(0,200)); }
  finally { await p.$disconnect().catch(()=>{}); }
})();
