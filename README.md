# Kharcha 💸

> **Pocket money tracker built for students.**  
> Log expenses in seconds, stay on budget, and let Stash the owl talk you out of bad purchases.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Firebase](https://img.shields.io/badge/Firebase-13-FFA611?logo=firebase&logoColor=white)](https://firebase.google.com)
[![PWA](https://img.shields.io/badge/PWA-Installable-5A0FC8?logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps)
[![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-black?logo=vercel)](https://vercel.com)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## Overview

**Kharcha** (Hindi: *expenditure*) is a privacy-first Progressive Web App that helps students track daily spending, visualise habits, and build better money discipline — without subscriptions, ads, or data harvesting.

All data is stored locally in the browser using IndexedDB (Dexie). Google account sync is optional and end-user controlled.

---

## Features

### 💰 Daily Expense Logging
- One-tap quick buttons for recurring expenses (Tea, Bus, Canteen, etc.)
- 10 built-in categories with custom emoji and colour support
- Need / Want / Waste tagging and mood tracking per entry
- Payment mode tracking (UPI, Cash, Card)
- No-spend day marking

### 📊 Stats Lab
- Category breakdown and daily spend charts (Recharts)
- Logging streak and under-limit streak counters
- Month-end budget forecast
- Season-aware budgeting (normal / academic / vacation)

### 🎯 Goals
- Create savings goals with a target amount and deadline
- Reserve a portion of the monthly budget for each goal
- Log contributions and track progress visually

### 🤝 Splits & IOUs
- Split bills among friends and track who owes what
- Settle IOUs with one tap

### 🤔 Should I Buy It?
- Impulse-purchase checker powered by Stash the owl (AI)
- 24-hour cool-off wishlist — skip an item to earn the *Impulse Slayer* badge

### 🏅 Gamification
14 collectible badges reward consistent tracking behaviour:

| Badge | Condition |
|---|---|
| 🐣 First Log | Log your very first expense |
| 🔥 Warming Up | 3-day logging streak |
| 📆 Habit Builder | 7-day logging streak |
| 🚀 Unstoppable | 30-day logging streak |
| 🐷 7-Day Saver | Under daily limit 7 days in a row |
| 🥦 No-Junk Week | Full week without a 'waste' expense |
| 0️⃣ Zero Hero | Mark a no-spend day |
| 🎯 Goal Getter | Complete a savings goal |
| 🥷 Budget Ninja | Finish a whole month under budget |
| 🤓 Stats Nerd | Open Stats Lab 5 times |
| 🦉 Curious Mind | Ask Stash 10 questions |
| 🤝 Fair & Square | Settle 5 IOUs |
| 🗡️ Impulse Slayer | Skip a wishlist item after 24 h |
| 💯 Centurion | Log 100 expenses |

### ☁️ Cloud Sync
- Optional Google Sign-in with persistent account selection
- Debounced auto-sync with Firestore (triggers on change, every 2.5 min, on focus, and on reconnect)
- Atomic pull transactions — no partial data writes

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| Local DB | Dexie (IndexedDB) |
| Auth & Sync | Firebase v13 (Auth + Firestore) |
| AI | Claude + Gemini + Groq |
| Charts | Recharts |
| Animation | Framer Motion |
| PWA | Serwist (Workbox) |
| Analytics | Vercel Analytics |
| Deployment | Vercel |

---

## Getting Started

### Prerequisites

- Node.js >= 20
- A Firebase project with **Authentication** (Google provider) and **Firestore** enabled
- An Anthropic API key (optional — for Stash AI features)

### 1. Clone & install

```bash
git clone https://github.com/xylium117/kharcha.git
cd kharcha
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in your Firebase and Anthropic credentials:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
ANTHROPIC_API_KEY=...
```

### 3. Run locally

```bash
npm run dev
```

Open http://localhost:3000.

### 4. Build for production

```bash
npm run build
npm start
```

The production build generates `public/sw.js` — the pre-caching service worker.

---

## Deployment

The app is designed for one-click Vercel deployment.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/xylium117/kharcha)

Set the environment variables listed above in the Vercel project settings. The service worker is automatically generated at build time.

---

## Project Structure

```
src/
├── app/                 # Next.js App Router pages
│   ├── page.tsx         # Dashboard (home)
│   ├── stats/           # Stats Lab
│   ├── goals/           # Savings goals
│   ├── splits/          # Splits & IOUs
│   ├── buy/             # Should I buy it?
│   ├── history/         # Full expense history
│   ├── reports/         # Monthly reports
│   ├── guide/           # User guide
│   └── settings/        # Settings & profile
├── components/
│   ├── AppShell.tsx     # Navigation, badge watcher, layout
│   ├── ui.tsx           # Design system components
│   ├── CloudSyncStatus.tsx
│   └── Mascot.tsx       # Stash the owl
└── lib/
    ├── db.ts            # Dexie schema
    ├── sync.ts          # Cloud sync engine
    ├── firebase.ts      # Firebase initialisation
    ├── badges.ts        # Badge definitions & evaluation
    ├── budget.ts        # Budget & period calculations
    ├── streaks.ts       # Streak logic
    ├── ai-client.ts     # Stash integration
    └── hooks.ts         # Shared React hooks
```

---

## Privacy

- No third-party analytics beyond aggregate Vercel traffic metrics
- No ads, no data selling
- All financial data lives on the user's device in IndexedDB
- Cloud sync is opt-in — data goes only to the user's own Firestore document, keyed by their UID
- Right-click and text selection are disabled to discourage casual data harvesting from shared screens

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

---

## License

MIT © 2026
