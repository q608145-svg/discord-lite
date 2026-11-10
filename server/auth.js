"use strict";

const crypto = require("node:crypto");
const { SignJWT, jwtVerify } = require("jose");
const { prisma } = require("./db");
const { trace } = require("./debug");

const COOKIE_NAME = "dl_session";
const SESSION_DAYS = 30;

function secretKey() {
  return new TextEncoder().encode(
    process.env.JWT_SECRET || "dev-only-insecure-secret-change-me"
  );
}

async function signSessionJwt(sessionId) {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Создаёт сессию в БД и возвращает JWT для cookie. */
async function createSession(userId) {
  const raw = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const session = await prisma.session.create({
    data: { token: sha256(raw), userId, expiresAt },
  });
  // Внутри jwt лежит id сессии — так достаточно одной проверки по БД.
  return signSessionJwt(session.id);
}

function parseCookies(header = "") {
  const out = {};
  for (const part of String(header).split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function readTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const auth = req.headers.authorization || "";
  if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME];
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

/** Возвращает { id, username, displayName, avatarColor } или null. */
async function getUserFromRequest(req) {
  const token = readTokenFromRequest(req);
  trace(`cookie=${JSON.stringify(req.headers.cookie || null)} hasToken=${!!token}`);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sid) return null;

    const sid = String(payload.sid);
    let session = null;
    try {
      session = await prisma.session.findUnique({
        where: { id: sid },
        include: { user: true },
      });
    } catch (err) {
      trace(`db-error sid=${sid} err=${err instanceof Error ? err.message : err}`);
      return null;
    }

    if (!session || !session.user) {
      trace(`no-session sid=${sid}`);
      return null;
    }

    const expiresAt = new Date(session.expiresAt);
    if (expiresAt.getTime() < Date.now()) {
      trace(`expired sid=${sid}`);
      return null;
    }

    return {
      id: session.user.id,
      username: session.user.username,
      displayName: session.user.displayName,
      avatarColor: session.user.avatarColor,
    };
  } catch (err) {
    trace(`jwt-error err=${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function getUserFromSocketCookie(cookieHeader) {
  return getUserFromRequest({ headers: { cookie: cookieHeader || "" } });
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // Secure нужен только под HTTPS; на http://localhost cookie должна дойти.
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

module.exports = {
  COOKIE_NAME,
  createSession,
  getUserFromRequest,
  getUserFromSocketCookie,
  sessionCookieOptions,
};
