"use strict";

// Создаёт демо-данные: двух пользователей и сервер с каналами.
// Запуск: npm run db:seed

const bcrypt = require("bcryptjs");
const { prisma } = require("./db");

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const alice = await prisma.user.upsert({
    where: { username: "alice" },
    update: {},
    create: {
      username: "alice",
      displayName: "Алиса",
      passwordHash,
      avatarColor: "#EB459E",
    },
  });

  const bob = await prisma.user.upsert({
    where: { username: "bob" },
    update: {},
    create: {
      username: "bob",
      displayName: "Боб",
      passwordHash,
      avatarColor: "#57F287",
    },
  });

  let guild = await prisma.guild.findFirst({ where: { name: "Наш сервер" } });
  if (!guild) {
    guild = await prisma.guild.create({
      data: {
        name: "Наш сервер",
        ownerId: alice.id,
        iconColor: "#5865F2",
        members: {
          create: [{ userId: alice.id }, { userId: bob.id }],
        },
        channels: {
          create: [
            { name: "общий", type: "text", position: 0 },
            { name: "мемы", type: "text", position: 1 },
            { name: "Общий голосовой", type: "voice", position: 2 },
            { name: "Игры", type: "voice", position: 3 },
          ],
        },
      },
    });
  }

  const general = await prisma.channel.findFirst({
    where: { guildId: guild.id, name: "общий" },
  });

  if (general) {
    const count = await prisma.message.count({ where: { channelId: general.id } });
    if (count === 0) {
      await prisma.message.createMany({
        data: [
          {
            channelId: general.id,
            authorId: alice.id,
            content: "Привет! Это наш собственный Discord 🙂",
          },
          {
            channelId: general.id,
            authorId: bob.id,
            content: "Заходи в голосовой, проверим качество связи",
          },
        ],
      });
    }
  }

  console.log("Демо-данные готовы.");
  console.log("  alice / password123");
  console.log("  bob   / password123");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
