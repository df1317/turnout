-- Component Design Teams
CREATE TABLE IF NOT EXISTS cdt (
  id          TEXT PRIMARY KEY,       -- Slack usergroup ID
  name        TEXT NOT NULL UNIQUE,
  handle      TEXT NOT NULL UNIQUE,   -- Slack @handle (slugified)
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
  end_time     INTEGER,           -- unix timestamp (optional for backwards compatibility)
  channel_id   TEXT    NOT NULL,  -- where announcement was posted
  message_ts   TEXT    NOT NULL,  -- Slack message ts for chat.update
  cancelled    INTEGER NOT NULL DEFAULT 0
);

-- Cached Slack user profiles (refreshed every 7 days)
CREATE TABLE IF NOT EXISTS slack_user (
  user_id        TEXT    PRIMARY KEY,
  name           TEXT    NOT NULL DEFAULT '',
  avatar_url     TEXT    NOT NULL DEFAULT '',
  is_admin       INTEGER NOT NULL DEFAULT 0,
  role           TEXT    CHECK(role IN ('student', 'parent', 'alumni', 'mentor')),
  last_synced    INTEGER NOT NULL DEFAULT 0,
  calendar_token TEXT    UNIQUE
);

-- RSVP per meeting per user
CREATE TABLE IF NOT EXISTS attendance (
  meeting_id INTEGER NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  user_id    TEXT    NOT NULL,
  status     TEXT    NOT NULL CHECK(status IN ('yes', 'maybe', 'no')),
  note       TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (meeting_id, user_id)
);

-- Web login sessions
CREATE TABLE IF NOT EXISTS web_session (
  id          TEXT    PRIMARY KEY,
  user_id     TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- Generic key-value store for app settings
CREATE TABLE IF NOT EXISTS kv_store (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Generic cache for Slack API responses
CREATE TABLE IF NOT EXISTS slack_cache (
  key        TEXT PRIMARY KEY,
  value      TEXT    NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Queue for batching Slack announcement updates to prevent rate-limits
CREATE TABLE IF NOT EXISTS pending_announcement (
  meeting_id INTEGER PRIMARY KEY REFERENCES meeting(id) ON DELETE CASCADE,
  queued_at  INTEGER NOT NULL
);
