import { SlackApp, SlackEdgeAppEnv } from 'slack-cloudflare-workers';
import type { Env } from '../index';
import { isAdmin } from '../lib/admin';
import { generateDates } from '../lib/recurrence';

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function flattenState(stateValues: Record<string, Record<string, any>>): Record<string, any> {
  const flat: Record<string, any> = {};
  for (const blockState of Object.values(stateValues)) {
    for (const [actionId, val] of Object.entries(blockState)) {
      flat[actionId] = val;
    }
  }
  return flat;
}

function buildNewMeetingModal(isRecurring: boolean): any {
  const baseBlocks: any[] = [
    {
      type: 'input',
      block_id: 'name_block',
      element: { type: 'plain_text_input', action_id: 'name' },
      label: { type: 'plain_text', text: 'Meeting name' },
    },
    {
      type: 'input',
      block_id: 'description_block',
      element: { type: 'plain_text_input', action_id: 'description', multiline: true },
      label: { type: 'plain_text', text: 'Description' },
      optional: true,
    },
    {
      type: 'input',
      block_id: 'channel_block',
      element: { type: 'channels_select', action_id: 'channel' },
      label: { type: 'plain_text', text: 'Post to channel' },
    },
  ];

  const recurringOption = { text: { type: 'plain_text', text: 'Recurring meeting' }, value: 'recurring' };
  const recurringCheckbox: any = {
    type: 'checkboxes',
    action_id: 'repeat_toggle',
    options: [recurringOption],
  };
  if (isRecurring) recurringCheckbox.initial_options = [recurringOption];

  if (!isRecurring) {
    return {
      type: 'modal',
      callback_id: 'new_meeting',
      title: { type: 'plain_text', text: 'New Meeting' },
      submit: { type: 'plain_text', text: 'Create' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        ...baseBlocks,
        {
          type: 'input',
          block_id: 'datetime_block',
          element: { type: 'datetimepicker', action_id: 'datetime' },
          label: { type: 'plain_text', text: 'Date & Time' },
        },
        {
          type: 'actions',
          block_id: 'recurring_block',
          elements: [recurringCheckbox],
        },
      ],
    };
  }

  return {
    type: 'modal',
    callback_id: 'new_meeting',
    title: { type: 'plain_text', text: 'New Meeting' },
    submit: { type: 'plain_text', text: 'Create' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      ...baseBlocks,
      {
        type: 'actions',
        block_id: 'recurring_block',
        elements: [recurringCheckbox],
      },
      {
        type: 'input',
        block_id: 'days_block',
        element: {
          type: 'checkboxes',
          action_id: 'days',
          options: DAYS_OF_WEEK.map((day, i) => ({
            text: { type: 'plain_text', text: day },
            value: String(i),
          })),
        },
        label: { type: 'plain_text', text: 'Repeat on' },
      },
      {
        type: 'input',
        block_id: 'time_block',
        element: { type: 'timepicker', action_id: 'time' },
        label: { type: 'plain_text', text: 'Time of day' },
      },
      {
        type: 'input',
        block_id: 'end_date_block',
        element: { type: 'datepicker', action_id: 'end_date' },
        label: { type: 'plain_text', text: 'Repeat until' },
      },
    ],
  };
}

function buildAnnouncementBlocks(
  meeting: { id: number; name: string; description: string; scheduled_at: number },
  counts: { yes: number; maybe: number; no: number },
): any[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${meeting.name}*${meeting.description ? `\n${meeting.description}` : ''}\n\n📅 <!date^${meeting.scheduled_at}^{date_long_pretty} at {time}|${new Date(meeting.scheduled_at * 1000).toISOString()}>`,
      },
    },
    {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `✅ ${counts.yes} going · 🤔 ${counts.maybe} maybe · ❌ ${counts.no} can't make it`,
      }],
    },
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Yes' },
          action_id: 'rsvp_yes',
          value: String(meeting.id),
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🤔 Maybe' },
          action_id: 'rsvp_maybe',
          value: String(meeting.id),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ No' },
          action_id: 'rsvp_no',
          value: String(meeting.id),
          style: 'danger',
        },
      ],
    },
  ];
}

function buildRsvpModal(meetingId: number, status: 'yes' | 'maybe' | 'no', meetingName: string): any {
  const label = status === 'yes' ? '✅ Yes' : status === 'maybe' ? '🤔 Maybe' : '❌ No';
  return {
    type: 'modal',
    callback_id: 'rsvp_modal',
    private_metadata: JSON.stringify({ meetingId, status }),
    title: { type: 'plain_text', text: 'RSVP' },
    submit: { type: 'plain_text', text: 'Submit' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Responding *${label}* to *${meetingName}*.`,
        },
      },
      {
        type: 'input',
        block_id: 'note_block',
        element: { type: 'plain_text_input', action_id: 'note', multiline: true },
        label: { type: 'plain_text', text: 'Note (optional)' },
        optional: true,
      },
    ],
  };
}

const meetings = async (slackApp: SlackApp<SlackEdgeAppEnv>, env: Env) => {
  slackApp.command('/newmeeting', async ({ context, payload }) => {
    if (!await isAdmin(env.DB, context.client, context.userId)) {
      await context.respond({ response_type: 'ephemeral', text: '❌ Only workspace admins can create meetings.' });
      return;
    }
    await context.client.views.open({
      trigger_id: payload.trigger_id,
      view: buildNewMeetingModal(false),
    });
  });

  slackApp.action('repeat_toggle', async ({ context, payload }) => {
    const isRecurring = (payload as any).actions[0].selected_options?.length > 0;
    await context.client.views.update({
      view_id: (payload as any).view.id,
      hash: (payload as any).view.hash,
      view: buildNewMeetingModal(isRecurring),
    });
  });

  slackApp.viewSubmission(
    'new_meeting',
    async () => ({ response_action: 'clear' }),
    async (req) => {
      try {
        const flat = flattenState(req.payload.view.state.values);
        const name: string = flat.name?.value ?? '';
        const description: string = flat.description?.value ?? '';
        const channelId: string = flat.channel?.selected_channel ?? '';
        const isRecurring = flat.days !== undefined;
        const client = req.context.client;

        if (isRecurring) {
          const [hours, mins] = (flat.time?.selected_time ?? '00:00').split(':').map(Number);
          const timeOfDay = hours * 60 + mins;
          const days: number[] = (flat.days?.selected_options ?? []).map((o: any) => Number(o.value));
          const endDate = new Date(flat.end_date?.selected_date ?? '');
          endDate.setUTCHours(23, 59, 59, 0);
          const endUnix = Math.floor(endDate.getTime() / 1000);
          const startUnix = Math.floor(Date.now() / 1000);

          const series = await env.DB.prepare(
            'INSERT INTO meeting_series (name, description, days_of_week, time_of_day, end_date) VALUES (?, ?, ?, ?, ?) RETURNING id'
          ).bind(name, description, JSON.stringify(days), timeOfDay, endUnix).first<{ id: number }>();

          if (!series) return;

          for (const scheduled_at of generateDates(days, timeOfDay, startUnix, endUnix)) {
            const post = await client.chat.postMessage({
              channel: channelId,
              text: `New meeting: ${name}`,
              blocks: buildAnnouncementBlocks({ id: 0, name, description, scheduled_at }, { yes: 0, maybe: 0, no: 0 }),
            });
            await env.DB.prepare(
              'INSERT INTO meeting (series_id, name, description, scheduled_at, channel_id, message_ts) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(series.id, name, description, scheduled_at, (post as any).channel, (post as any).ts).run();
          }
        } else {
          const scheduled_at: number = flat.datetime?.selected_date_time ?? 0;
          const post = await client.chat.postMessage({
            channel: channelId,
            text: `New meeting: ${name}`,
            blocks: buildAnnouncementBlocks({ id: 0, name, description, scheduled_at }, { yes: 0, maybe: 0, no: 0 }),
          });
          await env.DB.prepare(
            'INSERT INTO meeting (name, description, scheduled_at, channel_id, message_ts) VALUES (?, ?, ?, ?, ?)'
          ).bind(name, description, scheduled_at, (post as any).channel, (post as any).ts).run();
        }
      } catch (err) {
        console.error('new_meeting error:', err);
      }
    },
  );

  for (const status of ['yes', 'maybe', 'no'] as const) {
    slackApp.action(`rsvp_${status}`, async ({ context, payload }) => {
      const meetingId = Number((payload as any).actions[0].value);
      const meeting = await env.DB.prepare('SELECT name FROM meeting WHERE id = ?')
        .bind(meetingId).first<{ name: string }>();
      await context.client.views.open({
        trigger_id: (payload as any).trigger_id,
        view: buildRsvpModal(meetingId, status, meeting?.name ?? 'this meeting'),
      });
    });
  }

  slackApp.viewSubmission(
    'rsvp_modal',
    async () => ({ response_action: 'clear' }),
    async (req) => {
      try {
        const { meetingId, status } = JSON.parse(req.payload.view.private_metadata ?? '{}');
        const flat = flattenState(req.payload.view.state.values);
        const note: string = flat.note?.value ?? '';
        const userId = req.payload.user.id;

        await env.DB.prepare(`
          INSERT INTO attendance (meeting_id, user_id, status, note)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (meeting_id, user_id) DO UPDATE SET status = excluded.status, note = excluded.note
        `).bind(meetingId, userId, status, note).run();

        const rows = await env.DB.prepare(
          'SELECT status, COUNT(*) as cnt FROM attendance WHERE meeting_id = ? GROUP BY status'
        ).bind(meetingId).all<{ status: string; cnt: number }>();

        const counts = { yes: 0, maybe: 0, no: 0 };
        for (const row of rows.results) {
          counts[row.status as 'yes' | 'maybe' | 'no'] = Number(row.cnt);
        }

        const meeting = await env.DB.prepare(
          'SELECT id, name, description, scheduled_at, channel_id, message_ts FROM meeting WHERE id = ?'
        ).bind(meetingId).first<{ id: number; name: string; description: string; scheduled_at: number; channel_id: string; message_ts: string }>();

        if (meeting) {
          await req.context.client.chat.update({
            channel: meeting.channel_id,
            ts: meeting.message_ts,
            text: `Meeting: ${meeting.name}`,
            blocks: buildAnnouncementBlocks(meeting, counts),
          });
        }
      } catch (err) {
        console.error('rsvp_modal error:', err);
      }
    },
  );
};

export default meetings;
