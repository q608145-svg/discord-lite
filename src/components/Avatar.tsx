export default function Avatar({
  name,
  color,
  size = 40,
  className = "",
}: {
  name: string;
  color?: string | null;
  size?: number;
  className?: string;
}) {
  const letter = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <div
      className={`avatar ${className}`}
      style={{
        width: size,
        height: size,
        background: color || "#5865F2",
        fontSize: Math.round(size * 0.42),
      }}
      title={name}
    >
      {letter}
    </div>
  );
}
