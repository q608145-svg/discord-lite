import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import Avatar from "@/components/Avatar";

export default function AuthScreen({ onAuthed }: { onAuthed: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ user: User | null }>("/me")
      .then((r) => {
        if (r.user) onAuthed(r.user);
      })
      .catch(() => {});
  }, [onAuthed]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const payload =
        mode === "login"
          ? { username, password }
          : { username, displayName: displayName || username, password };
      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const res = await api<{ user: User }>(path, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      onAuthed(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Что-то пошло не так");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>{mode === "login" ? "С возвращением!" : "Создайте аккаунт"}</h1>
        <p className="sub">
          {mode === "login"
            ? "Рады видеть вас снова"
            : "Чат и голосовой канал для своих"}
        </p>

        {error ? <div className="error">{error}</div> : null}

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="username">Логин</label>
            <input
              id="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="vasya"
              required
              minLength={2}
              maxLength={24}
            />
          </div>

          {mode === "register" ? (
            <div className="field">
              <label htmlFor="displayName">Отображаемое имя</label>
              <input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Вася"
                maxLength={32}
              />
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="password">Пароль</label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>

          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? "Подождите…" : mode === "login" ? "Войти" : "Зарегистрироваться"}
          </button>
        </form>

        <div className="auth-switch">
          {mode === "login" ? "Нет аккаунта?" : "Уже есть аккаунт?"}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
            }}
          >
            {mode === "login" ? "Зарегистрироваться" : "Войти"}
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "center", marginTop: 18 }}>
          <Avatar name="d" color="#5865F2" size={44} />
        </div>
      </div>
    </div>
  );
}
