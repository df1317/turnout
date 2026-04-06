/**
 * Generate unix timestamps for each occurrence of a recurring meeting.
 * @param days - Day-of-week numbers (0=Sun, 1=Mon, ..., 6=Sat)
 * @param timeOfDayMinutes - Minutes since midnight UTC (e.g. 18*60+30 = 18:30 UTC)
 * @param startUnix - Earliest allowed occurrence (unix seconds, inclusive)
 * @param endUnix - Latest allowed occurrence (unix seconds, inclusive)
 */
export function generateDates(
  days: number[],
  timeOfDayMinutes: number,
  startUnix: number,
  endUnix: number,
): number[] {
  const dates: number[] = [];
  const current = new Date(startUnix * 1000);
  current.setUTCHours(0, 0, 0, 0);

  const end = new Date(endUnix * 1000);

  while (current <= end) {
    if (days.includes(current.getUTCDay())) {
      const ts = Math.floor(current.getTime() / 1000) + timeOfDayMinutes * 60;
      if (ts >= startUnix && ts <= endUnix) {
        dates.push(ts);
      }
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}
