# 🍼 Nanny Bot

> Track every feed and nappy change right inside Telegram — built for sleep-deprived parents who need one-tap logging at 3am.

**[→ Open the bot on Telegram](https://t.me/YourBotUsername)** · **[→ Website](https://colonelsanders90.github.io/baby-nanny-bot)**

![logo](logo.png)

---

## Features

### Logging
- **Feed logging** — tap a quick ml preset (90 / 100 / 110 / 120 ml) or type any amount; set the time in one tap (just now, or up to 60 min ago, or type HH:MM for up to 12h back)
- **Nappy logging** — wet, dirty, or both; same time picker
- **Delete entries** — tap to remove any recent event

### Status & history
- **Live status** — last feed, time since, and next feed countdown
- **Last 5** — recent feeds and nappy changes with interval deltas
- **Daily snapshot** — full day view with ◀ ▶ navigation between days

### Sleep & wake tracking
- **Log asleep / awake** — tap 😴 Asleep when baby drifts off and 👶 Awake when they stir; same flexible time picker as feeds
- **Wake window chart** — 14-day scatter plot of each wake→sleep period, showing how long baby stayed awake each time

### Insights & trends
- **Activity heatmap** — GitHub-style 8-week grid for feed volume (ml/day, green) and nappy frequency (changes/day, amber)
- **Feed vs Sleep** — 14-day bar chart: feeds per day + average sleep gap between feeds
- **Feed Timing** — 14-day dot plot: each row a day, each dot a feed at its local time — spots emerging routines
- **ml vs Sleep** — 60-day scatter chart with trend line: does feed volume correlate to longer sleep?
- **Wake Windows** — 14-day scatter plot: each dot is a wake window (time awake between waking and falling asleep)

### Smart reminders
- Prep nudge at 2h 30min after last feed
- Feed reminder at 3h after last feed, with last ml amount in the message

### Partner sharing
- `/share` generates a one-time link code (expires after 24h)
- `/join <code>` links two chats to the same baby data — either parent can log, both see everything

### Other
- Configurable baby name — asked on first `/start`, stored per chat group
- Multi-tenant safe — all data is scoped to a primary chat ID

---

## Charts

| Chart | Period | What it shows |
|---|---|---|
| Activity Heatmap | 8 weeks | Daily feed ml (green) and nappy count (amber) in GitHub-style grid |
| Feed vs Sleep | 14 days | Feeds per day + avg hours between feeds |
| Feed Timing | 14 days | Dot plot of feed times — routine detection |
| ml vs Sleep | 60 days | Scatter + trend line: feed volume vs subsequent sleep duration |
| Wake Windows | 14 days | Scatter plot of wake durations (wake→sleep periods) |

---

## Commands

| Command | Description |
|---|---|
| `/start` | Start the bot (asks for baby name on first run) |
| `/menu` | Show the quick-action keyboard |
| `/fed` | Log a feed |
| `/nappy` | Log a nappy change |
| `/status` | Last feed & nappy summary |
| `/last5` | Last 5 feeds and nappy changes |
| `/daily` | Today's full day snapshot with navigation |
| `/history` | Yesterday's snapshot |
| `/trends` | 8-week heatmap + trend chart menu (incl. wake windows) |
| `/delete` | Delete a recent entry |
| `/share` | Generate a link code for your partner |
| `/join <code>` | Join your partner's tracker |
| `/help` | Show all commands |

---

## Stack

- **Runtime** — Node.js + TypeScript
- **Bot framework** — [Grammy](https://grammy.dev)
- **Database** — PostgreSQL (`pg`)
- **Scheduling** — `node-cron`
- **Chart rendering** — `@napi-rs/canvas` (Skia) + `@fontsource/roboto`
- **Deployment** — [Railway](https://railway.app)

---

## Setup

### Prerequisites

- Node.js 18+
- A PostgreSQL database
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | — | Token from @BotFather |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `TIMEZONE` | optional | `Asia/Singapore` | IANA timezone for display and date bucketing |
| `ALLOWED_CHAT_IDS` | optional | *(open)* | Comma-separated chat IDs to restrict access |
| `DATABASE_SSL_MODE` | optional | `verify` | SSL mode: `verify`, `no-verify`, or `disable` |

> **Note:** Leaving `ALLOWED_CHAT_IDS` unset opens the bot to all Telegram users. Set it for private use.

### Local development

```bash
git clone https://github.com/colonelsanders90/baby-nanny-bot.git
cd baby-nanny-bot
npm install
cp .env.example .env   # fill in TELEGRAM_BOT_TOKEN and DATABASE_URL
npm run dev
```

### Deploy to Railway

1. Create a new Railway project and add a **PostgreSQL** service
2. Set `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`, `TIMEZONE`, and `ALLOWED_CHAT_IDS` in the Railway dashboard
3. Connect your GitHub repo — Railway builds and deploys on push

The bot uses long polling (no webhook setup required).

---

## Database

Tables and indexes are created automatically on first startup via `initDb()`:

| Table | Purpose |
|---|---|
| `events` | Feed and nappy log entries |
| `chats` | Registered chats with baby name and auth status |
| `link_codes` | One-time partner linking codes (24h expiry) |
| `chat_links` | Maps secondary chats to a primary chat |

Indexes on `events(chat_id, logged_at DESC)` and `chat_links(chat_id)` are created on startup.

---

## Project structure

```
src/
  index.ts    — bot logic, commands, callbacks, cron reminders
  db.ts       — PostgreSQL helpers and validated write functions
  charts.ts   — chart generators (heatmap, bar, scatter, dot plot → PNG buffer)
docs/
  index.html  — marketing landing page (GitHub Pages)
  screenshots/
    heatmap.png
    feed-sleep.png
    timing.png
    ml-sleep.png
```

---

## Security

- All database writes are parameterised (no SQL injection surface)
- Chat allowlist enforced on every command and callback via `guard()`
- Rate limiting on all commands (20 req/min per chat) and `/join` (5 attempts/10 min)
- Link codes expire after 24 hours
- Feed amounts validated server-side (1–600 ml)
- Backdate limit enforced at 12 hours
- SSL mode configurable via `DATABASE_SSL_MODE` env var

---

## Contributing

Built for personal use but feel free to fork it for your own family. The baby name and timezone are both configurable — no hard-coded values in the code.

## License

MIT
