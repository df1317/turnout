import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { SlackAPIClient } from "slack-web-api-client";
import * as schema from "../../db/schema";
import type { Env } from "../../index";
import { clearCdtProfile, syncCdtUsers } from "../../lib/slack-cdt";
import type { Session } from "../middleware/session";

type Variables = { session: Session | null };

const adminUsers = new Hono<{ Bindings: Env; Variables: Variables }>();

adminUsers.post("/bulk/role", async (c) => {
	const { user_ids, role } = await c.req.json<{
		user_ids: string[];
		role: string | null;
	}>();
	if (!user_ids?.length) return c.json({ error: "No user IDs provided" }, 400);
	const validRoles = ["student", "mentor", "parent", "alumni"];
	if (role && !validRoles.includes(role))
		return c.json({ error: "Invalid role" }, 400);

	const db = drizzle(c.env.DB);
	for (const id of user_ids) {
		await db
			.update(schema.slackUser)
			// biome-ignore lint/suspicious/noExplicitAny: role is validated above
			.set({ role: role as any })
			.where(eq(schema.slackUser.userId, id));
	}

	return c.json({ ok: true });
});

adminUsers.post("/bulk/cdt", async (c) => {
	const { user_ids, cdt_id } = await c.req.json<{
		user_ids: string[];
		cdt_id: string | null;
	}>();
	if (!user_ids?.length) return c.json({ error: "No user IDs provided" }, 400);

	const db = drizzle(c.env.DB);
	const adminClient = new SlackAPIClient(c.env.SLACK_ADMIN_TOKEN);

	if (cdt_id === null) {
		for (const id of user_ids) {
			const currentCdt = await db
				.select({ cdt_id: schema.cdtMember.cdtId })
				.from(schema.cdtMember)
				.where(eq(schema.cdtMember.userId, id))
				.get();

			await db.delete(schema.cdtMember).where(eq(schema.cdtMember.userId, id));
			await clearCdtProfile(adminClient, id, c.env);

			if (currentCdt) {
				await syncCdtUsers(c.env.DB, adminClient, currentCdt.cdt_id, c.env);
			}
		}
	} else {
		for (const id of user_ids) {
			const currentCdt = await db
				.select({ cdt_id: schema.cdtMember.cdtId })
				.from(schema.cdtMember)
				.where(eq(schema.cdtMember.userId, id))
				.get();

			await db
				.insert(schema.cdtMember)
				.values({ userId: id, cdtId: cdt_id })
				.onConflictDoUpdate({
					target: schema.cdtMember.userId,
					set: { cdtId: cdt_id },
				});

			if (currentCdt && currentCdt.cdt_id !== cdt_id) {
				await syncCdtUsers(c.env.DB, adminClient, currentCdt.cdt_id, c.env);
			}
		}
		await syncCdtUsers(c.env.DB, adminClient, cdt_id, c.env);
	}
	return c.json({ ok: true });
});

adminUsers.post("/:userId/role", async (c) => {
	const userId = c.req.param("userId");
	const { role } = await c.req.json<{ role: string | null }>();
	const validRoles = ["student", "mentor", "parent", "alumni"];
	if (role && !validRoles.includes(role))
		return c.json({ error: "Invalid role" }, 400);
	const db = drizzle(c.env.DB);
	await db
		.update(schema.slackUser)
		// biome-ignore lint/suspicious/noExplicitAny: role is validated above
		.set({ role: role as any })
		.where(eq(schema.slackUser.userId, userId));
	return c.json({ ok: true });
});

adminUsers.get("/:userId/meetings", async (c) => {
	const userId = c.req.param("userId");
	const db = drizzle(c.env.DB);
	const rows = await db
		.select({
			id: schema.meeting.id,
			name: schema.meeting.name,
			scheduled_at: schema.meeting.scheduledAt,
			end_time: schema.meeting.endTime,
			status: schema.attendance.status,
			note: schema.attendance.note,
		})
		.from(schema.attendance)
		.innerJoin(
			schema.meeting,
			eq(schema.meeting.id, schema.attendance.meetingId),
		)
		.where(eq(schema.attendance.userId, userId))
		.orderBy(desc(schema.meeting.scheduledAt))
		.limit(20)
		.all();
	return c.json(rows);
});

adminUsers.post("/:userId/cdt", async (c) => {
	const userId = c.req.param("userId");
	const { cdt_id } = await c.req.json<{ cdt_id: string | null }>();

	const db = drizzle(c.env.DB);
	const adminClient = new SlackAPIClient(c.env.SLACK_ADMIN_TOKEN);
	const currentCdt = await db
		.select({ cdt_id: schema.cdtMember.cdtId })
		.from(schema.cdtMember)
		.where(eq(schema.cdtMember.userId, userId))
		.get();

	if (cdt_id === null) {
		await db
			.delete(schema.cdtMember)
			.where(eq(schema.cdtMember.userId, userId));
		await clearCdtProfile(adminClient, userId, c.env);
	} else {
		await db
			.insert(schema.cdtMember)
			.values({ userId, cdtId: cdt_id })
			.onConflictDoUpdate({
				target: schema.cdtMember.userId,
				set: { cdtId: cdt_id },
			});
	}

	if (currentCdt && currentCdt.cdt_id !== cdt_id) {
		await syncCdtUsers(c.env.DB, adminClient, currentCdt.cdt_id, c.env);
	}
	if (cdt_id) {
		await syncCdtUsers(c.env.DB, adminClient, cdt_id, c.env);
	}

	return c.json({ ok: true });
});

export default adminUsers;
