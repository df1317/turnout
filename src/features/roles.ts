import { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers';
import { SlackAPIClient } from 'slack-web-api-client';
import { setProfile } from '../lib/users';
import type { Env } from '../index';
import { isAdmin } from '../lib/admin';

const ROLE_FIELD_ID = 'Xf040NQZR2F6';
const VALID_ROLES = ['student', 'parent', 'alumni', 'mentor'] as const;
type Role = typeof VALID_ROLES[number];

const ROLE_OPTIONS = VALID_ROLES.map(role => ({
  text: { type: 'plain_text', text: role.charAt(0).toUpperCase() + role.slice(1) },
  value: role,
}));

function buildSetRoleModal(initialUsers: string[] = [], initialRole?: Role): any {
  return {
    type: 'modal',
    callback_id: 'setrole_modal',
    title: { type: 'plain_text', text: 'Set Role' },
    submit: { type: 'plain_text', text: 'Set Role' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'users_block',
        element: {
          type: 'multi_users_select',
          action_id: 'users',
          placeholder: { type: 'plain_text', text: 'Select members' },
          ...(initialUsers.length > 0 ? { initial_users: initialUsers } : {}),
        },
        label: { type: 'plain_text', text: 'Members' },
      },
      {
        type: 'input',
        block_id: 'role_block',
        element: {
          type: 'static_select',
          action_id: 'role',
          placeholder: { type: 'plain_text', text: 'Select a role' },
          options: ROLE_OPTIONS,
          ...(initialRole ? { initial_option: ROLE_OPTIONS.find(o => o.value === initialRole) } : {}),
        },
        label: { type: 'plain_text', text: 'Role' },
      },
    ],
  };
}

const roles = async (slackApp: SlackApp<SlackEdgeAppEnv>, env: Env) => {
  slackApp.command('/setrole', async ({ context, payload }) => {
    if (!await isAdmin(env.DB, context.client, context.userId)) {
      await context.respond({ response_type: 'ephemeral', text: '❌ Only workspace admins can set roles.' });
      return;
    }

    // Parse optional pre-fill args: /setrole [@user] [role]
    const initialUsers: string[] = [];
    let initialRole: Role | undefined;

    for (const part of payload.text.trim().split(/\s+/).filter(Boolean)) {
      const userMatch = part.match(/^<@([A-Z0-9]+)/);
      if (userMatch) {
        initialUsers.push(userMatch[1]);
      } else if (VALID_ROLES.includes(part.toLowerCase() as Role)) {
        initialRole = part.toLowerCase() as Role;
      }
    }

    await context.client.views.open({
      trigger_id: payload.trigger_id,
      view: buildSetRoleModal(initialUsers, initialRole),
    });
  });

  slackApp.viewSubmission(
    'setrole_modal',
    async () => ({ response_action: 'clear' }),
    async (req) => {
      try {
        const values = req.payload.view.state.values;
        const userIds: string[] = values.users_block?.users?.selected_users ?? [];
        const role = values.role_block?.role?.selected_option?.value ?? '';

        if (!userIds.length || !VALID_ROLES.includes(role as Role)) return;

        // Use admin user token for profile writes (bot tokens can't write other users' profiles)
        const adminClient = new SlackAPIClient(env.SLACK_ADMIN_TOKEN);

        for (const userId of userIds) {
          await setProfile(adminClient, userId, { [ROLE_FIELD_ID]: role.charAt(0).toUpperCase() + role.slice(1) });
          await env.DB.prepare(`
            INSERT INTO slack_user (user_id, role) VALUES (?, ?)
            ON CONFLICT (user_id) DO UPDATE SET role = excluded.role
          `).bind(userId, role).run();
        }
      } catch (err) {
        console.error('setrole_modal error:', err);
      }
    },
  );
};

export default roles;
