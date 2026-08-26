const JST = 'Asia/Tokyo';

/** ISO8601 → "8/26 20:10"（JST） */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: JST,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** "2026-08-26" → "2026年8月26日(水)" */
export function formatDateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: JST,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(d);
}

export function importanceTone(importance: number): 'danger' | 'warn' | 'info' | 'muted' {
  if (importance >= 5) return 'danger';
  if (importance === 4) return 'warn';
  if (importance === 3) return 'info';
  return 'muted';
}

export function importanceLabel(importance: number): string {
  switch (importance) {
    case 5:
      return '業界全体に影響';
    case 4:
      return '注目度が高い';
    case 3:
      return '標準';
    case 2:
      return '参考';
    default:
      return '小ネタ';
  }
}
