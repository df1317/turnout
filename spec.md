# Sirsnap — Feature Spec

## Overview

Slack bot for FRC Team 1317 Digital Fusion, running on Cloudflare Workers with a D1 database. Features are split into individual files under `src/features/`, each exporting a default `async (slackApp, env) => void` function that registers handlers.

---

## Database Schema

```sql
-- Component Design Teams
CREATE TABLE IF NOT EXISTS cdt (
  id          TEXT PRIMARY KEY,        -- Slack usergroup ID (e.g. S0123ABC)
  name        TEXT NOT NULL UNIQUE,
  handle      TEXT NOT NULL UNIQUE,    -- Slack @handle (slugified)
  channel_id  TEXT NOT NULL
);

-- One CDT per user enforced by PK on user_id
CREATE TABLE IF NOT EXISTS cdt_member (
  user_id  TEXT NOT NULL,
  cdt_id   TEXT NOT NULL REFERENCES cdt(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id)
);

-- Recurring meeting series
CREATE TABLE IF NOT EXISTS meeting_series (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  days_of_week TEXT    NOT NULL,  -- JSON array of ints 0-6 (Sun=0)
  time_of_day  INTEGER NOT NULL,  -- minutes since midnight UTC
  end_date     INTEGER NOT NULL   -- unix timestamp
);

-- Individual meeting instances (one-off or part of a series)
CREATE TABLE IF NOT EXISTS meeting (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id    INTEGER REFERENCES meeting_series(id) ON DELETE SET NULL,
  name         TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  scheduled_at INTEGER NOT NULL,  -- unix timestamp
  channel_id   TEXT    NOT NULL,  -- where the announcement was posted
  message_ts   TEXT    NOT NULL,  -- Slack message ts for chat.update
  cancelled    INTEGER NOT NULL DEFAULT 0
);

-- RSVP per meeting per user
CREATE TABLE IF NOT EXISTS attendance (
  meeting_id INTEGER NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  user_id    TEXT    NOT NULL,
  status     TEXT    NOT NULL CHECK(status IN ('yes', 'maybe', 'no')),
  note       TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (meeting_id, user_id)
);
```

---

## File Structure

```
schema.sql
src/
  index.ts                  — wires features, exports Env type
  Utils.ts                  — keep getYYYYMMDD
  features/
    index.ts                — re-exports all features
    hello.ts                — /hello command (unchanged)
    meetings.ts             — meeting creation + RSVP (full rewrite)
    roles.ts                — /setrole command (new)
    cdt.ts                  — /cdt command (new)
  lib/
    admin.ts                — isAdmin / requireAdmin helpers
    recurrence.ts           — generateDates helper
```

`attendance.ts` is removed — RSVP is handled in `meetings.ts`.

---

## Slack Profile Fields

| Field | ID |
|---|---|
| Role | `Xf040NQZR2F6` |
| CDT  | `Xf040HCJKNJZ` |

Valid roles: `student`, `parent`, `alumni`, `mentor`

---

## `src/lib/admin.ts`

```typescript
import { SlackAPIClient } from 'slack-web-api-client';

async function isAdmin(client: SlackAPIClient, userId: string): Promise<boolean>
// calls users.info({ user: userId }), returns is_admin || is_owner

async function requireAdmin(
  client: SlackAPIClient,
  userId: string,
  respond: (msg: { response_type: string; text: string }) => Promise<void>
): Promise<boolean>
// calls isAdmin; if false, sends ephemeral "❌ Only workspace admins can do that." and returns false
```

---

## `src/lib/recurrence.ts`

```typescript
function generateDates(
  days: number[],          // JS day-of-week 0=Sun..6=Sat
  timeOfDayMinutes: number, // minutes since midnight UTC
  startUnix: number,        // inclusive
  endUnix: number           // inclusive
): number[]                 // sorted unix timestamps (seconds)
```

Walk day-by-day from `startUnix` to `endUnix`. For each day whose `getUTCDay()` is in `days`, compute `dayStartUnix + timeOfDayMinutes * 60`. Include if `>= startUnix && <= endUnix`.

---

## Feature: Meetings (`src/features/meetings.ts`)

### Commands & Handlers

| Type | ID | Auth |
|---|---|---|
| command | `/newmeeting` | admin only |
| action | `repeat_toggle` | any |
| viewSubmission | `new_meeting` | any |
| action | `rsvp_yes` | any |
| action | `rsvp_maybe` | any |
| action | `rsvp_no` | any |
| viewSubmission | `rsvp_modal` | any |

### `/newmeeting`

- ack: void
- lazy:
  1. `requireAdmin` — return if false
  2. `context.client.views.open({ trigger_id, view: buildNewMeetingModal(false) })`

### Modal: `buildNewMeetingModal(isRecurring: boolean): ModalView`

`callback_id: "new_meeting"`

**Non-recurring blocks:**
1. `input` — plain_text_input, `action_id: "name"`, label "Meeting name"
2. `input` — plain_text_input multiline, `action_id: "description"`, label "Description", optional
3. `input` — channels_select, `action_id: "channel"`, label "Post to channel"
4. `input` — datetimepicker, `action_id: "datetime"`, label "Date & Time"
5. `actions` — checkboxes (single option value `"recurring"`), `action_id: "repeat_toggle"`, label "Repeat weekly"

**Recurring blocks:** replace 4–5 with:
4. `actions` — same checkboxes but `initial_options` set
5. `input` — checkboxes of days (options `"0"`–`"6"` → Sun–Sat), `action_id: "days"`, label "Repeat on"
6. `input` — timepicker, `action_id: "time"`, label "Time of day"
7. `input` — datepicker, `action_id: "end_date"`, label "Repeat until"

### `repeat_toggle` action

- ack: void
- lazy: `context.client.views.update({ view_id: payload.view.id, hash: payload.view.hash, view: buildNewMeetingModal(isRecurring) })`
  where `isRecurring = payload.actions[0].selected_options.length > 0`

### `new_meeting` viewSubmission

- ack: `{ response_action: "clear" }`
- lazy:
  1. Flatten `state.values` into `Record<actionId, stateValue>` by iterating all block entries
  2. Extract: `name`, `description`, `channel`, and either `datetime` (one-off) or `days[]`, `time` (HH:MM → minutes), `end_date` (YYYY-MM-DD → unix)
  3. Determine `isRecurring` by checking if `flat["days"]` exists
  4. **One-off:** post announcement → get `{ ts, channel }` → INSERT meeting
  5. **Recurring:** INSERT meeting_series → `generateDates(...)` → for each date: post announcement → INSERT meeting (sequential, not parallel, to respect Slack rate limits)

Announcement is posted via `req.context.client.chat.postMessage`.

### Announcement blocks: `buildAnnouncementBlocks(meeting, counts)`

```
section:  *{name}*\n{description}\n\n📅 <!date^{unix}^{date_long_pretty} at {time}|fallback>
context:  ✅ {yes} going · 🤔 {maybe} maybe · ❌ {no} can't make it
divider
actions:
  button  "✅ Yes"   action_id: "rsvp_yes"   value: "{meetingId}"  style: "primary"
  button  "🤔 Maybe" action_id: "rsvp_maybe"  value: "{meetingId}"
  button  "❌ No"    action_id: "rsvp_no"     value: "{meetingId}"  style: "danger"
```

### `rsvp_yes / rsvp_maybe / rsvp_no` actions

- ack: void
- lazy:
  1. `meetingId = payload.actions[0].value`
  2. `status = action_id.replace("rsvp_", "")` → `"yes" | "maybe" | "no"`
  3. Fetch meeting name from DB
  4. `context.client.views.open({ trigger_id: payload.trigger_id, view: buildRsvpModal(meetingId, status, meetingName) })`

### Modal: `buildRsvpModal(meetingId, status, meetingName): ModalView`

`callback_id: "rsvp_modal"`
`private_metadata: JSON.stringify({ meetingId, status })`

Blocks:
1. `section` — "You're responding **{status}** to **{meetingName}**."
2. `input` — plain_text_input multiline, `action_id: "note"`, label "Note (optional)", optional

### `rsvp_modal` viewSubmission

- ack: `{ response_action: "clear" }`
- lazy:
  1. `{ meetingId, status }` from `private_metadata`
  2. `userId = req.payload.user.id`
  3. `note = flat["note"].value ?? ""`
  4. DB upsert into `attendance`
  5. Fetch updated counts (GROUP BY status)
  6. Fetch `meeting` row for `channel_id`, `message_ts`, `name`, `description`, `scheduled_at`
  7. `req.context.client.chat.update({ channel, ts, text: "Meeting: {name}", blocks: buildAnnouncementBlocks(...) })`

---

## Feature: Roles (`src/features/roles.ts`)

### Commands & Handlers

| Type | ID | Auth |
|---|---|---|
| command | `/setrole` | admin only |

### `/setrole`

Usage: `/setrole @user <role>`

- ack: void
- lazy:
  1. `requireAdmin` — return if false
  2. Parse `payload.text`: split on whitespace; `parts[0]` → extract userId via `/^<@([A-Z0-9]+)/`; `parts[1]` → role
  3. Validate — if format wrong or role not in `['student', 'parent', 'alumni', 'mentor']`, respond with usage hint
  4. `context.client.users.profile.set({ user: targetUserId, profile: { "Xf040NQZR2F6": role } })`
  5. Respond: `✅ Set <@{targetUserId}>'s role to \`{role}\`.`

---

## Feature: CDTs (`src/features/cdt.ts`)

### Commands & Handlers

| Type | ID | Auth |
|---|---|---|
| command | `/cdt` | admin only |
| viewSubmission | `cdt_create` | admin only |
| viewSubmission | `cdt_edit` | admin only |

### `/cdt` dispatch

Subcommands (parsed from `payload.text`):
- `create` → open create modal
- `edit <name>` → lookup CDT, open edit modal
- `list` → ephemeral list
- anything else → usage help

All require admin (check once at top before dispatch).

### Modal: `buildCdtCreateModal(): ModalView`

`callback_id: "cdt_create"`

Blocks:
1. `input` — plain_text_input, `action_id: "cdt_name"`, label "CDT Name"
2. `input` — channels_select, `action_id: "cdt_channel"`, label "Channel"
3. `input` — multi_users_select, `action_id: "cdt_members"`, label "Members"

### Modal: `buildCdtEditModal(cdt, memberIds): ModalView`

`callback_id: "cdt_edit"`
`private_metadata: JSON.stringify({ cdtId: cdt.id })`

Same blocks as create but with `initial_value`, `initial_channel`, `initial_users` pre-filled.

### `cdt_create` viewSubmission

- ack: `{ response_action: "clear" }`
- lazy:
  1. Parse: `name`, `channel_id`, `members[]`
  2. Check name uniqueness in DB — error if taken
  3. `handle = slugify(name)` (lowercase, non-alphanumeric → `-`)
  4. `const ugRes = await req.context.client.usergroups.create({ name, handle, channels: channel_id })`
  5. `usergroupId = ugRes.usergroup.id`
  6. DB INSERT cdt
  7. DB INSERT cdt_member for each member `ON CONFLICT(user_id) DO UPDATE SET cdt_id=excluded.cdt_id`
  8. `req.context.client.usergroups.users.update({ usergroup: usergroupId, users: members })`
  9. For each member: `users.profile.set({ user: memberId, profile: { "Xf040HCJKNJZ": name } })`
  10. Respond: `✅ Created CDT *{name}* with {n} members.`

### `cdt_edit` viewSubmission

- ack: `{ response_action: "clear" }`
- lazy:
  1. `cdtId` from `private_metadata`
  2. Parse: `new_name`, `new_channel_id`, `new_members[]`
  3. Fetch current members from DB
  4. `added = new_members - current`, `removed = current - new_members`
  5. DB UPDATE cdt name + channel_id
  6. DB upsert cdt_member for added; DELETE FROM cdt_member WHERE user_id IN removed AND cdt_id = cdtId
  7. `usergroups.users.update({ usergroup: cdtId, users: new_members })` (pass `""` if empty)
  8. For added: `users.profile.set` CDT field to new CDT name
  9. For removed: `users.profile.set` CDT field to `""`
  10. Respond: `✅ Updated CDT *{name}*.`

### `cdt list` lazy handler

```sql
SELECT c.id, c.name, COUNT(m.user_id) as member_count
FROM cdt c LEFT JOIN cdt_member m ON m.cdt_id = c.id
GROUP BY c.id
```

Respond ephemeral, one line per CDT: `*{name}* — {n} members  <!subteam^{id}>`

---

## Edge Cases

- **Rate limits:** Post recurring meeting announcements sequentially (not `Promise.all`) to respect Slack's ~1 req/s limit on `chat.postMessage`.
- **Empty usergroup:** `usergroups.users.update` with empty members — pass `users: ""`.
- **`trigger_id` expiry:** `views.open` must be called within 3s of user interaction. Use lazy handlers which start immediately after ack.
- **`views.update` in actions:** Put in lazy handler so ack is instant.
- **State value parsing:** Flatten `state.values` by iterating all block entries keyed on `action_id` — robust against Slack's auto-generated `block_id`s.
- **CDT profile field:** Store the CDT name (not ID) in the profile field `Xf040HCJKNJZ` so it's human-readable in Slack profiles.
- **handle conflicts:** If `usergroups.create` fails with `handle_taken`, append a short suffix (e.g. `-2`).
