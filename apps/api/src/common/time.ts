const TIME_ZONE = 'America/Sao_Paulo';

/**
 * Midnight of the current day in São Paulo, as an instant. Brazil has no daylight saving
 * time since 2019, so the offset is a constant UTC-3; the date itself comes from Intl.
 */
export function startOfDaySaoPaulo(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // "2026-11-12"
  return new Date(`${parts}T00:00:00-03:00`);
}
