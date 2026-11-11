const { PrismaClient } = require("@prisma/client");
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.TEST_URL } } });
  let ok = 0, fail = 0;
  for (let i = 1; i <= 12; i++) {
    try {
      await p.$queryRaw`select 1 as x`;
      ok++;
      if (i <= 3 || i === 12) console.log(`  #${i} ok`);
    } catch (e) {
      fail++;
      console.log(`  #${i} FAIL ${String(e.message).split("\n").filter(Boolean).pop()}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`итог: ok=${ok} fail=${fail}`);
  await p.$disconnect();
})();
