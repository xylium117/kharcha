"use client";

import { format } from "date-fns";
import { Check, Plus, Split, Trash2 } from "lucide-react";
import { useState } from "react";
import { useUI } from "@/components/AppShell";
import { Button, Card, Chip, EmptyState, Input, Label, PageHeader, Segmented, Select, Sheet, StatTile, cn } from "@/components/ui";
import { db, uid } from "@/lib/db";
import { round, rupee, timestamp } from "@/lib/format";
import { useCategories, useIOUs } from "@/lib/hooks";
import { settleIous } from "@/lib/ious";
import type { IOU } from "@/lib/types";

export default function SplitsPage() {
  const ious = useIOUs();
  const { toast } = useUI();
  const [adding, setAdding] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [showSettled, setShowSettled] = useState(false);

  const open = ious.filter((i) => !i.settled);
  const settled = ious.filter((i) => i.settled);
  const owedToMe = open.filter((i) => i.direction === "theyOwe").reduce((s, i) => s + i.amount, 0);
  const iOwe = open.filter((i) => i.direction === "iOwe").reduce((s, i) => s + i.amount, 0);

  const byPerson = new Map<string, { net: number; items: IOU[] }>();
  for (const i of open) {
    const p = byPerson.get(i.person) ?? { net: 0, items: [] };
    p.net += i.direction === "theyOwe" ? i.amount : -i.amount;
    p.items.push(i);
    byPerson.set(i.person, p);
  }
  const people = [...byPerson.entries()].sort((a, b) => Math.abs(b[1].net) - Math.abs(a[1].net));
  const knownNames = [...new Set(ious.map((i) => i.person))];

  async function settle(items: IOU[]) {
    const undo = await settleIous(items, timestamp());
    const back = items.filter((i) => i.direction === "theyOwe").reduce((s, i) => s + i.amount, 0);
    toast({
      emoji: "🤝",
      tone: "good",
      message:
        back > 0
          ? `${rupee(back)} back in your budget`
          : items.length > 1
            ? `Settled up with ${items[0].person}`
            : "Marked as settled",
      action: { label: "Undo", onClick: () => undo() },
    });
  }

  async function remove(i: IOU) {
    await db.ious.delete(i.id);
    toast({ emoji: "🗑️", message: "IOU deleted", action: { label: "Undo", onClick: () => db.ious.add(i) } });
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Splits & IOUs 🤝" subtitle="Who owes whom – no awkward reminders needed." />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setSplitting(true)}>
          <Split size={16} /> Split a bill
        </Button>
        <Button variant="soft" onClick={() => setAdding(true)}>
          <Plus size={16} /> Add IOU
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Friends owe you" value={rupee(owedToMe)} hint="returns to your budget when settled" tone="#B8F2E6" />
        <StatTile label="You owe" value={rupee(iOwe)} tone="#FFC6D9" />
      </div>

      {people.length === 0 ? (
        <Card>
          <EmptyState emoji="🤝" title="All square!">
            Nobody owes anybody. Split a canteen bill or log an IOU when it happens.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {people.map(([person, p], idx) => (
            <Card key={person} delay={idx * 0.04}>
              <div className="mb-3 flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-full bg-lavender text-lg font-bold text-[#2d2a3e]">
                  {person.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{person}</p>
                  <p className={cn("text-sm font-semibold", p.net >= 0 ? "text-good" : "text-bad")}>
                    {p.net >= 0 ? `owes you ${rupee(p.net)}` : `you owe ${rupee(-p.net)}`}
                  </p>
                </div>
                <Button size="sm" variant="soft" onClick={() => settle(p.items)}>
                  <Check size={14} /> Settle all
                </Button>
              </div>
              <ul className="space-y-1">
                {p.items.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-bg-soft">
                    <span className="flex-1 truncate">
                      {i.reason || "—"} <span className="text-xs text-muted">· {format(i.ts, "d MMM")}</span>
                    </span>
                    <span className={cn("num font-semibold", i.direction === "theyOwe" ? "text-good" : "text-bad")}>
                      {i.direction === "theyOwe" ? "+" : "−"}
                      {rupee(i.amount)}
                    </span>
                    <button onClick={() => settle([i])} aria-label="Settle" className="grid size-8 place-items-center rounded-full text-muted hover:bg-card hover:text-good">
                      <Check size={15} />
                    </button>
                    <button onClick={() => remove(i)} aria-label="Delete" className="grid size-8 place-items-center rounded-full text-muted hover:bg-card hover:text-bad">
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {settled.length > 0 && (
        <Card>
          <button className="flex w-full items-center justify-between font-bold" onClick={() => setShowSettled((s) => !s)} aria-expanded={showSettled}>
            ✅ Settled ({settled.length}) <span className="text-sm font-semibold text-accent">{showSettled ? "Hide" : "Show"}</span>
          </button>
          {showSettled && (
            <ul className="mt-3 space-y-1 text-sm text-muted">
              {settled.map((i) => (
                <li key={i.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {i.direction === "theyOwe" ? `${i.person} paid you back` : `You paid ${i.person}`} · {i.reason}
                  </span>
                  <span className="num">{rupee(i.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <IOUSheet open={adding} onClose={() => setAdding(false)} names={knownNames} />
      <SplitSheet open={splitting} onClose={() => setSplitting(false)} names={knownNames} />
    </div>
  );
}

function IOUSheet({ open, onClose, names }: { open: boolean; onClose: () => void; names: string[] }) {
  const [person, setPerson] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<IOU["direction"]>("theyOwe");
  const [reason, setReason] = useState("");
  const valid = person.trim() && Number(amount) > 0;

  async function save() {
    if (!valid) return;
    await db.ious.add({ id: uid(), person: person.trim(), amount: Number(amount), direction, reason: reason.trim(), ts: timestamp(), settled: false });
    setPerson("");
    setAmount("");
    setReason("");
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add IOU">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Segmented
          className="w-full"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "theyOwe", label: "They owe me" },
            { value: "iOwe", label: "I owe them" },
          ]}
        />
        <div>
          <Label htmlFor="iou-person">Friend</Label>
          <Input id="iou-person" list="iou-names" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Name" maxLength={30} />
          <datalist id="iou-names">
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div className="grid grid-cols-[120px_1fr] gap-3">
          <div>
            <Label htmlFor="iou-amt">Amount (₹)</Label>
            <Input id="iou-amt" type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className="num" />
          </div>
          <div>
            <Label htmlFor="iou-reason">For</Label>
            <Input id="iou-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Canteen lunch" maxLength={60} />
          </div>
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={!valid}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}

function SplitSheet({ open, onClose, names }: { open: boolean; onClose: () => void; names: string[] }) {
  const categories = useCategories();
  const { toast } = useUI();
  const [title, setTitle] = useState("");
  const [total, setTotal] = useState("");
  const [friends, setFriends] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [payer, setPayer] = useState("me");
  const [categoryId, setCategoryId] = useState("food");

  const n = friends.length + 1;
  const share = Number(total) > 0 ? round(Number(total) / n, 2) : 0;
  const valid = Number(total) > 0 && friends.length > 0;

  function addFriend(name: string) {
    const v = name.trim();
    if (v && !friends.includes(v)) setFriends((f) => [...f, v]);
    setNewName("");
  }

  async function save() {
    if (!valid) return;
    const ts = timestamp();
    const what = title.trim() || "Shared bill";
    await db.transaction("rw", db.expenses, db.ious, async () => {
      await db.expenses.add({ id: uid(), amount: share, title: `${what} (my share)`, categoryId, tag: "want", paymentMode: "UPI", ts, source: "split" });
      if (payer === "me") {
        await db.ious.bulkAdd(friends.map((f) => ({ id: uid(), person: f, amount: share, direction: "theyOwe" as const, reason: what, ts, settled: false })));
      } else {
        await db.ious.add({ id: uid(), person: payer, amount: share, direction: "iOwe", reason: what, ts, settled: false });
      }
    });
    toast({ emoji: "🧾", tone: "good", message: `Split ${rupee(Number(total))} ${n} ways – ${rupee(share)} each` });
    setTitle("");
    setTotal("");
    setFriends([]);
    setPayer("me");
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Split a bill">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <div>
            <Label htmlFor="sp-title">What</Label>
            <Input id="sp-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Pizza night" maxLength={50} />
          </div>
          <div>
            <Label htmlFor="sp-total">Total (₹)</Label>
            <Input id="sp-total" type="number" inputMode="numeric" min={1} value={total} onChange={(e) => setTotal(e.target.value)} className="num" />
          </div>
        </div>
        <div>
          <Label htmlFor="sp-friend">Split with (you&apos;re included)</Label>
          <div className="flex gap-2">
            <Input
              id="sp-friend"
              list="sp-names"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addFriend(newName);
                }
              }}
              placeholder="Friend's name"
              maxLength={30}
            />
            <Button type="button" variant="soft" onClick={() => addFriend(newName)}>
              Add
            </Button>
          </div>
          <datalist id="sp-names">
            {names.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
          {friends.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {friends.map((f) => (
                <Chip key={f} onClick={() => setFriends((fs) => fs.filter((x) => x !== f))} title="Remove">
                  {f} ✕
                </Chip>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="sp-payer">Who paid?</Label>
            <Select id="sp-payer" value={payer} onChange={(e) => setPayer(e.target.value)}>
              <option value="me">Me</option>
              {friends.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="sp-cat">Category</Label>
            <Select id="sp-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {valid && (
          <p className="rounded-2xl bg-bg-soft p-3 text-sm">
            {n} people · <b className="num">{rupee(share, true)}</b> each. Your share is logged as an expense
            {payer === "me" ? `, and ${friends.length} IOU${friends.length > 1 ? "s" : ""} will remind you who owes you.` : `, plus an IOU to ${payer}.`}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={!valid}>
          Split it
        </Button>
      </form>
    </Sheet>
  );
}
