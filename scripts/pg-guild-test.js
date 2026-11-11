const { PrismaClient } = require("@prisma/client");
const url = process.env.TEST_URL;
const withClient = async (fn) => { const p = new PrismaClient({ datasources: { db: { url } } }); try { return await fn(p); } finally { await p.$disconnect().catch(()=>{}); } };
(async () => {
  const u = await withClient(p => p.user.create({ data: { username: "t" + Date.now(), displayName: "T", passwordHash: "x" } }));
  console.log("user ok");
  try {
    const g = await withClient(p => p.guild.create({ data: { name: "simple", ownerId: u.id } }));
    console.log("guild без вложений ok", g.id);
    await withClient(p => p.guild.delete({ where: { id: g.id } }));
  } catch (e) { console.log("guild без вложений FAIL:", String(e.message).split("\n").filter(Boolean).pop()); }
  try {
    const g2 = await withClient(p => p.guild.create({ data: { name: "nested", ownerId: u.id, channels: { create: [{ name: "c1", type: "text" }] } }, include: { channels: true } }));
    console.log("guild с вложением ok", g2.channels.length);
    await withClient(p => p.guild.delete({ where: { id: g2.id } }));
  } catch (e) { console.log("guild с вложением FAIL:", String(e.message).split("\n").filter(Boolean).pop()); }
  await withClient(p => p.user.delete({ where: { id: u.id } }));
})();
