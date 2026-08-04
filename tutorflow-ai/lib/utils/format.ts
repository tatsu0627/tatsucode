export function formatDate(value: string | null | undefined) {
  if (!value) return "\u8a18\u9332\u306a\u3057";
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric" }).format(
    new Date(`${value}T00:00:00`),
  );
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
