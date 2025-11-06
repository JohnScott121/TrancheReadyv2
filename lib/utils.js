import { parseISO, differenceInCalendarDays, isValid } from 'date-fns';

export function daysBetween(aISO, bISO) {
  const a = parseISO(aISO); const b = parseISO(bISO);
  if (!isValid(a) || !isValid(b)) return null;
  return Math.abs(differenceInCalendarDays(a, b));
}

export function isoToday() {
  return new Date().toISOString().slice(0,10);
}

export function monthsBetween(aISO, bISO) {
  const days = daysBetween(aISO, bISO);
  if (days == null) return null;
  return Math.floor(days / 30);
}
