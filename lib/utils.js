import { parseISO, differenceInCalendarDays, isValid } from 'date-fns';

export function daysBetween(aISO, bISO) {
  const a = parseISO(aISO); const b = parseISO(bISO);
  if (!isValid(a) || !isValid(b)) return null;
  return Math.abs(differenceInCalendarDays(a, b));
}

export function monthsBetween(aISO, bISO) {
  const d = daysBetween(aISO, bISO);
  if (d == null) return null;
  return Math.floor(d / 30);
}
