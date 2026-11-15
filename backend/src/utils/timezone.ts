/**
 * Timezone utilities for MediTrack
 * Default timezone: Asia/Kolkata
 */

export function getTodayInTimezone(timeZone = 'Asia/Kolkata'): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now); // Returns 'YYYY-MM-DD'
}

export function localToUtc(dateStr: string, timeStr: string, timeZone = 'Asia/Kolkata'): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const parts = timeStr.split(':').map(Number);
  const hour = parts[0] || 0;
  const minute = parts[1] || 0;
  const second = parts[2] || 0;

  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const formattedParts = formatter.formatToParts(new Date(naiveUtc));
  const p: Record<string, number> = {};
  for (const part of formattedParts) {
    if (part.type !== 'literal') {
      p[part.type] = parseInt(part.value, 10);
    }
  }

  const localH = p.hour === 24 ? 0 : p.hour;
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, localH, p.minute, p.second);
  const offset = localAsUtc - naiveUtc;

  return new Date(naiveUtc - offset);
}

export function formatTimeInTimezone(date: Date, timeZone = 'Asia/Kolkata'): string {
  return date.toLocaleTimeString('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

