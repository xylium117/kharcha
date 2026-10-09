"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { signInWithPopup } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { auth, googleProvider, firestore } from "@/lib/firebase";
import { celebrate } from "@/lib/confetti";
import { db, TABLE_NAMES } from "@/lib/db";
import { DEFAULT_CATEGORIES, DEFAULT_QUICK_BUTTONS, defaultSettings } from "@/lib/defaults";
import { Mascot } from "./Mascot";
import { Button, Input, Label } from "./ui";
import { CloudDownload, Loader2 } from "lucide-react";

export function Onboarding() {
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("6000");
  const [startDay, setStartDay] = useState("1");
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const amount = Number(budget);
  const valid = name.trim().length > 0 && amount > 0;

  async function start() {
    if (!valid) return;
    setBusy(true);
    const s = defaultSettings(name.trim(), amount);
    s.monthStartDay = Math.min(28, Math.max(1, Number(startDay) || 1));
    await db.transaction("rw", db.settings, db.categories, db.quickButtons, async () => {
      await db.categories.bulkPut(DEFAULT_CATEGORIES);
      await db.quickButtons.bulkPut(DEFAULT_QUICK_BUTTONS);
      await db.settings.put(s);
    });
    celebrate(true);
  }

  async function restoreFromCloud() {
    setRestoring(true);
    setRestoreError("");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const uid = result.user.uid;

      let totalPulled = 0;
      const pulledData: { table: string; items: any[] }[] = [];
      for (const table of TABLE_NAMES) {
        const colRef = collection(firestore, "users", uid, table);
        const snapshot = await getDocs(colRef);
        if (!snapshot.empty) {
          const items = snapshot.docs.map((d) => d.data());
          pulledData.push({ table, items });
          totalPulled += items.length;
        }
      }

      if (totalPulled === 0) {
        setRestoreError("No cloud data found for this account.");
        setRestoring(false);
        return;
      }

      const tablesToLock = TABLE_NAMES.map((n) => db.table(n));
      await db.transaction("rw", tablesToLock, async () => {
        for (const { table, items } of pulledData) {
          const dexieTable = (db as any)[table];
          if (dexieTable) {
            await dexieTable.bulkPut(items);
          }
        }
      });
      // If data was pulled, db.settings now exists and the app re-renders past Onboarding automatically
    } catch (err: any) {
      console.error("Restore from cloud error:", err);
      if (err?.code === "auth/popup-closed-by-user") {
        // User intentionally cancelled the login popup; do not show error
      } else if (err?.code === "auth/unauthorized-domain") {
        setRestoreError("Unauthorized domain: Add this domain (e.g. your Vercel URL) to Firebase Console > Authentication > Settings > Authorized domains.");
      } else if (err?.code === "auth/popup-blocked") {
        setRestoreError("Sign-in popup was blocked by your browser. Please allow popups for this site.");
      } else if (err?.code === "permission-denied" || err?.message?.includes("Missing or insufficient permissions")) {
        setRestoreError("Firestore permission denied. Check your Firestore Security Rules.");
      } else {
        setRestoreError(err?.message || "Something went wrong. Try again.");
      }
      setRestoring(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-[32px] border border-line bg-card p-6 shadow-soft sm:p-8"
      >
        <div className="flex flex-col items-center text-center">
          <Mascot mood="party" size={110} className="animate-bob" />
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight">Kharcha</h1>
          <p className="mt-2 text-sm text-muted">
            Hi! I&apos;m <b className="text-ink">Stash</b> 🦉, your money buddy. Tell me a little about your pocket money and
            let&apos;s make every rupee count.
          </p>
        </div>

        {/* Restore from cloud */}
        <div className="mt-5">
          <button
            onClick={restoreFromCloud}
            disabled={restoring}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-accent/30 bg-accent/8 px-4 py-3 text-sm font-semibold text-accent transition hover:bg-accent/15 disabled:opacity-60"
          >
            {restoring ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <CloudDownload size={16} />
            )}
            {restoring ? "Restoring your data…" : "Restore from cloud (returning user)"}
          </button>
          {restoreError && (
            <p className="mt-2 text-center text-xs text-red-500">{restoreError}</p>
          )}
        </div>

        <div className="my-5 flex items-center gap-3 text-xs text-muted">
          <div className="h-px flex-1 bg-line" />
          or start fresh
          <div className="h-px flex-1 bg-line" />
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          <div>
            <Label htmlFor="ob-name">What should I call you?</Label>
            <Input id="ob-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="given-name" maxLength={40} />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div>
              <Label htmlFor="ob-budget">Monthly pocket money (₹)</Label>
              <Input
                id="ob-budget"
                type="number"
                inputMode="numeric"
                min={1}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="num text-lg font-bold"
              />
            </div>
            <div className="w-28">
              <Label htmlFor="ob-day">Arrives on day</Label>
              <Input
                id="ob-day"
                type="number"
                inputMode="numeric"
                min={1}
                max={28}
                value={startDay}
                onChange={(e) => setStartDay(e.target.value)}
                className="num"
              />
            </div>
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={!valid || busy}>
            Start fresh ✨
          </Button>
          <div className="rounded-2xl bg-bg-soft p-3 text-xs leading-relaxed text-muted">
            <p>
              🔒 <b className="text-ink">Your data stays private.</b> Sign in with Google to back up and restore across devices any time.
            </p>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
