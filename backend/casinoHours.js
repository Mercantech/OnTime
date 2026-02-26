/**
 * Casino lukketider: hverdage (man–fre) i dansk tid, i disse intervaller:
 * 08:00–09:30, 10:00–11:30, 12:00–13:30, 13:45–15:15.
 * Tidszone: Europe/Copenhagen.
 */

const TZ = 'Europe/Copenhagen';

/** Lukkeintervaller som minutter fra midnat [start, slut) – slut er eksklusiv */
const CLOSED_MINUTES = [
  [8 * 60, 9 * 60 + 30],       // 08:00 – 09:30
  [10 * 60, 11 * 60 + 30],     // 10:00 – 11:30
  [12 * 60, 13 * 60 + 30],     // 12:00 – 13:30
  [13 * 60 + 45, 15 * 60 + 15], // 13:45 – 15:15
  [20 * 60, 20 * 60 + 10],           // 20:00 - 20:10
];

function getNowInCopenhagen() {
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat('en', { timeZone: TZ, hour: 'numeric', hour12: false }).format(now));
  const minute = Number(new Intl.DateTimeFormat('en', { timeZone: TZ, minute: 'numeric' }).format(now));
  const weekday = new Intl.DateTimeFormat('en', { timeZone: TZ, weekday: 'short' }).format(now);
  const minutesSinceMidnight = hour * 60 + minute;
  const isWeekday = !['Sat', 'Sun'].includes(weekday);
  return { minutesSinceMidnight, isWeekday };
}

/**
 * Returnerer true hvis casinoet er lukket lige nu (server tjek, dansk tid).
 */
function isCasinoClosed() {
  const { minutesSinceMidnight, isWeekday } = getNowInCopenhagen();
  if (!isWeekday) return false;
  return CLOSED_MINUTES.some(([start, end]) => minutesSinceMidnight >= start && minutesSinceMidnight < end);
}

module.exports = { isCasinoClosed };
