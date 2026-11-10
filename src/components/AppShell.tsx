"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import ChatView from "@/components/ChatView";
import VoiceStage from "@/components/VoiceStage";
import { api } from "@/lib/api";
import { disconnectSocket, getSocket } from "@/lib/socket";
import type { Channel, Guild, Message, User, VoiceParticipant } from "@/lib/types";

export default function AppShell({ user }: { user: User }) {
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [activeGuildId, setActiveGuildId] = useState<string | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [voiceChannelId, setVoiceChannelId] = useState<string | null>(null);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [presence, setPresence] = useState<Record<string, VoiceParticipant[]>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ------------------------------------------------------------ загрузка
  const reloadGuilds = async () => {
    try {
      const res = await api<{ guilds: Guild[] }>("/guilds");
      setGuilds(res.guilds);
      setActiveGuildId((prev) => prev ?? res.guilds[0]?.id ?? null);
    } catch {
      /* не авторизованы — сюда не попадём */
    }
  };

  useEffect(() => {
    reloadGuilds();
  }, []);

  const activeGuild = guilds.find((g) => g.id === activeGuildId) || null;

  useEffect(() => {
    if (!activeGuild) return;
    const text = activeGuild.channels.find((c) => c.type === "text");
    setActiveChannelId(text ? text.id : null);
    setSidebarOpen(false);
  }, [activeGuildId]);

  const activeChannel = activeGuild?.channels.find((c) => c.id === activeChannelId);

  // ------------------------------------------------------------ socket
  useEffect(() => {
    const socket = getSocket();

    const onMessage = (msg: Message) => {
      window.dispatchEvent(new CustomEvent("dl:new-message", { detail: { message: msg } }));
    };

    const onParticipants = (payload: {
      channelId: string;
      participants: VoiceParticipant[];
    }) => {
      setPresence((prev) => ({ ...prev, [payload.channelId]: payload.participants }));
    };

    const onGuildsChanged = () => reloadGuilds();

    const onConnect = () => {
      socket.emit("sync-guilds");
    };

    socket.on("connect", onConnect);
    socket.on("new-message", onMessage);
    socket.on("voice-participants", onParticipants);
    socket.on("guilds-changed", onGuildsChanged);

    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("new-message", onMessage);
      socket.off("voice-participants", onParticipants);
      socket.off("guilds-changed", onGuildsChanged);
    };
  }, []);

  // При смене каналов заново подписываемся на комнаты гильдий.
  useEffect(() => {
    if (!guilds.length) return;
    getSocket().emit("sync-guilds");
  }, [guilds]);

  // ------------------------------------------------------------ voice
  function joinVoice(channel: Channel) {
    const socket = getSocket();
    if (voiceChannelId && voiceChannelId !== channel.id) {
      socket.emit("voice-leave", { channelId: voiceChannelId });
    }
    setVoiceChannelId(channel.id);
    setVoiceMuted(false);
    socket.emit("voice-join", { channelId: channel.id, muted: false });
    setSidebarOpen(false);
  }

  function leaveVoice() {
    if (voiceChannelId) {
      getSocket().emit("voice-leave", { channelId: voiceChannelId });
    }
    setVoiceChannelId(null);
  }

  function toggleVoiceMute() {
    if (!voiceChannelId) return;
    const next = !voiceMuted;
    setVoiceMuted(next);
    getSocket().emit("voice-mute", { channelId: voiceChannelId, muted: next });
  }

  async function logout() {
    leaveVoice();
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    disconnectSocket();
    window.location.reload();
  }

  async function createGuild() {
    const name = window.prompt("Название сервера:");
    if (!name?.trim()) return;
    try {
      await api("/guilds", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      await reloadGuilds();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка");
    }
  }

  async function createChannel() {
    if (!activeGuild) return;
    const name = window.prompt("Название канала (#текстовый):");
    if (!name?.trim()) return;
    try {
      const res = await api<{ channel: Channel }>(
        `/guilds/${activeGuild.id}/channels`,
        { method: "POST", body: JSON.stringify({ name: name.trim(), type: "text" }) }
      );
      await reloadGuilds();
      setActiveChannelId(res.channel.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка");
    }
  }

  async function createVoiceChannel() {
    if (!activeGuild) return;
    const name = window.prompt("Название голосового канала:");
    if (!name?.trim()) return;
    try {
      await api(`/guilds/${activeGuild.id}/channels`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), type: "voice" }),
      });
      await reloadGuilds();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка");
    }
  }

  const textChannels = activeGuild?.channels.filter((c) => c.type === "text") ?? [];
  const voiceChannels = activeGuild?.channels.filter((c) => c.type === "voice") ?? [];
  const voiceChannel = guilds
    .flatMap((g) => g.channels)
    .find((c) => c.id === voiceChannelId);

  return (
    <div className="app">
      {/* ---------------- рейл серверов ---------------- */}
      <div className="guild-rail">
        <button
          className={`guild-btn add ${!activeGuild ? "active" : ""}`}
          onClick={createGuild}
          title="Создать сервер"
        >
          +
        </button>
        <div className="rail-sep" />
        {guilds.map((g) => (
          <button
            key={g.id}
            className={`guild-btn ${g.id === activeGuildId ? "active" : ""}`}
            style={{ background: g.iconColor }}
            title={g.name}
            onClick={() => setActiveGuildId(g.id)}
          >
            {g.name.charAt(0).toUpperCase()}
          </button>
        ))}
      </div>

      {/* ---------------- панель каналов ---------------- */}
      {activeGuild ? (
        <div className={`channel-panel ${sidebarOpen ? "open" : ""}`}>
          <div className="guild-header">
            <span className="name">{activeGuild.name}</span>
            <span style={{ color: "var(--text-muted)", fontSize: 18 }}>⌄</span>
          </div>

          <div className="channel-list">
            <div className="channel-section">
              <span>Текстовые</span>
              <button onClick={createChannel} title="Создать текстовый канал">
                +
              </button>
            </div>
            {textChannels.map((c) => (
              <button
                key={c.id}
                className={`channel-item ${c.id === activeChannelId ? "active" : ""}`}
                onClick={() => {
                  setActiveChannelId(c.id);
                  setSidebarOpen(false);
                  getSocket().emit("join-channel", c.id);
                }}
              >
                <span className="hash">#</span>
                <span className="label">{c.name}</span>
              </button>
            ))}

            <div className="channel-section">
              <span>Голосовые</span>
              <button onClick={createVoiceChannel} title="Создать голосовой канал">
                +
              </button>
            </div>
            {voiceChannels.map((c) => {
              const people = presence[c.id] || [];
              return (
                <div key={c.id}>
                  <button
                    className={`channel-item ${c.id === voiceChannelId ? "active" : ""}`}
                    onClick={() => joinVoice(c)}
                  >
                    <span className="ico">🔊</span>
                    <span className="label">{c.name}</span>
                  </button>
                  {people.length > 0 ? (
                    <div className="voice-participants">
                      {people.map((p) => (
                        <div
                          key={p.userId}
                          className={`voice-participant ${p.muted ? "muted" : ""}`}
                        >
                          <Avatar name={p.name} color={p.avatarColor} size={18} />
                          <span>{p.name}</span>
                          {p.muted ? <span>🔇</span> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* нижняя панель пользователя и громкость */}
          {voiceChannel ? (
            <div className="voice-bar">
              <div className="title">
                🔊 {voiceChannel.name}
              </div>
              <div className="row">
                <span className="pill">{voiceMuted ? "микрофон выкл" : "в эфире"}</span>
                <button
                  className="icon-btn"
                  onClick={toggleVoiceMute}
                  title={voiceMuted ? "Включить микрофон" : "Выключить микрофон"}
                >
                  {voiceMuted ? "🔇" : "🎤"}
                </button>
                <button className="icon-btn danger" onClick={leaveVoice} title="Отключиться">
                  ✕
                </button>
              </div>
            </div>
          ) : null}

          <div className="user-panel">
            <Avatar name={user.displayName} color={user.avatarColor} size={32} />
            <div className="meta">
              <div className="name">{user.displayName}</div>
              <div className="tag">@{user.username}</div>
            </div>
            <button className="icon-btn danger" onClick={logout} title="Выйти">
              ⏻
            </button>
          </div>
        </div>
      ) : null}

      {/* ---------------- основная область ---------------- */}
      {voiceChannel && voiceChannelId ? (
        <VoiceStage
          key={voiceChannelId}
          channelId={voiceChannelId}
          channelName={voiceChannel.name}
          onLeave={leaveVoice}
        />
      ) : activeChannel ? (
        <ChatView
          key={activeChannel.id}
          channelId={activeChannel.id}
          channelName={activeChannel.name}
          onOpenSidebar={() => setSidebarOpen((v) => !v)}
        />
      ) : (
        <div className="chat">
          <div className="empty-chat">
            <div className="big">➕</div>
            <div>Создайте сервер или канал, чтобы начать</div>
          </div>
        </div>
      )}
    </div>
  );
}
