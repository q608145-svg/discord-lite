const { PrismaClient } = require("@prisma/client");
(async () => {
  let ok = 0, fail = 0;
  for (let i = 1; i <= 10; i++) {
    const p = new PrismaClient({ datasources: { db: { url: process.env.TEST_URL } } });
    try {
      await p.$queryRaw`select 1 as x`;
      ok++;
    } catch (e) {
      fail++;
      console.log(`  #${i} FAIL ${String(e.message).split("\n").filter(Boolean).pop()}`);
    } finally {
      await p.$disconnect().catch(() => {});
    }
  }
  console.log(`итог (свежий клиент на запрос): ok=${ok} fail=${fail}`);
})();
