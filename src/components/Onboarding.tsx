"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { celebrate } from "@/lib/confetti";
import { db } from "@/lib/db";
import { DEFAULT_CATEGORIES, DEFAULT_QUICK_BUTTONS, defaultSettings } from "@/lib/defaults";
import { loadDemoData } from "@/lib/demo";
import { Mascot } from "./Mascot";
import { Button, Input, Label } from "./ui";

export function Onboarding() {
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("6000");
  const [startDay, setStartDay] = useState("1");
  const [busy, setBusy] = useState(false);
  const amount = Number(budget);
  const valid = name.trim().length > 0 && amount > 0;

  async function start(demo: boolean) {
    if (!valid) return;
    setBusy(true);
    if (demo) {
      await loadDemoData(name.trim(), amount);
    } else {
      const s = defaultSettings(name.trim(), amount);
      s.monthStartDay = Math.min(28, Math.max(1, Number(startDay) || 1));
      await db.transaction("rw", db.settings, db.categories, db.quickButtons, async () => {
        await db.categories.bulkPut(DEFAULT_CATEGORIES);
        await db.quickButtons.bulkPut(DEFAULT_QUICK_BUTTONS);
        await db.settings.put(s);
      });
    }
    celebrate(true);
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

        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(false);
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
          <Button type="button" variant="soft" className="w-full" disabled={!valid || busy} onClick={() => start(true)}>
            Explore with 80 days of demo data
          </Button>
          <div className="rounded-2xl bg-bg-soft p-3 text-xs leading-relaxed text-muted">
            <p>
              🔒 <b className="text-ink">Your expenses stay on this phone.</b> Nobody else (not even the person who shared this app) can see
              them. Back up from Settings now and then.
            </p>
            <p className="mt-1.5">
              🦉 When you ask me something, a summary of your <b className="text-ink">numbers only</b> (amounts, categories, goals – no names,
              shops or notes) goes to Google&apos;s free Gemini AI, which may use it to improve its products.
            </p>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
