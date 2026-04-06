import { SlackAPIClient } from 'slack-web-api-client';

export async function syncAllUsers(db: D1Database, adminToken: string): Promise<void> {
  const client = new SlackAPIClient(adminToken);
  let cursor: string | undefined;
  const users: { id: string; name: string; avatar: string; is_admin: boolean }[] = [];

  do {
    const res: any = await client.users.list({ limit: 200, cursor });
    const members: any[] = res.members ?? [];
    for (const m of members) {
      if (m.deleted || m.is_bot || m.id === 'USLACKBOT') continue;
      users.push({
        id: m.id,
        name: m.profile?.display_name || m.real_name || m.name || '',
        avatar: m.profile?.image_72 ?? '',
        is_admin: m.is_admin ?? false,
      });
    }
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);

  const now = Math.floor(Date.now() / 1000);
  const chunkSize = 10;
  for (let i = 0; i < users.length; i += chunkSize) {
    const chunk = users.slice(i, i + chunkSize);
    const stmts = chunk.map((u) =>
      db.prepare(
        `INSERT INTO slack_user (user_id, name, avatar_url, is_admin, last_synced)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
           name = excluded.name,
           avatar_url = excluded.avatar_url,
           is_admin = excluded.is_admin,
           last_synced = excluded.last_synced`
      ).bind(u.id, u.name, u.avatar, u.is_admin ? 1 : 0, now)
    );
    await db.batch(stmts);
  }
}
