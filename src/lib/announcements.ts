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
