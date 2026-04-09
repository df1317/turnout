# Turnout

![screenshot of the page](https://cdn.hackclub.com/019d6a16-bcec-7720-8162-56705f73a21e/image.png)

A Slack bot built with [slack-edge](https://github.com/yusukebe/slack-edge) running on Cloudflare Workers for Team 1317 Digital Fusion. Features a full web dashboard for managing meetings, RSVPs, team members, and syncing with existing TeamSnap rosters.

## Setup

### 1. Create a Slack App

You can either:

**Option A: Use the App Manifest (Recommended)**

1. Go to [Slack API](https://api.slack.com/apps) and click "Create New App"
2. Choose "From an app manifest"
3. Select your workspace
4. Copy the contents of `manifest.yaml` and paste it
5. The manifest is already configured to use `https://turnout.bore.dunkirk.sh/slack`
6. Create the app

**Option B: Manual Setup**

1. Go to [Slack API](https://api.slack.com/apps) and create a new app
2. Under "OAuth & Permissions", add these bot token scopes:
   - `chat:write.public`
   - `channels:join`
   - `channels:read`
   - `chat:write`
   - `commands`
   - `usergroups:read`
   - `usergroups:write`
   - `users:read`
3. Add these user token scopes:
   - `usergroups:read`
   - `usergroups:write`
   - `users.profile:read`
   - `users.profile:write`
   - `users:read`

### 2. Configure Environment Variables

Create a `.dev.vars` file for local development:

```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your actual values
```

For production deployment, set secrets using Wrangler:

```bash
# Set your Slack signing secret (required)
bun wrangler secret put SLACK_SIGNING_SECRET

# Set your bot token (optional but recommended)
bun wrangler secret put SLACK_BOT_TOKEN
```

### 3. Set up Slack App Configuration

#### Slash Commands

Add slash commands in your Slack app:

- Command: `/meetings`
- Request URL: `https://turnout.bore.dunkirk.sh/slack`
- Description: "Manage meetings (admin only)"

- Command: `/setrole`
- Request URL: `https://turnout.bore.dunkirk.sh/slack`
- Description: "Set a user's role (admin only)"
- Usage hint: `[@user] [student|parent|alumni|mentor]`

- Command: `/cdt`
- Request URL: `https://turnout.bore.dunkirk.sh/slack`
- Description: "Manage Component Design Teams (admin only)"

#### Event Subscriptions

Enable event subscriptions:

- Request URL: `https://turnout.bore.dunkirk.sh/slack`
- Subscribe to bot events:
  - `app_mention`
  - `message.im`

#### Interactive Components

Enable interactive components:

- Request URL: `https://turnout.bore.dunkirk.sh/slack`

## Development

Install dependencies:

```bash
bun install
```

Start local development server:

```bash
bun dev
```

## Deployment

Deploy to Cloudflare Workers:

```bash
bun deploy
```

## Deployment for other FRC teams

Turnout can be deployed by any FRC team using Cloudflare Workers. 

1. Create a Cloudflare account
2. Initialize a D1 database: `bunx wrangler d1 create turnout`
3. Update `wrangler.jsonc` with your new database ID
4. Apply the schema: `bunx wrangler d1 execute turnout --local --file=schema.sql` and `bunx wrangler d1 execute turnout --remote --file=schema.sql`
5. Configure your Slack App following the setup steps above
6. Add your secrets:
```bash
bunx wrangler secret put SLACK_SIGNING_SECRET
bunx wrangler secret put SLACK_BOT_TOKEN
```
7. Since custom profile fields (like Role and CDT) have unique IDs per workspace, you need to configure these for your team. Find the field IDs by calling `users.profile.get` for a user and inspecting the keys under `profile.fields` (they look like `Xf040HCJKNJZ`).
8. Add these to your environment variables:
```bash
bunx wrangler secret put SLACK_PROFILE_FIELD_CDT
bunx wrangler secret put SLACK_PROFILE_FIELD_ROLE
```
9. Deploy: `bun run deploy`

## Project Structure

```
├── src/
│   ├── index.ts          # Main worker code with Slack bot logic
│   └── features/         # Modular feature implementations
│       ├── index.ts      # Feature exports
│       ├── hello.ts      # Hello command feature
│       └── attendance.ts # Attendance tracking feature
├── wrangler.jsonc        # Cloudflare Workers configuration
├── manifest.yaml         # Slack app configuration manifest
├── .dev.vars.example     # Example environment variables
└── package.json          # Dependencies and scripts
```

## Usage

1. Install the bot in your Slack workspace
2. Sync the bot via the web dashboard admin panel
3. Use the slash commands:
   - `/meetings` - Open meeting management modal
   - `/setrole [@user] [student|parent|alumni|mentor]` - Assign roles to members
   - `/cdt` - Manage CDT assignments

## Built With

- [Cloudflare Workers](https://workers.cloudflare.com/) - Serverless compute platform
- [slack-edge](https://github.com/yusukebe/slack-edge) - Slack bot framework for edge computing
- [Bun](https://bun.sh/) - JavaScript runtime and package manager

<p align="center">
    <img src="https://raw.githubusercontent.com/taciturnaxolotl/carriage/main/.github/images/line-break.svg" />
</p>

<p align="center">
    <i><code>&copy; 2026-present <a href="https://team1317.org">Team 1317 Digital Fusion</a></code></i>
</p>

<p align="center">
    <a href="https://github.com/df1317/turnout/blob/main/LICENSE.md"><img src="https://img.shields.io/static/v1.svg?style=for-the-badge&label=License&message=O'Saasy&logoColor=d9e0ee&colorA=363a4f&colorB=b7bdf8"/></a>
</p>
