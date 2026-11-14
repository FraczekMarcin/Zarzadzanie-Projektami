export const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Krytyczny (P1)',
  high: 'Wysoki (P2)',
  normal: 'Normalny (P3)',
  medium: 'Normalny (P3)',
  low: 'Niski (P4)',
};

export const STATUS_LABELS: Record<string, string> = {
  to_do: 'Do zrobienia',
  in_progress: 'W toku',
  review: 'Do weryfikacji',
  done: 'Ukończone',
  blocked: 'Zablokowane',
  cancelled: 'Anulowane',
};

export function formatDurationDays(days?: number): string {
  const safeDays = typeof days === 'number' && !isNaN(days) && days > 0 ? Math.round(days) : 1;
  return safeDays === 1 ? '1 dzień' : `${safeDays} dni`;
}
