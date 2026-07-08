# HomeDasher Surveys

A config-driven survey system. One form page and one database table serve every
survey. To make a new survey you edit **one file** (`public/surveys.js`) — no new
pages, endpoints, or schema changes.

## Files

```
public/
  surveys.js            <- the only file you edit to add/change surveys
  survey.html           <- renderer (handles every question type + resume/review)
  survey-results.html   <- your private results viewer + CSV export
api/
  survey-save.js        <- saves a response; sends the resume link
  survey-load.js        <- loads a saved response by token
  survey-results.js     <- admin data feed (key-gated)
schema.sql              <- run once in Supabase
vercel-routes-snippet.txt
```

Drop `public/*` into wherever your static files live (same folder as your other
HTML), and `api/*` into your existing `/api` folder.

## One-time setup

1. **Database** — open the Supabase SQL editor and run `schema.sql`.

2. **Environment variables** (Vercel → Project → Settings → Environment Variables).
   Most you already have; the only new one is `SURVEY_ADMIN_KEY`.

   | Variable | Used for | Have it? |
   |---|---|---|
   | `SUPABASE_URL` | database | ✔ existing |
   | `SUPABASE_SERVICE_ROLE_KEY` | server writes | ✔ existing |
   | `RESEND_API_KEY` | email resume links | ✔ existing |
   | `RESEND_FROM` | from-address, e.g. `HomeDasher <hello@homedasher.net>` | optional |
   | `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | SMS resume links | ✔ existing |
   | `TWILIO_FROM_NUMBER` *or* `TWILIO_MESSAGING_SERVICE_SID` | SMS sender | ✔ existing |
   | `SITE_URL` | building resume links, e.g. `https://homedasher.net` | set this |
   | `SURVEY_ADMIN_KEY` | protects the results page | **new — set this** |

3. **Routing** — add the two lines from `vercel-routes-snippet.txt` to your
   `vercel.json` so `homedasher.net/intake` works.

4. **Deploy.**

## Using it

- **Public link to text out:** `https://homedasher.net/intake`
- **See responses:** `https://homedasher.net/survey-results.html` → enter your
  `SURVEY_ADMIN_KEY` and the survey id (`covid-intake`). Export CSV anytime.

## Adding another survey later

Open `surveys.js`, copy the `covid-intake` block, give it a new key and questions.
It's immediately live at `homedasher.net/s/your-new-key`. The results page and CSV
pick up the new columns automatically.

### Question types
`text` · `textarea` · `email` · `tel` · `number` · `select` · `radio` ·
`checkbox` · `yesno` · `star` · `matrix` (shared stem + Yes/No rows).

## How resume-later works

“Save & finish later” stores the answers with a random token and sends a private
link (`/survey.html?token=…`) by email (Resend) or text (Twilio). Opening it on any
device reloads the answers. After submitting, the same link shows a read-only copy
of what was sent. Sending is best-effort — a response is never lost if a message
fails to send. Same-device progress also autosaves in the browser.
