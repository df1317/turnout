import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import * as schema from "../../db/schema";
import type { Env } from "../../index";

/** Escape text per RFC 5545 §3.3.11: \ → \\, ; → \;, , → \,, newline → \n */
function escapeIcsText(text: string): string {
	return text
		.replace(/\\/g, "\\\\")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,")
		.replace(/\r?\n/g, "\\n");
}

const calendar = new Hono<{ Bindings: Env }>();

calendar.get("/:filename", async (c) => {
	const filename = c.req.param("filename");
	const token = filename?.replace(/\.ics$/, "");
	if (!token) return c.text("Not found", 404);

	const db = drizzle(c.env.DB);
	const user = await db
		.select({ user_id: schema.slackUser.userId, name: schema.slackUser.name })
		.from(schema.slackUser)
		.where(
			eq(schema.slackUser.calendarToken, token),
		)
		.get();

	if (!user) return c.text("Not found", 404);

	const meetings = await db
		.select({
			id: schema.meeting.id,
			name: schema.meeting.name,
			description: schema.meeting.description,
			scheduled_at: schema.meeting.scheduledAt,
			end_time: schema.meeting.endTime,
			cancelled: schema.meeting.cancelled,
		})
		.from(schema.meeting)
		.orderBy(asc(schema.meeting.scheduledAt));

	let ics = "BEGIN:VCALENDAR\r\n";
	ics += "VERSION:2.0\r\n";
	ics += "PRODID:-//Turnout//Calendar//EN\r\n";
	ics += "CALSCALE:GREGORIAN\r\n";
	ics += "METHOD:PUBLISH\r\n";
	ics += `X-WR-CALNAME:Turnout Events (${user.name})\r\n`;

	const now = `${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
	const baseUrl = new URL(c.req.url).origin;

	for (const m of meetings) {
		const start = `${
			new Date(m.scheduled_at * 1000)
				.toISOString()
				.replace(/[-:]/g, "")
				.split(".")[0]
		}Z`;

		// Default to 3 hours if no end time is specified
		const endTimeSeconds = m.end_time || m.scheduled_at + 3 * 60 * 60;
		const end = `${
			new Date(endTimeSeconds * 1000)
				.toISOString()
				.replace(/[-:]/g, "")
				.split(".")[0]
		}Z`;

		ics += "BEGIN:VEVENT\r\n";
		ics += `DTSTAMP:${now}\r\n`;
		ics += `UID:turnout-event-${m.scheduled_at}-${encodeURIComponent(m.name.replace(/\s+/g, "-"))}@turnout\r\n`;
		ics += `DTSTART:${start}\r\n`;
		ics += `DTEND:${end}\r\n`;
		ics += `SUMMARY:${escapeIcsText(m.cancelled === 1 ? `[CANCELED] ${m.name}` : m.name)}\r\n`;

		let desc = m.description || "";
		if (m.cancelled !== 1) {
			desc += `\n\nRSVP Here: ${baseUrl}/rsvp/${m.id}/${token}`;
		}

		if (desc) {
			ics += `DESCRIPTION:${escapeIcsText(desc)}\r\n`;
		}

		if (m.cancelled === 1) {
			ics += "STATUS:CANCELLED\r\n";
		} else {
			ics += "STATUS:CONFIRMED\r\n";
		}

		ics += "END:VEVENT\r\n";
	}

	ics += "END:VCALENDAR";

	return c.text(ics, 200, {
		"Content-Type": "text/calendar; charset=utf-8",
		"Content-Disposition": 'inline; filename="calendar.ics"',
		"Cache-Control": "no-cache",
	});
});

export default calendar;
