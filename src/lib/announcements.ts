import { SlackAPIClient } from 'slack-web-api-client';
import type { Env } from '../index';

export function buildAnnouncementBlocks(
  meeting: { id: number; name: string; description: string; scheduled_at: number },
  attendees: { yes: string[]; maybe: string[]; no: string[] },
): any[] {
  const mentionList = (ids: string[]) => ids.map(id => `<@${id}>`).join(', ');
  const contextParts: string[] = [];
  if (attendees.yes.length) contextParts.push(`✅ Going: ${mentionList(attendees.yes)}`);
  if (attendees.maybe.length) contextParts.push(`🤔 Maybe: ${mentionList(attendees.maybe)}`);
  if (attendees.no.length) contextParts.push(`❌ Can't make it: ${mentionList(attendees.no)}`);
  if (!contextParts.length) contextParts.push('No RSVPs yet');

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
      elements: [{ type: 'mrkdwn', text: contextParts.join('\n') }],
    },
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: '✅ Yes' }, action_id: 'rsvp_yes', value: String(meeting.id), style: 'primary' },
        { type: 'button', text: { type: 'plain_text', text: '🤔 Maybe' }, action_id: 'rsvp_maybe', value: String(meeting.id) },
        { type: 'button', text: { type: 'plain_text', text: '❌ No' }, action_id: 'rsvp_no', value: String(meeting.id), style: 'danger' },
      ],
    },
  ];
}

export function buildCancelledAnnouncementBlocks(
  meeting: { name: string; description: string; scheduled_at: number },
): any[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `~*${meeting.name}*~${meeting.description ? `\n~${meeting.description}~` : ''}\n\n~📅 <!date^${meeting.scheduled_at}^{date_long_pretty} at {time}|${new Date(meeting.scheduled_at * 1000).toISOString()}>~`,
      },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '🚫 This meeting has been cancelled.' }],
    },
  ];
}

export async function updateAnnouncement(
  client: any,
  db: D1Database,
  meeting: { id: number; name: string; description: string; scheduled_at: number; channel_id: string; message_ts: string; cancelled: number },
): Promise<void> {
  if (!meeting.message_ts) return;
  if (meeting.cancelled) {
    await client.chat.update({
      channel: meeting.channel_id,
      ts: meeting.message_ts,
      text: `[Cancelled] ${meeting.name}`,
      blocks: buildCancelledAnnouncementBlocks(meeting),
    });
    return;
  }
  const attendanceRows = await db.prepare('SELECT user_id, status FROM attendance WHERE meeting_id = ?')
    .bind(meeting.id).all<{ user_id: string; status: string }>();
  const attendees = { yes: [] as string[], maybe: [] as string[], no: [] as string[] };
  for (const row of attendanceRows.results) {
    attendees[row.status as 'yes' | 'maybe' | 'no'].push(row.user_id);
  }
  await client.chat.update({
    channel: meeting.channel_id,
    ts: meeting.message_ts,
    text: `Meeting: ${meeting.name}`,
    blocks: buildAnnouncementBlocks(meeting, attendees),
  });
}

export async function checkPendingMeetings(env: Env) {
  const now = Math.floor(Date.now() / 1000);
  const twoWeeksInSeconds = 14 * 24 * 60 * 60;
  const threshold = now + twoWeeksInSeconds;

  // Find meetings that:
  // - Have a channel_id set
  // - Don't have a message_ts yet (haven't been announced)
  // - Are scheduled to happen within the next 2 weeks
  // - Haven't happened yet (scheduled_at > now)
  // - Aren't cancelled
  const pending = await env.DB.prepare(
    `SELECT id, name, description, scheduled_at, channel_id 
     FROM meeting 
     WHERE channel_id IS NOT NULL 
       AND message_ts IS NULL 
       AND cancelled = 0 
       AND scheduled_at > ?
       AND scheduled_at <= ?`
  ).bind(now, threshold).all<{ id: number; name: string; description: string; scheduled_at: number; channel_id: string }>();

  if (!pending.results.length) return;

  const botClient = new SlackAPIClient(env.SLACK_BOT_TOKEN);

  for (const meeting of pending.results) {
    try {
      await botClient.conversations.join({ channel: meeting.channel_id }).catch(() => {});
      
      const blocks = buildAnnouncementBlocks(meeting, { yes: [], maybe: [], no: [] });
      const posted = await botClient.chat.postMessage({
        channel: meeting.channel_id,
        text: `Meeting: ${meeting.name}`,
        blocks,
      }) as { ts?: string };

      if (posted.ts) {
        await env.DB.prepare(
          'UPDATE meeting SET message_ts = ? WHERE id = ?'
        ).bind(posted.ts, meeting.id).run();
      }
    } catch (err) {
      console.error(`Failed to announce pending meeting ${meeting.id}:`, err);
    }
  }
}
