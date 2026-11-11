"use strict";

// Локальный HTTP-клиент с cookie-jar для проверок: сохраняет dl_session,
// игнорируя атрибут Secure (в проверках используется http://localhost).

const http = require("node:http");
const https = require("node:https");

class Client {
  constructor(base) {
    this.base = base.replace(/\/$/, "");
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  request(method, path, body) {
    const url = new URL(this.base + path);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    const headers = { accept: "application/json" };
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(payload.length);
    }
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;

    const transport = url.protocol === "https:" ? https : http;

    return new Promise((resolve, reject) => {
      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || undefined,
          path: url.pathname + url.search,
          method,
          headers,
        },
        (res) => {
          const setCookies = res.headers["set-cookie"] || [];
          for (const raw of setCookies) {
            const [pair, ...attrs] = raw.split(";");
            const eq = pair.indexOf("=");
            const name = pair.slice(0, eq).trim();
            const value = pair.slice(eq + 1).trim();
            const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
            if (expired) this.cookies.delete(name);
            else this.cookies.set(name, value);
          }
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let json = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              json = text;
            }
            resolve({ status: res.statusCode, body: json, raw: text });
          });
        }
      );
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  get(path) {
    return this.request("GET", path);
  }

  post(path, body) {
    return this.request("POST", path, body ?? {});
  }

  // socket.io: Cookie-заголовок для рукопожатия
  header() {
    return this.cookieHeader();
  }
}

module.exports = { Client };
