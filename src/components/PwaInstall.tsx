"use client";

import { useCallback, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "dl:install-dismissed";

/**
 * Регистрирует service worker и показывает кнопку «Установить приложение»,
 * когда браузер готов установить PWA.
 */
export default function PwaInstall() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("[pwa] не удалось зарегистрировать service worker:", err);
      });
    }

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setStandalone(isStandalone);

    const dismissed = window.localStorage.getItem(DISMISS_KEY) === "1";

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
      if (!dismissed && !isStandalone) setVisible(true);
    };

    const onInstalled = () => {
      setVisible(false);
      setPromptEvent(null);
      setStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!promptEvent) return;
    setInstalling(true);
    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
    } finally {
      setInstalling(false);
      setVisible(false);
      setPromptEvent(null);
    }
  }, [promptEvent]);

  const dismiss = useCallback(() => {
    setVisible(false);
    window.localStorage.setItem(DISMISS_KEY, "1");
  }, []);

  if (!visible || !promptEvent || standalone) return null;

  return (
    <div className="install-banner" role="dialog" aria-label="Установка приложения">
      <div className="install-banner__icon" aria-hidden>
        D
      </div>
      <div className="install-banner__text">
        <b>Установить discord-lite</b>
        <span>Открывается в своём окне, как обычное приложение</span>
      </div>
      <button className="install-banner__primary" onClick={install} disabled={installing}>
        {installing ? "Устанавливаем…" : "Установить"}
      </button>
      <button className="install-banner__close" onClick={dismiss} title="Позже" aria-label="Позже">
        ✕
      </button>
    </div>
  );
}
