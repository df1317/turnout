import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from '../../index';
import { buildOAuthUrl, exchangeCode } from '../lib/auth';

const auth = new Hono<{ Bindings: Env }>();

auth.get('/login', (c) => {
  const state = crypto.randomUUID();
  setCookie(c, 'oauth_state', state, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 300 });
  return c.redirect(buildOAuthUrl(c.env, state));
});

auth.get('/oauth/callback', async (c) => {
  const { code, state, error } = c.req.query();

  if (error) return c.redirect(`/login?error=${encodeURIComponent(error)}`);

  const savedState = getCookie(c, 'oauth_state');
  deleteCookie(c, 'oauth_state');
  if (!savedState || savedState !== state) return c.redirect('/login?error=invalid_state');

  try {
    const { userId, name, avatarUrl } = await exchangeCode(c.env, code);
    const now = Math.floor(Date.now() / 1000);

    await c.env.DB.prepare(
      `INSERT INTO slack_user (user_id, name, avatar_url, last_synced)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         name = excluded.name,
         avatar_url = excluded.avatar_url,
         last_synced = excluded.last_synced`
    ).bind(userId, name, avatarUrl, now).run();

    const sessionId = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    await c.env.DB.prepare(
      'INSERT INTO web_session (id, user_id, expires_at) VALUES (?, ?, ?)'
    ).bind(sessionId, userId, now + 30 * 24 * 60 * 60).run();

    setCookie(c, 'session', sessionId, {
      httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 30 * 24 * 60 * 60,
    });
    return c.redirect('/');
  } catch (err) {
    console.error('OAuth callback error:', err);
    return c.redirect('/login?error=server_error');
  }
});

auth.post('/logout', async (c) => {
  const token = getCookie(c, 'session');
  if (token) await c.env.DB.prepare('DELETE FROM web_session WHERE id = ?').bind(token).run();
  deleteCookie(c, 'session');
  return c.redirect('/login');
});

export default auth;
