import { describe, expect, it } from "vitest";
import { generateDates, zonedDateTimeToUnix } from "./recurrence";

const TZ = "America/New_York";
const local = (unix: number) =>
	new Date(unix * 1000).toLocaleString("en-US", {
		timeZone: TZ,
		dateStyle: "short",
		timeStyle: "short",
	});

describe("generateDates", () => {
	it("keeps the wall-clock time in the given timezone", () => {
		const start = zonedDateTimeToUnix("2026-08-04", 18 * 60, TZ);
		const end = zonedDateTimeToUnix("2026-08-20", 23 * 60 + 59, TZ);
		expect(generateDates([2, 4], 18 * 60, start, end, TZ).map(local)).toEqual([
			"8/4/26, 6:00 PM",
			"8/6/26, 6:00 PM",
			"8/11/26, 6:00 PM",
			"8/13/26, 6:00 PM",
			"8/18/26, 6:00 PM",
			"8/20/26, 6:00 PM",
		]);
	});

	it("holds the wall-clock time across a DST transition", () => {
		const start = zonedDateTimeToUnix("2026-10-27", 18 * 60, TZ);
		const end = zonedDateTimeToUnix("2026-11-05", 23 * 60 + 59, TZ);
		expect(generateDates([2, 4], 18 * 60, start, end, TZ).map(local)).toEqual([
			"10/27/26, 6:00 PM",
			"10/29/26, 6:00 PM",
			"11/3/26, 6:00 PM",
			"11/5/26, 6:00 PM",
		]);
	});

	it("treats the time as UTC when no timezone is given", () => {
		const start = Date.UTC(2026, 7, 3) / 1000;
		const end = Date.UTC(2026, 7, 10, 23, 59, 59) / 1000;
		expect(
			generateDates([1], 18 * 60 + 30, start, end).map((t) =>
				new Date(t * 1000).toISOString(),
			),
		).toEqual(["2026-08-03T18:30:00.000Z", "2026-08-10T18:30:00.000Z"]);
	});

	it("lands every occurrence on the right weekday in every timezone", () => {
		const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
		const wrong: string[] = [];

		for (const zone of Intl.supportedValuesOf("timeZone")) {
			const start = zonedDateTimeToUnix("2026-01-01", 18 * 60 + 30, zone);
			const end = zonedDateTimeToUnix("2026-12-31", 23 * 60 + 59, zone);
			for (const ts of generateDates([3], 18 * 60 + 30, start, end, zone)) {
				const shown: Record<string, string> = {};
				const parts = new Intl.DateTimeFormat("en-US", {
					timeZone: zone,
					weekday: "short",
					hour: "2-digit",
					minute: "2-digit",
					hour12: false,
				}).formatToParts(ts * 1000);
				for (const { type, value } of parts) shown[type] = value;

				const got = `${shown.weekday} ${shown.hour}:${shown.minute}`;
				if (got !== `${weekdays[3]} 18:30`) wrong.push(`${zone}: ${got}`);
			}
		}

		expect(wrong).toEqual([]);
	});
});

describe("zonedDateTimeToUnix", () => {
	it("resolves midnight without rolling to the wrong day", () => {
		expect(local(zonedDateTimeToUnix("2026-03-08", 0, TZ))).toBe(
			"3/8/26, 12:00 AM",
		);
	});

	it("handles offsets that are not whole hours", () => {
		expect(
			new Date(
				zonedDateTimeToUnix("2026-06-15", 18 * 60, "Asia/Kathmandu") * 1000,
			).toISOString(),
		).toBe("2026-06-15T12:15:00.000Z");
	});

	it("shifts a time skipped by DST forward, never onto the day before", () => {
		// Havana springs from 00:00 to 01:00, so midnight never happens.
		const ts = zonedDateTimeToUnix("2026-03-08", 0, "America/Havana");
		expect(
			new Date(ts * 1000).toLocaleString("en-US", {
				timeZone: "America/Havana",
				dateStyle: "short",
				timeStyle: "short",
			}),
		).toBe("3/8/26, 1:00 AM");
	});

	it("picks the earlier occurrence of an ambiguous time", () => {
		// 1:00 AM happens twice when New York falls back on Nov 1.
		expect(
			new Date(zonedDateTimeToUnix("2026-11-01", 60, TZ) * 1000).toISOString(),
		).toBe("2026-11-01T05:00:00.000Z");
	});

	it("falls back to UTC instead of throwing on an unknown timezone", () => {
		expect(zonedDateTimeToUnix("2026-06-15", 18 * 60, "Not/AZone")).toBe(
			Date.UTC(2026, 5, 15, 18) / 1000,
		);
	});
});
