"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { formatTime, type Message } from "@/lib/types";

export default function ChatView({
  channelId,
  channelName,
  onOpenSidebar,
}: {
  channelId: string;
  channelName: string;
  onOpenSidebar: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/channels/${channelId}/messages`, { credentials: "same-origin" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Не удалось загрузить сообщения");
        if (!cancelled) setMessages(data.messages || []);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    taRef.current?.focus();
  }, [channelId]);

  function append(msg: Message) {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
  }

  useEffect(() => {
    // socket сообщения приходят из App через CustomEvent — просто перерисовка.
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message: Message }>).detail;
      if (detail?.message.channelId === channelId) append(detail.message);
    };
    window.addEventListener("dl:new-message", handler as EventListener);
    return () => window.removeEventListener("dl:new-message", handler as EventListener);
  }, [channelId]);

  async function send() {
    const content = text.trim();
    if (!content) return;
    setText("");
    const { getSocket } = await import("@/lib/socket");
    const socket = getSocket();
    socket.emit("send-message", { channelId, content }, (res?: { error?: string }) => {
      if (res?.error) setError(res.error);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="chat">
      <div className="chat-header">
        <button className="icon-btn mobile-only" onClick={onOpenSidebar} title="Каналы">
          ☰
        </button>
        <span className="hash">#</span>
        {channelName}
      </div>

      <div className="messages" ref={listRef}>
        {loading ? (
          <div className="empty-chat">Загрузка…</div>
        ) : messages.length === 0 ? (
          <div className="empty-chat">
            <div className="big">👋</div>
            <div>
              Здесь пока пусто. Напиши первое сообщение в{" "}
              <b>#&nbsp;{channelName}</b>
            </div>
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const grouped =
              prev &&
              prev.author.id === m.author.id &&
              new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() <
                5 * 60 * 1000;
            return (
              <div key={m.id} className={`message ${grouped ? "grouped" : ""}`}>
                {grouped ? (
                  <div className="gutter-time">{formatTime(m.createdAt)}</div>
                ) : (
                  <Avatar name={m.author.displayName} color={m.author.avatarColor} size={40} />
                )}
                <div className="body">
                  {grouped ? null : (
                    <div className="head">
                      <span className="author">{m.author.displayName}</span>
                      <span className="time">{formatTime(m.createdAt)}</span>
                    </div>
                  )}
                  <div className="text">{m.content}</div>
                </div>
              </div>
            );
          })
        )}
        {error ? <div className="error">{error}</div> : null}
      </div>

      <div className="chat-input">
        <div className="box">
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            placeholder={`Написать в #${channelName}`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button className="send" onClick={send} disabled={!text.trim()} title="Отправить">
            ➤
          </button>
        </div>
        <div className="hint">Enter — отправить · Shift+Enter — новая строка</div>
      </div>
    </div>
  );
}
