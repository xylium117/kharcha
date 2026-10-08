"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { Hourglass, MessageCircleHeart, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUI } from "@/components/AppShell";
import { Mascot } from "@/components/Mascot";
import { Button, Card, Input, Label, PageHeader, SectionTitle, Select, StatTile, cn } from "@/components/ui";
import { goalPerDay, goalSaved } from "@/lib/budget";
import { celebrate } from "@/lib/confetti";
import { db, uid } from "@/lib/db";
import { rupee, timestamp } from "@/lib/format";
import { useCategories, useCategoryMap, useContributions, useGoals, useNow, useWishlist } from "@/lib/hooks";
import type { Verdict, WishItem } from "@/lib/types";

const COOL_OFF_MS = 24 * 60 * 60 * 1000;

const VERDICT = {
  go: { title: "Go for it ✅", text: "It fits inside today's safe-to-spend.", bg: "#B8F2E6", mood: "party" as const },
  think: { title: "Think twice ⚠️", text: "Affordable, but it eats into the coming days.", bg: "#FFD6A5", mood: "chill" as const },
  skip: { title: "Skip it ❌", text: "This would blow a big hole in your budget.", bg: "#FFADAD", mood: "worried" as const },
};

export default function BuyPage() {
  const { budget, toast } = useUI();
  const categories = useCategories();
  const cats = useCategoryMap();
  const goals = useGoals();
  const contributions = useContributions();
  const wishlist = useWishlist();
  const now = useNow();
  const router = useRouter();
  const [item, setItem] = useState("");
  const [price, setPrice] = useState("");
  const [categoryId, setCategoryId] = useState("shopping");

  const p = Number(price);
  const ready = p > 0 && budget;

  let analysis: null | {
    verdict: Verdict;
    pctRemaining: number;
    daysOfAllowance: number;
    newAllowance: number;
    goalDelay?: { title: string; emoji: string; days: number };
  } = null;

  if (ready) {
    const daysLeft = Math.max(1, budget.period.daysLeft);
    const spendable = budget.safeToday + budget.dailyAllowance * (daysLeft - 1);
    const verdict: Verdict = p <= budget.safeToday ? "go" : p <= spendable * 0.25 ? "think" : "skip";
    const nextGoal = goals.filter((g) => !g.completedAt).sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
    let goalDelay;
    if (nextGoal) {
      const perDay = goalPerDay(nextGoal, goalSaved(nextGoal.id, contributions), now);
      if (perDay > 0) goalDelay = { title: nextGoal.title, emoji: nextGoal.emoji, days: Math.ceil(p / perDay) };
    }
    analysis = {
      verdict,
      pctRemaining: budget.remaining > 0 ? p / budget.remaining : Infinity,
      daysOfAllowance: budget.dailyAllowance > 0 ? p / budget.dailyAllowance : Infinity,
      newAllowance: Math.max(0, spendable - p) / daysLeft,
      goalDelay,
    };
  }

  async function buyNow(w?: WishItem) {
    const title = w?.title ?? (item.trim() || "Purchase");
    const amount = w?.price ?? p;
    await db.expenses.add({ id: uid(), amount, title, categoryId: w?.categoryId ?? categoryId, tag: "want", paymentMode: "UPI", ts: timestamp(), source: "wishlist" });
    if (w) await db.wishlist.update(w.id, { status: "bought", decidedAt: timestamp() });
    toast({ emoji: "🛍️", message: `${title} ${rupee(amount)} logged. Enjoy it!` });
    if (!w) {
      setItem("");
      setPrice("");
    }
  }

  async function coolOff() {
    await db.wishlist.add({ id: uid(), title: item.trim() || "Something nice", price: p, categoryId, addedAt: timestamp(), status: "waiting" });
    toast({ emoji: "⏳", message: "Added to cool-off list. Check back in 24 hours!" });
    setItem("");
    setPrice("");
  }

  async function skip(w: WishItem) {
    await db.wishlist.update(w.id, { status: "skipped", decidedAt: timestamp() });
    celebrate();
    toast({ emoji: "🗡️", tone: "good", message: `Impulse slain! ${rupee(w.price)} stays in your pocket.` });
  }

  const waiting = wishlist.filter((w) => w.status === "waiting").sort((a, b) => a.addedAt - b.addedAt);
  const savedBySkipping = wishlist.filter((w) => w.status === "skipped").reduce((s, w) => s + w.price, 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Should I buy it? 🤔" subtitle="Run the numbers before you tap 'Pay'." />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <div className="space-y-4">
            <div>
              <Label htmlFor="b-item">What do you want?</Label>
              <Input id="b-item" value={item} onChange={(e) => setItem(e.target.value)} placeholder="Oversized hoodie" maxLength={50} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="b-price">Price (₹)</Label>
                <Input id="b-price" type="number" inputMode="numeric" min={1} value={price} onChange={(e) => setPrice(e.target.value)} className="num text-lg font-bold" />
              </div>
              <div>
                <Label htmlFor="b-cat">Category</Label>
                <Select id="b-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.emoji} {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </div>
        </Card>

        <Card className="relative overflow-hidden">
          {!analysis ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center">
              <Mascot mood="chill" size={64} />
              <p className="text-sm text-muted">Enter a price and I&apos;ll crunch the numbers.</p>
            </div>
          ) : (
            <div>
              <div className="mb-4 flex items-center gap-3 rounded-2xl p-3 text-[#2d2a3e]" style={{ background: VERDICT[analysis.verdict].bg }}>
                <Mascot mood={VERDICT[analysis.verdict].mood} size={52} />
                <div>
                  <p className="text-lg font-extrabold">{VERDICT[analysis.verdict].title}</p>
                  <p className="text-sm">{VERDICT[analysis.verdict].text}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatTile
                  label="Of what's left this month"
                  value={isFinite(analysis.pctRemaining) ? `${Math.round(analysis.pctRemaining * 100)}%` : "—"}
                />
                <StatTile
                  label="Days of allowance"
                  value={isFinite(analysis.daysOfAllowance) ? analysis.daysOfAllowance.toFixed(1) : "—"}
                  hint={`at ${rupee(budget!.dailyAllowance)}/day`}
                />
                <StatTile label="New daily allowance" value={rupee(analysis.newAllowance)} hint={`was ${rupee(budget!.dailyAllowance)}`} />
                <StatTile
                  label="Goal delay"
                  value={analysis.goalDelay ? `${analysis.goalDelay.days} days` : "—"}
                  hint={analysis.goalDelay ? `${analysis.goalDelay.emoji} ${analysis.goalDelay.title}` : "no active goal"}
                />
              </div>
              <p className="mt-3 text-sm text-muted">
                That&apos;s also <b className="text-ink">{Math.floor(p / 15)} cups of chai ☕</b>, {Math.floor(p / 60)} canteen thalis 🍛 or{" "}
                {Math.floor(p / 20)} bus rides 🚌.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button variant={analysis.verdict === "go" ? "primary" : "soft"} onClick={() => buyNow()}>
                  <ShoppingCart size={16} /> Bought it
                </Button>
                <Button variant={analysis.verdict === "go" ? "soft" : "primary"} onClick={coolOff}>
                  <Hourglass size={16} /> Wait 24h
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => router.push(`/guide?q=${encodeURIComponent(`Should I buy ${item.trim() || "this"} for ₹${p}?`)}`)}
                >
                  <MessageCircleHeart size={16} /> Ask Stash
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle>⏳ Cool-off wishlist</SectionTitle>
        <p className="-mt-2 mb-3 text-sm text-muted">
          Impulse buys wait 24 hours here. Most cravings fade.{" "}
          {savedBySkipping > 0 && (
            <>
              So far you&apos;ve saved <b className="text-good">{rupee(savedBySkipping)}</b> by skipping. 🗡️
            </>
          )}
        </p>
        {waiting.length === 0 ? (
          <p className="text-sm text-muted">Nothing waiting. Your wallet is at peace. 🧘</p>
        ) : (
          <ul className="space-y-2">
            {waiting.map((w) => {
              const ready = now.getTime() - w.addedAt >= COOL_OFF_MS;
              return (
                <li key={w.id} className={cn("flex flex-wrap items-center gap-3 rounded-2xl border border-line p-3", ready && "bg-accent-soft")}>
                  <span className="grid size-10 place-items-center rounded-xl text-xl" style={{ background: cats.get(w.categoryId)?.color }}>
                    {cats.get(w.categoryId)?.emoji ?? "🛍️"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">
                      {w.title} <span className="num text-muted">{rupee(w.price)}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {ready ? "Cool-off done – do you still want it?" : `Decide in ${formatDistanceToNowStrict(w.addedAt + COOL_OFF_MS)}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="soft" onClick={() => skip(w)}>
                      Skip it 🗡️
                    </Button>
                    <Button size="sm" variant={ready ? "primary" : "ghost"} onClick={() => buyNow(w)}>
                      Buy
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
