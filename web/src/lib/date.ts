/** Format a unix timestamp as a human-readable date+time string. */
export function formatDateTime(unix: number): string {
	const d = new Date(unix * 1000);
	const isCurrentYear = d.getFullYear() === new Date().getFullYear();

	let dateStr = d.toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
	});

	if (!isCurrentYear) {
		dateStr += `, ${d.getFullYear()}`;
	}

	return (
		dateStr +
		" · " +
		d.toLocaleTimeString("en-US", {
			hour: "numeric",
			minute: "2-digit",
		})
	);
}

/** Format a unix timestamp as a date-only string (no time). */
export function formatDate(unix: number): string {
	const d = new Date(unix * 1000);
	const isCurrentYear = d.getFullYear() === new Date().getFullYear();
	return d.toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		...(isCurrentYear ? {} : { year: "numeric" }),
	});
}

/** Convert a unix timestamp to a Date. */
export function fromUnix(unix: number): Date {
	return new Date(unix * 1000);
}

/** Convert a Date to a unix timestamp. */
export function toUnix(d: Date): number {
	return Math.floor(d.getTime() / 1000);
}
