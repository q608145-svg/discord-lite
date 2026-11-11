"use client";

import { useEffect, useId, useRef, useState } from "react";

type BaseProps = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
};

function ModalShell({
  open,
  title,
  description,
  onClose,
  children,
  labelledBy,
}: BaseProps & { children: React.ReactNode; labelledBy: string }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="dl-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="dl-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        <h2 className="dl-dialog__title" id={labelledBy}>
          {title}
        </h2>
        {description ? <p className="dl-dialog__text">{description}</p> : null}
        {children}
      </div>
    </div>
  );
}

export type PromptDialogProps = BaseProps & {
  label: string;
  placeholder?: string;
  submitLabel?: string;
  maxLength?: number;
  initialValue?: string;
  /** Если бросит ошибку — она покажется внутри окна, окно не закроется. */
  onSubmit: (value: string) => Promise<void> | void;
};

export function PromptDialog({
  open,
  title,
  description,
  label,
  placeholder,
  submitLabel = "Создать",
  maxLength = 48,
  initialValue = "",
  onSubmit,
  onClose,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const inputId = useId();

  // При каждом открытии — чистое поле и фокус.
  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    setError("");
    setBusy(false);
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
    return () => clearTimeout(timer);
  }, [open, initialValue]);

  const trimmed = value.trim();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось, попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      open={open}
      title={title}
      description={description}
      onClose={busy ? () => undefined : onClose}
      labelledBy={titleId}
    >
      <form onSubmit={submit}>
        <label className="dl-field" htmlFor={inputId}>
          {label}
        </label>
        <input
          id={inputId}
          ref={inputRef}
          className="dl-input"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
        />
        {error ? <div className="dl-error">{error}</div> : null}
        <div className="dl-actions">
          <button type="button" className="dl-btn dl-btn--ghost" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="submit" className="dl-btn dl-btn--primary" disabled={!trimmed || busy}>
            {busy ? "Сохраняем…" : submitLabel}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export type ConfirmDialogProps = BaseProps & {
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setError("");
    const timer = setTimeout(() => confirmRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [open]);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось, попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      open={open}
      title={title}
      description={description}
      onClose={busy ? () => undefined : onClose}
      labelledBy={titleId}
    >
      {error ? <div className="dl-error">{error}</div> : null}
      <div className="dl-actions">
        <button type="button" className="dl-btn dl-btn--ghost" onClick={onClose} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          type="button"
          ref={confirmRef}
          className={`dl-btn ${danger ? "dl-btn--danger" : "dl-btn--primary"}`}
          onClick={confirm}
          disabled={busy}
        >
          {busy ? "Подождите…" : confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}
