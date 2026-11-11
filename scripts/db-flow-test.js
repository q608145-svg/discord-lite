"use strict";

// Проверка реальных операций приложения на боевой базе (Neon).
// Клиент создаётся на каждую операцию: в песочнице разработки долгоживущие
// TCP-соединения обрываются сетевым окружением, на хостинге такого нет.
// Запуск: DATABASE_URL=... node scripts/db-flow-test.js

const { PrismaClient } = require("@prisma/client");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("нужен DATABASE_URL");
  process.exit(1);
}

const withClient = async (fn) => {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
};

const suffix = Math.random().toString(36).slice(2, 7);
let failed = 0;

function check(name, ok, extra = "") {
  if (ok) console.log("  ✓", name);
  else {
    failed++;
    console.log("  ✗", name, extra);
  }
}

(async () => {
  console.log("Проверка операций на PostgreSQL:");

  const user = await withClient((p) =>
    p.user.create({
      data: {
        username: "dbtest_" + suffix,
        displayName: "DB Test",
        passwordHash: "x",
        avatarColor: "#5865F2",
      },
    })
  );
  check("user.create", !!user.id);

  const session = await withClient((p) =>
    p.session.create({
      data: {
        token: "token_" + suffix,
        userId: user.id,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
  );
  check("session.create", !!session.id);

  const found = await withClient((p) =>
    p.session.findUnique({ where: { id: session.id }, include: { user: true } })
  );
  check("session.findUnique + include user", !!found && found.user.username === user.username);

  // Так же, как в API: последовательные запросы вместо вложенной записи.
  const guild = await withClient((p) =>
    p.guild.create({ data: { name: "DB Test " + suffix, ownerId: user.id } })
  );
  check("guild.create", !!guild.id);

  await withClient((p) => p.member.create({ data: { userId: user.id, guildId: guild.id } }));
  await withClient((p) =>
    p.channel.createMany({
      data: [
        { guildId: guild.id, name: "общий", type: "text", position: 0 },
        { guildId: guild.id, name: "голос", type: "voice", position: 1 },
      ],
    })
  );
  const channels = await withClient((p) =>
    p.channel.findMany({ where: { guildId: guild.id }, orderBy: { position: "asc" } })
  );
  check("участник и два канала созданы", channels.length === 2);

  const members = await withClient((p) => p.member.findMany({ where: { userId: user.id } }));
  check("member.findMany", members.length === 1 && members[0].guildId === guild.id);

  const textChannel = channels.find((c) => c.type === "text");
  const message = await withClient((p) =>
    p.message.create({
      data: { channelId: textChannel.id, authorId: user.id, content: "тест" },
    })
  );
  check("message.create", !!message.id);

  const history = await withClient((p) =>
    p.message.findMany({
      where: { channelId: textChannel.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { author: { select: { id: true, displayName: true } } },
    })
  );
  check("message.findMany (история)", history.length >= 1 && !!history[0].author.displayName);

  // Чистим за собой
  await withClient((p) => p.guild.delete({ where: { id: guild.id } }));
  await withClient((p) => p.user.delete({ where: { id: user.id } }));
  const gone = await withClient((p) => p.user.findUnique({ where: { id: user.id } }));
  check("каскадное удаление", gone === null);

  console.log(failed ? `\nПровалено: ${failed}` : "\nБаза работает: все операции приложения проходят.");
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error("Ошибка:", err.message);
  process.exit(1);
});
