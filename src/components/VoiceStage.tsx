"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  Participant,
  RemoteParticipant,
  LocalParticipant,
} from "livekit-client";
import { api } from "@/lib/api";
import Avatar from "@/components/Avatar";

type Peer = {
  key: string;
  name: string;
  color: string;
  isLocal: boolean;
  isSpeaking: boolean;
  micEnabled: boolean;
  camTrack: Track | null;
};

function colorFromMetadata(metadata?: string): string {
  if (!metadata) return "#5865F2";
  try {
    const parsed = JSON.parse(metadata);
    return typeof parsed.avatarColor === "string" ? parsed.avatarColor : "#5865F2";
  } catch {
    return "#5865F2";
  }
}

function VideoTile({ track, mirorred }: { track: Track; mirorred?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  return (
    <div className="cam">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={mirorred}
        style={{ transform: mirorred ? "scaleX(-1)" : undefined }}
      />
    </div>
  );
}

export default function VoiceStage({
  channelId,
  channelName,
  onLeave,
}: {
  channelId: string;
  channelName: string;
  onLeave: () => void;
}) {
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "error">(
    "connecting"
  );
  const [error, setError] = useState("");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);

  const snapshot = useMemo(
    () => () => {
      const room = roomRef.current;
      if (!room) return;
      const list: Peer[] = [];
      const local = room.localParticipant;
      const toPeer = (p: LocalParticipant | RemoteParticipant, isLocal: boolean): Peer => {
        const camPub = p.getTrackPublication(Track.Source.Camera);
        const camTrack =
          camPub && !camPub.isMuted ? camPub.track ?? null : null;
        return {
          key: p.identity,
          name: p.name || p.identity,
          color: colorFromMetadata(p.metadata),
          isLocal,
          isSpeaking: p.isSpeaking,
          micEnabled: p.isMicrophoneEnabled,
          camTrack,
        };
      };
      if (local) list.push(toPeer(local, true));
      for (const p of room.remoteParticipants.values()) list.push(toPeer(p, false));
      setPeers(list);
    },
    []
  );

  // Подключаемся к комнате один раз при входе.
  useEffect(() => {
    let disposed = false;
    let room: Room | null = null;

    (async () => {
      try {
        const { token, url } = await api<{ token: string; url: string }>(
          "/voice/token",
          { method: "POST", body: JSON.stringify({ channelId }) }
        );
        if (!url) {
          throw new Error(
            "LiveKit не настроен на сервере: заполните LIVEKIT_URL / ключи в .env"
          );
        }
        if (disposed) return;

        room = new Room({
          adaptiveStream: true,
          dynacast: true,
          audioCaptureDefaults: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        roomRef.current = room;

        room
          .on(RoomEvent.ParticipantConnected, snapshot)
          .on(RoomEvent.ParticipantDisconnected, snapshot)
          .on(RoomEvent.TrackSubscribed, snapshot)
          .on(RoomEvent.TrackUnsubscribed, snapshot)
          .on(RoomEvent.TrackMuted, snapshot)
          .on(RoomEvent.TrackUnmuted, snapshot)
          .on(RoomEvent.ActiveSpeakersChanged, snapshot)
          .on(RoomEvent.LocalTrackPublished, snapshot)
          .on(RoomEvent.LocalTrackUnpublished, snapshot)
          .on(RoomEvent.ParticipantMetadataChanged, snapshot)
          .on(RoomEvent.Disconnected, () => {
            if (!disposed) setStatus("error");
            setError("Соединение закрыто");
          });

        await room.connect(url, token);
        if (disposed) {
          await room.disconnect();
          return;
        }
        await room.localParticipant.setMicrophoneEnabled(true);
        setStatus("connected");
        snapshot();
      } catch (err) {
        if (!disposed) {
          setStatus("error");
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      disposed = true;
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, [channelId, snapshot]);

  async function toggleMic() {
    const room = roomRef.current;
    if (!room) return;
    const next = !micOn;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
    snapshot();
  }

  async function toggleCam() {
    const room = roomRef.current;
    if (!room) return;
    const next = !camOn;
    try {
      await room.localParticipant.setCameraEnabled(next);
      setCamOn(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Камера недоступна");
    }
    snapshot();
  }

  async function toggleScreen() {
    const room = roomRef.current;
    if (!room) return;
    const next = !screenOn;
    try {
      await room.localParticipant.setScreenShareEnabled(next);
      setScreenOn(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Демонстрация экрана недоступна");
    }
    snapshot();
  }

  function leave() {
    roomRef.current?.disconnect();
    onLeave();
  }

  return (
    <div className="voice-stage">
      <div className="chat-header" style={{ background: "var(--bg-channel)" }}>
        <span className="hash">🔊</span>
        {channelName}
        <div className="divider" />
        <span className="sub">
          {status === "connected"
            ? `${peers.length} в комнате`
            : status === "connecting"
              ? "Подключение…"
              : "Ошибка"}
        </span>
      </div>

      {error ? <div className="voice-error">{error}</div> : null}

      {status === "connected" ? (
        <div className="voice-grid">
          {peers.map((p) => (
            <div key={p.key} className={`voice-tile ${p.isSpeaking ? "speaking" : ""}`}>
              {p.camTrack ? (
                <VideoTile track={p.camTrack} mirorred={p.isLocal} />
              ) : (
                <>
                  <Avatar name={p.name} color={p.color} size={72} />
                  <div className="nick">
                    {p.name}
                    {!p.micEnabled ? <span className="mute-badge">🔇</span> : null}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      ) : status === "connecting" ? (
        <div className="muted-msg">Подключаемся к комнате…</div>
      ) : null}

      <div className="voice-controls">
        <button
          className={`ctl ${micOn ? "" : "on"}`}
          onClick={toggleMic}
          title={micOn ? "Выключить микрофон" : "Включить микрофон"}
        >
          {micOn ? "🎤" : "🔇"}
        </button>
        <button
          className={`ctl ${camOn ? "on" : ""}`}
          onClick={toggleCam}
          title="Камера"
        >
          {camOn ? "📷" : "🎥"}
        </button>
        <button
          className={`ctl ${screenOn ? "on" : ""}`}
          onClick={toggleScreen}
          title="Демонстрация экрана"
        >
          🖥️
        </button>
        <button className="ctl leave" onClick={leave} title="Покинуть канал">
          ✕
        </button>
      </div>
    </div>
  );
}
