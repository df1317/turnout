import type { SlackAPIClient } from 'slack-web-api-client';

const SEVEN_DAYS = 7 * 24 * 60 * 60;

export interface SlackUser {
  user_id: string;
  name: string;
  avatar_url: string;
  is_admin: number;
  role: string | null;
  last_synced: number;
}

export async function getUser(db: D1Database, client: SlackAPIClient, userId: string): Promise<SlackUser> {
  const now = Math.floor(Date.now() / 1000);
  const cached = await db.prepare('SELECT * FROM slack_user WHERE user_id = ?').bind(userId).first<SlackUser>();

  if (cached && now - cached.last_synced < SEVEN_DAYS) {
    return cached;
  }

  const result = await client.users.info({ user: userId });
  const u = result.user as any;
  const name = u.profile?.display_name_normalized || u.profile?.real_name || u.name || userId;
  const avatar_url = u.profile?.image_72 ?? '';
  const is_admin = u.is_admin === true || u.is_owner === true ? 1 : 0;

  await db.prepare(`
    INSERT INTO slack_user (user_id, name, avatar_url, is_admin, last_synced)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET
      name        = excluded.name,
      avatar_url  = excluded.avatar_url,
      is_admin    = excluded.is_admin,
      last_synced = excluded.last_synced
  `).bind(userId, name, avatar_url, is_admin, now).run();

  return { user_id: userId, name, avatar_url, is_admin, role: cached?.role ?? null, last_synced: now };
}

export async function setProfile(
  adminClient: SlackAPIClient,
  userId: string,
  profile: Record<string, string>,
): Promise<void> {
  await adminClient.users.profile.set({ user: userId, profile }).catch((err: any) => {
    if (err?.error !== 'cannot_update_admin_user') throw err;
    console.log(`setProfile: skipped admin user ${userId}`);
  });
}

export async function isAdmin(db: D1Database, client: SlackAPIClient, userId: string): Promise<boolean> {
  const user = await getUser(db, client, userId);
  return user.is_admin === 1;
}
