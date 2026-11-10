"use strict";

// Логика окна первого запуска: проверка адреса и сохранение настройки.

const input = document.getElementById("server");
const statusEl = document.getElementById("status");
const checkBtn = document.getElementById("check");
const saveBtn = document.getElementById("save");

function setStatus(text, kind) {
  statusEl.textContent = text || "";
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function normalize(value) {
  let v = String(value || "").trim();
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) v = "http://" + v;
  try {
    const url = new URL(v);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

async function init() {
  try {
    const info = await window.desktop.getInfo();
    if (info && info.serverUrl) input.value = info.serverUrl;
    else input.value = "http://localhost:3000";
  } catch {
    input.value = "http://localhost:3000";
  }
  input.focus();
  input.select();
}

async function check() {
  const url = normalize(input.value);
  if (!url) {
    setStatus("Похоже, это не адрес. Пример: http://localhost:3000", "err");
    return false;
  }
  input.value = url;
  setStatus("Проверяем сервер…");
  checkBtn.disabled = true;
  try {
    const result = await window.desktop.checkServer(url);
    if (!result.ok) {
      setStatus(`Не удалось подключиться: ${result.error}`, "err");
      return false;
    }
    setStatus(
      result.livekit
        ? "Сервер отвечает, голос настроен ✓"
        : "Сервер отвечает, но LiveKit не настроен — звонки не заработают",
      result.livekit ? "ok" : "err"
    );
    return true;
  } finally {
    checkBtn.disabled = false;
  }
}

async function save() {
  const url = normalize(input.value);
  if (!url) {
    setStatus("Введите адрес сервера", "err");
    return;
  }
  input.value = url;
  saveBtn.disabled = true;
  setStatus("Подключаемся…");
  const result = await window.desktop.saveServer(url);
  if (!result || !result.ok) {
    saveBtn.disabled = false;
    setStatus(result && result.error ? result.error : "Не удалось сохранить адрес", "err");
  }
}

checkBtn.addEventListener("click", check);
saveBtn.addEventListener("click", save);

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    save();
  }
});

init();
