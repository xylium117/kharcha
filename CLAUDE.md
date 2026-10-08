# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

Kharcha is a pocket-money expense tracker for one user (Sinchan, a Statistics Hons. student in India; amounts are in INR). It includes an AI mentor (an owl) that was renamed from "Guru" to "Sinchan", the same name as the user; code identifiers like `GURU_SYSTEM` / `GURU_MODEL` and the `/guide` route keep the old name. It's a Next.js 16 (App Router, Turbopack) + React 19 + Tailwind v4 app. **All user data lives in the browser (IndexedDB via Dexie)**: there's no backend database and no login. Phone and laptop each keep their own data, synced manually through the JSON backup in Settings. Don't add cloud storage or auth unless asked.

The app was renamed from "Paisa Pal" to "Kharcha". The folder, package name, IndexedDB name (`paisa-pal`) and backup-file `app` id still say `paisa-pal` on purpose: renaming the database or backup id would orphan existing data and backups.

## Commands

Node lives at `~/.local/node`, so prefix shell commands with `export PATH="$HOME/.local/node/bin:$PATH"`. Don't run `python3` on this Mac: it triggers an Xcode CLT install prompt.

```bash
npm run dev                         # dev server on :3000 (prints a Network URL for phones on the same Wi-Fi)
npm test                            # all Vitest unit tests (tests/**/*.test.ts, node env, `@` → src)
npx vitest run tests/stats.test.ts  # one file;  add -t "welchTTest" for one test
npx tsc --noEmit                    # type-check (run `npx next typegen` first if RouteContext types are missing)
npm run lint                        # ESLint incl. React Compiler rules (react-hooks/purity, set-state-in-effect)
npm run build                       # production build; can run while `next dev` is up (dev uses .next/dev)
```

The preview launcher can't start `next dev` itself: macOS privacy blocks it from reading files on the Desktop (`EPERM`), and Bash background tasks die after 2 hours. Start the server in the user's Terminal panel (`run_in_terminal` with `PATH="$HOME/.local/node/bin:$PATH" npm run dev`), then `preview_start` the `paisa-pal` entry in `../.claude/launch.json`, which attaches to http://localhost:3000. To reset local test data, delete the `paisa-pal` IndexedDB in the page and reload; onboarding offers seeded demo data (`src/lib/demo.ts`).

## Users

The app is shared with a few friends for a 3-month test. Each device has its own data, and the AI sees each person as themselves: never hard-code Sinchan's identity in prompts or UI (the owl mascot is also called "Sinchan"). Feedback goes to the external form at `NEXT_PUBLIC_FEEDBACK_URL` (see `src/lib/feedback.ts`). Schema changes must migrate testers' existing data.

## Architecture

**Client-only data layer.** Every page is a `"use client"` component reading Dexie through `useLiveQuery` hooks in `src/lib/hooks.ts`:
- `useSettings()` returns `undefined` while loading and `null` before onboarding.
- `AppShell` gates the whole app on that value: a splash screen, then `Onboarding`, then the app.

Pages therefore render nothing on the server, so reading `localStorage` in lazy state initializers is safe.

The schema is in `src/lib/db.ts`. To change indexes, add a new `this.version(n)` block; never edit an existing version. When adding a table, also update `TABLE_NAMES`, because backup and reset iterate over it.

**Pure logic vs. UI.** The money and stats math is pure and unit-tested. Keep it free of Dexie and React:
- **`budget.ts`** defines budget periods, which start on `monthStartDay` and can have a per-period override in `settings.budgetOverrides[yyyy-MM]`. Its `computeBudget()` is the single source for "safe to spend today":

  ```
  pool           = budget − spent before today − goal contributions this period
                   − upcoming recurring bills − goal reserve
  dailyAllowance = pool ÷ days left
  safeToday      = dailyAllowance − spent today
  ```

  Money in (`income` table: gifts, refunds, IOU repayments) adds to the pool. "They owe me" IOUs count as lent in the period they were created; `settleIous()` in `src/lib/ious.ts` turns a settled one into a repayment income entry. "I owe" IOUs never touch the pool, because my share was already logged as an expense.
  `useBudget()` wraps it, and `AppShell` shares it through context (`useUI().budget`).
- **`stats.ts`** has descriptive statistics, a hand-rolled t-distribution (incomplete beta) and Welch's test. Its `forecastPeriod()` winsorizes the daily sample at Q3 + 1.5·IQR and adds known recurring bills separately.
- **`streaks.ts` and `badges.ts`** build on `buildDayMap`. A day counts as "active" if it has an expense or is marked as a no-spend day; unlogged days are treated as missing data, not ₹0.
- **`verdict.ts`** parses the mentor's trailing `VERDICT: go|think|skip` line.

**App shell responsibilities** (`src/components/AppShell.tsx`):
- navigation: sidebar on md+, bottom bar with a center ＋ on phones
- toasts, with optional Undo actions
- the `useUI()` context: `openAdd`, `toast`, `budget`
- posting due recurring expenses on load
- the badge watcher, which unlocks badges as their conditions are met
- `AddExpenseSheet`, remounted through `key={nonce}` on every open so props seed fresh state; don't reset state in effects

To save an expense anywhere, use `useAddExpense()` from `AddExpenseSheet.tsx`, which adds the undo toast and the over-limit warning.

**AI (server-only)** lives in `src/app/api/*` with shared helpers in `src/lib/server/ai.ts`:
- **Two providers**, picked by `aiProvider()`: Gemini free tier (`GEMINI_API_KEY`, default `gemini-flash-latest`, an alias that follows Google's current Flash model because pinned versions get retired, via `@google/genai`) wins over Claude (`ANTHROPIC_API_KEY`) unless `AI_PROVIDER` forces one. The user chose free Gemini on the condition that only numbers are sent:
  - `/api/status` returns `trimSnapshot: true` for Gemini.
  - The client then calls `buildSnapshot(now, { trimmed: true })` and `metricsSummary(m, { trimmed: true })`, which leave out names, item titles, places, notes and IOU names.
  - Keep that guarantee when adding snapshot fields.
- `guard()` returns 503 when neither key is set, and enforces the optional `APP_PASSCODE` via the `x-app-passcode` header. Always set the passcode on a public deploy.
- `/api/chat` streams plain text from either `geminiChat()` or Claude (`GURU_MODEL` default `claude-sonnet-5-5`, effort `low`, `fallbacks: "default"` through the beta header).
  - The first chunk is awaited before responding, so key and rate-limit errors become JSON errors.
  - The client builds a plain-text finance snapshot (`src/lib/snapshot.ts`) and prepends it to the last user turn inside `<finance_snapshot>`.
  - The system prompt (`GURU_SYSTEM`) requires the VERDICT line for purchase questions.
- `/api/parse-expense` and `/api/weekly-report` use zod schemas:
  - Claude via `messages.parse` + `zodOutputFormat`.
  - Gemini via `geminiJSON()`: `responseJsonSchema` from `z.toJSONSchema`, retried without the schema on a 400, always validated with zod.
  - The parse category enum is built from the user's categories. `src/lib/report.ts` computes the rule-based grade sent as a hint, and is also the offline fallback.
- **Deploy target:** Vercel Hobby (free). Secrets are set with `vercel env add`; the Android install path is a PWA (manifest, `/pwa-icon/*`, `public/sw.js`).
- Client fetch helpers live in `src/lib/ai-client.ts`.
- Every AI feature must degrade gracefully when `/api/status` reports `ai: false`.

## Conventions

- **React Compiler lint rules:**
  - Call `Date.now()` in event handlers through `timestamp()` from `lib/format.ts`; in render, use `useNow()`.
  - Derive state instead of syncing it with `setState` inside effects.
- **Dates:** expenses store `ts` in epoch ms; day keys are local `yyyy-MM-dd` strings (`dayKey` / `parseDayKey`). Never parse a day key with `new Date(str)`, because that's UTC.
- **Money formatting:** use `rupee()`, which gives Indian grouping (₹1,25,000).
- **Theming:** colors are CSS variables in `globals.css`, exposed as Tailwind colors (`bg-card`, `text-muted`, `bg-accent-soft`, …). Dark mode uses `data-theme="dark"` on `<html>`, set before paint by an inline script from `localStorage['pp-theme']`.
- **Chart colors are separate from UI pastels.** The pastel category colors fail contrast and CVD checks as chart marks, so charts use the validated tokens `--chart-bar`, `--chart-over`, `--s1..3` and `--s-need/want/waste`. Category breakdowns use direct-labelled ranked bars (`RankedBars`), not color-coded pies. Charts are Recharts 3 with the `responsive` prop; `Card` has `min-w-0` so charts can shrink inside CSS grid cells.
