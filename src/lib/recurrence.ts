const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
	let fmt = formatters.get(timeZone);
	if (!fmt) {
		const options: Intl.DateTimeFormatOptions = {
			hour12: false,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		};
		try {
			fmt = new Intl.DateTimeFormat("en-US", { ...options, timeZone });
		} catch {
			// An unrecognised zone would otherwise throw and sink the whole
			// request. Fall back to UTC so the meetings still get created.
			console.warn(`Unknown timezone ${timeZone}, falling back to UTC`);
			fmt = new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
		}
		formatters.set(timeZone, fmt);
	}
	return fmt;
}

function zonedParts(instantMs: number, timeZone: string) {
	const parts: Record<string, number> = {};
	for (const { type, value } of formatter(timeZone).formatToParts(instantMs)) {
		if (type !== "literal") parts[type] = Number(value);
	}
	return parts;
}

/** Offset of `timeZone` from UTC, in ms, at a given instant. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
	const whole = Math.floor(instantMs / 1000) * 1000;
	const p = zonedParts(whole, timeZone);
	// Some ICU builds render midnight as hour 24 under hour12: false.
	const asUtc = Date.UTC(
		p.year,
		p.month - 1,
		p.day,
		p.hour % 24,
		p.minute,
		p.second,
	);
	return asUtc - whole;
}

/** UTC midnight marking the calendar day an instant falls on in `timeZone`. */
function zonedDayMarker(instantMs: number, timeZone: string): number {
	const p = zonedParts(instantMs, timeZone);
	return Date.UTC(p.year, p.month - 1, p.day);
}

/**
 * Unix seconds for a wall-clock time on a calendar day in `timeZone`.
 * @param dayMarker - UTC midnight standing in for the local calendar day
 * @param minutes - minutes since local midnight
 */
function wallClockToUnix(
	dayMarker: number,
	minutes: number,
	timeZone: string,
): number {
	const wall = dayMarker + minutes * 60_000;
	// The offsets in force on either side of the wall time. They agree except
	// across a DST change, where each gives a candidate instant to check.
	const before = zoneOffsetMs(wall - DAY_MS, timeZone);
	const after = zoneOffsetMs(wall + DAY_MS, timeZone);

	for (const offset of before === after ? [before] : [before, after]) {
		const instant = wall - offset;
		// An offset only holds if the instant it produces still sits inside it.
		// When the clock falls back, `before` matches first and wins, so an
		// ambiguous time resolves to its earlier occurrence.
		if (zoneOffsetMs(instant, timeZone) === offset) {
			return Math.floor(instant / 1000);
		}
	}

	// Neither held, so the clock sprang forward over this wall time and it never
	// happened. Shift it forward by the size of the gap, the way calendars do.
	return Math.floor((wall - before) / 1000);
}

/**
 * Unix seconds for a wall-clock time on a calendar date in `timeZone`.
 * @param date - calendar date as "YYYY-MM-DD"
 * @param minutes - minutes since local midnight
 */
export function zonedDateTimeToUnix(
	date: string,
	minutes: number,
	timeZone: string,
): number {
	const [year, month, day] = date.split("-").map(Number);
	return wallClockToUnix(Date.UTC(year, month - 1, day), minutes, timeZone);
}

/**
 * Generate unix timestamps for each occurrence of a recurring meeting.
 * @param days - Day-of-week numbers in `timeZone` (0=Sun, 1=Mon, ..., 6=Sat)
 * @param timeOfDayMinutes - Minutes since local midnight (e.g. 18*60+30 = 18:30 local)
 * @param startUnix - Earliest allowed occurrence (unix seconds, inclusive)
 * @param endUnix - Latest allowed occurrence (unix seconds, inclusive)
 * @param timeZone - IANA timezone the wall-clock time is expressed in
 */
export function generateDates(
	days: number[],
	timeOfDayMinutes: number,
	startUnix: number,
	endUnix: number,
	timeZone = "UTC",
): number[] {
	const dates: number[] = [];
	const lastDay = zonedDayMarker(endUnix * 1000, timeZone);
	let day = zonedDayMarker(startUnix * 1000, timeZone);

	while (day <= lastDay) {
		if (days.includes(new Date(day).getUTCDay())) {
			const ts = wallClockToUnix(day, timeOfDayMinutes, timeZone);
			if (ts >= startUnix && ts <= endUnix) {
				dates.push(ts);
			}
		}
		day += DAY_MS;
	}

	return dates;
}
