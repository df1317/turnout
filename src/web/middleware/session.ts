import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Env } from '../../index';

export type Session = {
  user_id: string;
  name: string;
  avatar_url: string;
  is_admin: number;
  role: string | null;
};

type Variables = { session: Session | null };

export const sessionMiddleware = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const token = getCookie(c, 'session');
    if (token) {
      const now = Math.floor(Date.now() / 1000);
      const row = await c.env.DB.prepare(
        `SELECT s.user_id, u.name, u.avatar_url, u.is_admin, u.role
         FROM web_session s JOIN slack_user u ON u.user_id = s.user_id
         WHERE s.id = ? AND s.expires_at > ?`
      ).bind(token, now).first<Session>();
      c.set('session', row ?? null);
    } else {
      c.set('session', null);
    }
    await next();
  }
);

export function requireSession() {
  return createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    if (!c.get('session')) return c.redirect('/login');
    await next();
  });
}

export function requireAdmin() {
  return createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    const session = c.get('session');
    if (!session) return c.redirect('/login');
    if (!session.is_admin) return c.text('Forbidden', 403);
    await next();
  });
}
