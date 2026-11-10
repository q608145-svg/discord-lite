export type User = {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
};

export type Channel = {
  id: string;
  guildId: string;
  name: string;
  type: "text" | "voice" | string;
  position: number;
};

export type Guild = {
  id: string;
  name: string;
  iconColor: string;
  ownerId: string;
  memberCount: number;
  channels: Channel[];
};

export type Message = {
  id: string;
  channelId: string;
  content: string;
  createdAt: string;
  author: User;
};

export type VoiceParticipant = {
  userId: string;
  name: string;
  avatarColor: string;
  muted: boolean;
};

export function formatTime(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}
