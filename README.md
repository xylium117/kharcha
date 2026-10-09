# Kharcha 🦉

A pocket-money expense tracker for college students, with an AI money mentor named **Stash**.

- **Dashboard:** "safe to spend today", the month ring, streaks, quick-add buttons and recent expenses.
- **Add expenses three ways:** one-tap quick buttons, a full form, or "just type it" (e.g. `momos 120 at Dey's stall`). Each expense gets a Need / Want / Waste tag, a place, a payment mode and a mood.
- **History** with search and filters. **Reports** by month and by year, including semester (academic-year) views.
- **Stats Lab:**
  - descriptive statistics
  - histogram and box plot
  - z-score outliers
  - Welch's t-test (weekend vs weekday)
  - month-end forecast with a 95% interval and P(within budget)
  - weekday × time heatmap
- **Ask Stash:** an AI chat that sees your real numbers and gives ✅ / ⚠️ / ❌ verdicts on purchases.
- **Savings goals**, **Splits & IOUs**, **Should I buy it?** (with a 24-hour cool-off wishlist), a **weekly report card**, **badges & streaks**, and **semester modes** (exam, fest, home trip).

All data stays in your browser (IndexedDB). Nothing is uploaded, except the short summary sent to the AI when you ask Stash something.

## Run it

You need Node.js 20+. This Mac has Node 22 installed at `~/.local/node`. If `node` isn't found, run this first:

```bash
export PATH="$HOME/.local/node/bin:$PATH"
```

Then:

```bash
npm install
npm run dev
```

Open http://localhost:3000. On first launch you can start fresh or explore with 80 days of demo data.

## Stash (AI Financial Mentor)

Stash works **100% offline out-of-the-box** using a built-in intelligent engine with zero setup or API keys required. All natural-language expense parsing, chat advice, and weekly reports work directly on your device.

If you optionally want to use an external cloud LLM:
1. Copy `.env.example` to `.env.local`.
2. Set your preferred provider:
   - **Hugging Face (free):** `HF_TOKEN=...` from https://huggingface.co/settings/tokens (runs `Qwen/Qwen2.5-7B-Instruct`).
   - **Anthropic Claude (paid):** `ANTHROPIC_API_KEY=...` from https://console.anthropic.com/.
   - **Self-hosted:** `LOCAL_LLM_URL=http://localhost:11434` (Ollama or `llm/serve.py`).
3. Restart `npm run dev`.

| Provider | Chat + weekly report | "Just type it" parsing |
|---|---|---|
| Built-in (offline, 0 config) | Fast local finance-reasoning engine | Rule-based NLP parser |
| Hugging Face (free; open weights) | `Qwen/Qwen2.5-7B-Instruct` (`HF_MODEL`) | same |
| Claude (paid) | `claude-sonnet-5-5` (`GURU_MODEL`) | `claude-haiku-4-5` (`PARSER_MODEL`) |
| Local / Self-hosted | Fine-tuned Stash / Ollama (`LOCAL_LLM_URL`) | same |

`AI_PROVIDER=builtin|huggingface|claude|local` forces a specific engine.

## Put it online (free) and install on Android

1. Create a free account at https://vercel.com/signup (Hobby plan, personal non-commercial use).
2. From the `paisa-pal` folder, log in and link the project:
   ```bash
   npx vercel login
   npx vercel link
   ```
3. (Optional) Add your passcode or custom token:
   ```bash
   npx vercel env add APP_PASSCODE production
   ```
4. Deploy: `npx vercel --prod`. Vercel prints the app's address (`https://….vercel.app`).
5. On Android, open that address in Chrome → ⋮ menu → **Install app**. Then open **Settings → AI guide** in the app and enter your passcode.

Each device keeps its own data: use **Settings → Your data → Export/Import backup** to copy data from the laptop to the phone.

## Use it on your phone

- Run `npm run dev` on the Mac. The terminal prints a **Network** address like `http://192.168.x.x:3000`; open it on your phone over the same Wi-Fi.
- On iPhone, use Share → **Add to Home Screen** to get an app icon.
- Each device keeps its **own** data. To copy data across, use **Settings → Your data → Export backup** on one device and **Import backup** on the other.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm test` | Unit tests for budget math, statistics, streaks and verdict parsing (Vitest) |
| `npm run build && npm start` | Production build |
| `npm run lint` | ESLint |

## Where things live

```
src/app/            pages (/, history, reports, stats, guide, goals, splits, buy, settings) + API routes
src/app/api/        chat (streaming), parse-expense, weekly-report, status – server only
src/components/     AppShell (nav, toasts, badges), AddExpenseSheet, charts, Mascot (Stash the owl)
src/lib/budget.ts   budget periods, safe-to-spend, recurring, goal reserves
src/lib/stats.ts    descriptive stats, t-distribution, Welch test, histogram, forecast
src/lib/db.ts       Dexie (IndexedDB) schema
tests/              Vitest unit tests
```

## Sharing with friends (3-month test)

- **Every friend uses the same link** and installs it (Android: Chrome → ⋮ → Install app; the app also shows an **Install** banner). Each person's data stays on their own phone; nobody else can see it.
- **The free Gemini key is shared** behind `APP_PASSCODE`. Give friends the passcode; the chat asks for it once per device.
- **Feedback:**
  - Set `NEXT_PUBLIC_FEEDBACK_URL` (e.g. a Google Form) on Vercel and redeploy.
  - Friends then get a **Send feedback** button (Settings and the More menu) and a **weekly check-in** card from week 2.
  - **Copy my usage summary** produces anonymous counts only (days used, features tried), never amounts, items or names.
- **Updates:** redeploying updates everyone the next time they open the app. Never edit an existing Dexie schema version; add a new one, or friends' data breaks.
