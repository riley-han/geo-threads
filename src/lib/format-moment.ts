const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const DAY_TIME = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * A moment in the viewer's own time zone: "7:00 PM" today, otherwise
 * "Sat, Oct 12, 7:00 PM". Used for trail stop windows, which are absolute
 * moments, so each viewer sees them in their own local time.
 */
export function formatMoment(ts: number, now: number = Date.now()): string {
  const then = new Date(ts);
  return new Date(now).toDateString() === then.toDateString()
    ? TIME.format(then)
    : DAY_TIME.format(then);
}
