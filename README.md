# HomeDasher Backend


Node.js backend for homedasher.net — deployed on Vercel.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/chat` | POST | AI chat proxy (Anthropic) |
| `/api/submit` | POST | Create booking, charge Stripe, create Jobber job |
| `/api/magic-link` | POST | Send login link via email or SMS |
| `/api/verify` | GET | Validate magic token, return customer + chore list |
| `/api/rate` | POST | Submit post-service rating |
| `/api/tip` | POST | Process optional tip after high rating |
| `/api/referral` | GET/POST | Referral code lookup and credit application |
| `/api/workers` | GET/POST | Worker portal — list jobs, claim, request, approve |
| `/api/cron` | GET | Background job — alert/auto-cancel unassigned bookings |

## Setup

1. Clone the repo
2. Copy `.env.example` to `.env` and fill in all keys
3. Run `npm install`
4. Set up Supabase tables using `supabase-schema.sql`
5. Deploy to Vercel — add all env vars in Vercel dashboard

## Environment Variables

See `.env.example` for all required variables.
Never commit `.env` to GitHub.

## Cron Job

The `/api/cron` endpoint runs every 15 minutes via Vercel Cron (configured in `vercel.json`).
It checks for unassigned bookings and:
- Alerts admin after `UNCLAIMED_ALERT_HOURS` (default: 2)
- Auto-cancels and refunds after `UNCLAIMED_AUTOCANCEL_HOURS` (default: 4)

## Worker Tiers

- **Trial** — Can request jobs, needs owner approval before assignment
- **Vetted** — Can self-assign (claim) jobs instantly

Promote a worker from trial → vetted via the admin panel or by updating `tier` in Supabase.
