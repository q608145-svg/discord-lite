"use strict";

const { AccessToken } = require("livekit-server-sdk");

function isLiveKitConfigured() {
  return Boolean(
    process.env.LIVEKIT_URL &&
      process.env.LIVEKIT_API_KEY &&
      process.env.LIVEKIT_API_SECRET
  );
}

async function createLiveKitToken({ channelId, user }) {
  if (!isLiveKitConfigured()) {
    throw new Error(
      "LiveKit не настроен: заполните LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET в .env"
    );
  }

  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    {
      identity: user.id,
      name: user.displayName,
      ttl: "4h",
      metadata: JSON.stringify({
        username: user.username,
        avatarColor: user.avatarColor,
      }),
    }
  );

  at.addGrant({
    roomJoin: true,
    room: channelId,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return at.toJwt();
}

module.exports = { createLiveKitToken, isLiveKitConfigured };
