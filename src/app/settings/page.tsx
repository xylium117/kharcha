"use client";

import { addMonths, format, formatDistanceToNowStrict } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDown, ArrowUp, Download, Plus, Smartphone, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useUI } from "@/components/AppShell";
import { Button, Card, Chip, Input, Label, PageHeader, SectionTitle, Segmented, Select, cn } from "@/components/ui";
import { CloudSyncStatus } from "@/components/CloudSyncStatus";
import { getAIStatus, type AIStatus } from "@/lib/ai-client";
import { BADGES } from "@/lib/badges";
import { backupNow, clearAll, downloadText, importBackup, isBackupFile } from "@/lib/backup";
import { budgetFor, getPeriod } from "@/lib/budget";
import { db, uid } from "@/lib/db";
import { PASTELS, PAYMENT_MODES, TAGS } from "@/lib/defaults";
import { copyUsage, FEEDBACK_URL, usageSummary } from "@/lib/feedback";
import { googleCalendarUrl, reminderIcs } from "@/lib/reminder";
import { dayKey, parseDayKey, rupee } from "@/lib/format";
import { useCategories, useNow, useRecurring, useSettings } from "@/lib/hooks";
import type { Category, PaymentMode, SeasonMode, Settings, Tag, ThemePref } from "@/lib/types";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function SettingsPage() {
  const settings = useSettings();
  if (!settings) return null;
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" subtitle="Make Kharcha yours." />
      <ProfileCard settings={settings} />
      <SeasonCard settings={settings} />
      <div className="grid gap-4 lg:grid-cols-2">
        <QuickButtonsCard />
        <RecurringCard />
      </div>
      <CategoriesCard />
      <BadgesCard />
      <div className="grid gap-4 lg:grid-cols-2">
        <FeedbackCard />
        <ReminderCard settings={settings} />
        <AppearanceCard />
        <AICard settings={settings} />
      </div>
      <DataCard settings={settings} />
    </div>
  );
}

function ProfileCard({ settings }: { settings: Settings }) {
  const { toast } = useUI();
  const [name, setName] = useState(settings.name);
  const [budget, setBudget] = useState(String(settings.monthlyBudget));
  const [startDay, setStartDay] = useState(String(settings.monthStartDay));
  const [acad, setAcad] = useState(String(settings.academicStartMonth));
  const dirty =
    name !== settings.name || Number(budget) !== settings.monthlyBudget || Number(startDay) !== settings.monthStartDay || Number(acad) !== settings.academicStartMonth;

  async function save() {
    if (!name.trim() || !(Number(budget) > 0)) return;
    await db.settings.update("me", {
      name: name.trim(),
      monthlyBudget: Number(budget),
      monthStartDay: Math.min(28, Math.max(1, Number(startDay) || 1)),
      academicStartMonth: Number(acad),
    });
    toast({ emoji: "✅", message: "Saved" });
  }

  return (
    <Card>
      <SectionTitle>👤 You & your budget</SectionTitle>
      <form
        className="grid gap-3 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div>
          <Label htmlFor="s-name">Name</Label>
          <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </div>
        <div>
          <Label htmlFor="s-budget">Monthly pocket money (₹)</Label>
          <Input id="s-budget" type="number" min={1} inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} className="num" />
        </div>
        <div>
          <Label htmlFor="s-day">Arrives on day (1–28)</Label>
          <Input id="s-day" type="number" min={1} max={28} inputMode="numeric" value={startDay} onChange={(e) => setStartDay(e.target.value)} className="num" />
        </div>
        <div>
          <Label htmlFor="s-acad">Academic year starts</Label>
          <Select id="s-acad" value={acad} onChange={(e) => setAcad(e.target.value)}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-4">
          <Button type="submit" disabled={!dirty}>
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  );
}

const SEASONS: { id: SeasonMode; emoji: string; name: string; desc: string }[] = [
  { id: "normal", emoji: "🌤️", name: "Normal", desc: "Regular college days" },
  { id: "exam", emoji: "📚", name: "Exam season", desc: "Food, notes & travel first; Stash gets strict on fun" },
  { id: "fest", emoji: "🎉", name: "Fest mode", desc: "Add a fest fund on top of this month's budget" },
  { id: "home", emoji: "🏠", name: "Home trip", desc: "Lower budget while you're home – save the rest" },
];

function SeasonCard({ settings }: { settings: Settings }) {
  const { toast } = useUI();
  const now = useNow();
  const period = getPeriod(now, settings.monthStartDay);
  const current = budgetFor(settings, period.key);
  const hasOverride = settings.budgetOverrides[period.key] != null;
  const [picked, setPicked] = useState<SeasonMode>(settings.seasonMode);
  const [festFund, setFestFund] = useState("1000");
  // The suggested budget follows the picked mode until the user types their own.
  const [overrideEdit, setOverrideEdit] = useState<string | null>(null);
  const suggested =
    picked === "fest"
      ? settings.monthlyBudget + (Number(festFund) || 0)
      : picked === "home"
        ? Math.round(settings.monthlyBudget * 0.6)
        : picked === settings.seasonMode
          ? current
          : settings.monthlyBudget;
  const override = overrideEdit ?? String(suggested);
  const pick = (m: SeasonMode) => {
    setPicked(m);
    setOverrideEdit(null);
  };

  async function apply() {
    const amt = Number(override);
    const overrides = { ...settings.budgetOverrides };
    if (amt > 0 && amt !== settings.monthlyBudget) overrides[period.key] = amt;
    else delete overrides[period.key];
    await db.settings.update("me", { seasonMode: picked, budgetOverrides: overrides });
    toast({ emoji: SEASONS.find((s) => s.id === picked)!.emoji, message: `${SEASONS.find((s) => s.id === picked)!.name} on · budget ${rupee(amt || settings.monthlyBudget)} this month` });
  }

  return (
    <Card>
      <SectionTitle>🎓 Semester mode</SectionTitle>
      <p className="-mt-2 mb-3 text-sm text-muted">
        This month&apos;s budget: <b className="num text-ink">{rupee(current)}</b>
        {hasOverride && " (custom for this month)"}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SEASONS.map((s) => (
          <button
            key={s.id}
            onClick={() => pick(s.id)}
            aria-pressed={picked === s.id}
            className={cn(
              "rounded-2xl border p-3 text-left transition",
              picked === s.id ? "border-accent bg-accent-soft" : "border-line hover:border-accent/40",
            )}
          >
            <div className="text-2xl">{s.emoji}</div>
            <div className="mt-1 text-sm font-bold">
              {s.name} {settings.seasonMode === s.id && <span className="text-xs font-semibold text-accent">· on</span>}
            </div>
            <div className="text-xs text-muted">{s.desc}</div>
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {picked === "fest" && (
          <div className="w-36">
            <Label htmlFor="s-fest">Fest fund (₹)</Label>
            <Input id="s-fest" type="number" min={0} value={festFund} onChange={(e) => {
                setFestFund(e.target.value);
                setOverrideEdit(null);
              }} className="num" />
          </div>
        )}
        <div className="w-44">
          <Label htmlFor="s-override">Budget for {format(period.start, "MMM")} period (₹)</Label>
          <Input id="s-override" type="number" min={1} value={override} onChange={(e) => setOverrideEdit(e.target.value)} className="num" />
        </div>
        <Button onClick={apply}>Apply</Button>
      </div>
    </Card>
  );
}

function QuickButtonsCard() {
  const buttons = useLiveQuery(() => db.quickButtons.orderBy("order").toArray(), []) ?? [];
  const categories = useCategories();

  async function move(i: number, dir: -1 | 1) {
    const a = buttons[i];
    const b = buttons[i + dir];
    if (!a || !b) return;
    await db.transaction("rw", db.quickButtons, async () => {
      await db.quickButtons.update(a.id, { order: b.order });
      await db.quickButtons.update(b.id, { order: a.order });
    });
  }

  return (
    <Card>
      <SectionTitle
        action={
          <Button
            size="sm"
            variant="soft"
            onClick={() =>
              db.quickButtons.add({ id: uid(), label: "New", emoji: "⭐", amount: 50, categoryId: categories[0]?.id ?? "other", order: (buttons.at(-1)?.order ?? 0) + 1, tag: "need", paymentMode: "UPI" })
            }
          >
            <Plus size={14} /> Add
          </Button>
        }
      >
        ⚡ Quick buttons
      </SectionTitle>
      <ul className="space-y-2">
        {buttons.map((b, i) => (
          <li key={b.id} className="flex flex-col gap-1.5 rounded-2xl border border-line p-2">
            <div className="flex items-center gap-1.5">
              <Input aria-label="Emoji" value={b.emoji} onChange={(e) => db.quickButtons.update(b.id, { emoji: e.target.value })} className="w-12 px-2 text-center" maxLength={4} />
              <Input aria-label="Label" value={b.label} onChange={(e) => db.quickButtons.update(b.id, { label: e.target.value })} className="min-w-0 flex-1" maxLength={20} />
              <Input
                aria-label="Amount"
                type="number"
                min={1}
                value={b.amount}
                onChange={(e) => db.quickButtons.update(b.id, { amount: Number(e.target.value) || 0 })}
                className="num w-20 px-2"
              />
              <div className="flex flex-col">
                <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="text-muted disabled:opacity-20">
                  <ArrowUp size={14} />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === buttons.length - 1} aria-label="Move down" className="text-muted disabled:opacity-20">
                  <ArrowDown size={14} />
                </button>
              </div>
              <button onClick={() => db.quickButtons.delete(b.id)} aria-label={`Delete ${b.label}`} className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:text-bad">
                <Trash2 size={15} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <Select aria-label="Category" value={b.categoryId} onChange={(e) => db.quickButtons.update(b.id, { categoryId: e.target.value })} className="h-9 px-2 text-sm">
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.name}
                  </option>
                ))}
              </Select>
              <Select aria-label="Need, want or waste" value={b.tag ?? "need"} onChange={(e) => db.quickButtons.update(b.id, { tag: e.target.value as Tag })} className="h-9 px-2 text-sm">
                {TAGS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.emoji} {t.label}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Paid with"
                value={b.paymentMode ?? "UPI"}
                onChange={(e) => db.quickButtons.update(b.id, { paymentMode: e.target.value as PaymentMode })}
                className="h-9 px-2 text-sm"
              >
                {PAYMENT_MODES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RecurringCard() {
  const recurring = useRecurring();
  const categories = useCategories();
  const cats = new Map(categories.map((c) => [c.id, c]));
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("mobile");
  const [frequency, setFrequency] = useState<"monthly" | "weekly">("monthly");
  const [next, setNext] = useState(() => dayKey(addMonths(new Date(), 1)));
  const valid = title.trim() && Number(amount) > 0 && next;

  async function add() {
    if (!valid) return;
    await db.recurring.add({ id: uid(), title: title.trim(), amount: Number(amount), categoryId, frequency, nextDate: next, active: true });
    setTitle("");
    setAmount("");
  }

  return (
    <Card>
      <SectionTitle>🔁 Recurring expenses</SectionTitle>
      <ul className="mb-4 space-y-2">
        {recurring.length === 0 && <li className="text-sm text-muted">Phone recharge, subscriptions, mess fees… add them once and forget.</li>}
        {recurring.map((r) => (
          <li key={r.id} className={cn("flex items-center gap-3 rounded-2xl bg-bg-soft p-2.5", !r.active && "opacity-50")}>
            <span className="text-xl">{cats.get(r.categoryId)?.emoji ?? "🔁"}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {r.title} · <span className="num">{rupee(r.amount)}</span>
              </p>
              <p className="text-xs text-muted">
                {r.frequency} · next {format(parseDayKey(r.nextDate), "d MMM")}
              </p>
            </div>
            <Chip active={r.active} onClick={() => db.recurring.update(r.id, { active: !r.active })}>
              {r.active ? "On" : "Off"}
            </Chip>
            <button onClick={() => db.recurring.delete(r.id)} aria-label={`Delete ${r.title}`} className="text-muted hover:text-bad">
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="grid grid-cols-2 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Jio recharge" maxLength={40} className="col-span-2" />
        <Input aria-label="Amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₹" className="num" />
        <Select aria-label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as "monthly" | "weekly")}>
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
        </Select>
        <Input aria-label="First date" type="date" value={next} onChange={(e) => setNext(e.target.value)} />
        <Button type="submit" variant="soft" className="col-span-2" disabled={!valid}>
          <Plus size={14} /> Add recurring
        </Button>
      </form>
    </Card>
  );
}

function CategoriesCard() {
  const categories = useCategories();
  const { toast } = useUI();

  async function remove(c: Category) {
    const used = await db.expenses.where("categoryId").equals(c.id).count();
    if (used && !window.confirm(`${used} expenses use "${c.name}". Move them to "Other" and delete the category?`)) return;
    await db.transaction("rw", db.expenses, db.categories, db.quickButtons, async () => {
      await db.expenses.where("categoryId").equals(c.id).modify({ categoryId: "other" });
      await db.quickButtons.filter((q) => q.categoryId === c.id).modify({ categoryId: "other" });
      await db.categories.delete(c.id);
    });
    toast({ emoji: "🗑️", message: `Deleted ${c.name}` });
  }

  return (
    <Card>
      <SectionTitle
        action={
          <Button
            size="sm"
            variant="soft"
            onClick={() => db.categories.add({ id: uid(), name: "New category", emoji: "🏷️", color: PASTELS[categories.length % PASTELS.length] })}
          >
            <Plus size={14} /> Add
          </Button>
        }
      >
        🏷️ Categories
      </SectionTitle>
      <ul className="grid gap-2 sm:grid-cols-2">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-1.5">
            <Input aria-label="Emoji" value={c.emoji} onChange={(e) => db.categories.update(c.id, { emoji: e.target.value })} className="w-12 px-2 text-center" maxLength={4} style={{ background: c.color, color: "#2d2a3e" }} />
            <Input aria-label="Name" value={c.name} onChange={(e) => db.categories.update(c.id, { name: e.target.value })} className="min-w-0 flex-1" maxLength={24} />
            <div className="flex gap-0.5">
              {PASTELS.slice(0, 5).map((p) => (
                <button
                  key={p}
                  onClick={() => db.categories.update(c.id, { color: p })}
                  aria-label={`Color ${p}`}
                  className={cn("size-5 rounded-full border-2", c.color === p ? "border-ink" : "border-transparent")}
                  style={{ background: p }}
                />
              ))}
            </div>
            {c.id !== "other" && (
              <button onClick={() => remove(c)} aria-label={`Delete ${c.name}`} className="grid size-8 shrink-0 place-items-center text-muted hover:text-bad">
                <Trash2 size={15} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BadgesCard() {
  const unlocked = useLiveQuery(() => db.badges.toArray(), []) ?? [];
  const have = new Map(unlocked.map((b) => [b.id, b.unlockedAt]));
  return (
    <Card>
      <div id="badges" className="scroll-mt-6" />
      <SectionTitle>
        🏅 Badges · {have.size}/{BADGES.length}
      </SectionTitle>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {BADGES.map((b) => {
          const at = have.get(b.id);
          return (
            <div
              key={b.id}
              title={b.description}
              className={cn("flex flex-col items-center gap-1 rounded-2xl border border-line p-3 text-center", at ? "bg-accent-soft" : "opacity-45 grayscale")}
            >
              <span className="text-3xl">{b.emoji}</span>
              <span className="text-xs font-bold">{b.name}</span>
              <span className="text-[10px] leading-tight text-muted">{at ? format(at, "d MMM yyyy") : b.description}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ReminderCard({ settings }: { settings: Settings }) {
  const time = settings.reminderTime ?? "21:00";
  const appUrl = () => window.location.origin;
  return (
    <Card>
      <SectionTitle>⏰ Daily reminder</SectionTitle>
      <p className="mb-3 text-sm text-muted">
        Get a nudge every evening to log the day. It lives in your calendar, so it rings even when Kharcha is closed.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-32">
          <Label htmlFor="s-reminder">Time</Label>
          <Input id="s-reminder" type="time" value={time} onChange={(e) => db.settings.update("me", { reminderTime: e.target.value || "21:00" })} />
        </div>
        <Button onClick={() => window.open(googleCalendarUrl(time, appUrl(), new Date()), "_blank", "noopener")}>Add to Google Calendar</Button>
        <Button variant="ghost" onClick={() => downloadText(reminderIcs(time, appUrl(), new Date()), "kharcha-reminder.ics", "text/calendar")}>
          Other calendars (.ics)
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">Google Calendar opens with the event filled in – just tap Save.</p>
    </Card>
  );
}

function AppearanceCard() {
  // Settings only renders client-side (after the local DB loads), so reading storage here is safe.
  const [theme, setTheme] = useState<ThemePref>(() => {
    try {
      return (localStorage.getItem("kharcha-theme") as ThemePref) || (localStorage.getItem("pp-theme") as ThemePref) || "system";
    } catch {
      return "system";
    }
  });
  function pick(t: ThemePref) {
    setTheme(t);
    try {
      localStorage.setItem("kharcha-theme", t);
    } catch {}
    const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }
  return (
    <Card>
      <SectionTitle>🎨 Appearance</SectionTitle>
      <Segmented
        className="w-full"
        value={theme}
        onChange={pick}
        options={[
          { value: "light", label: "☀️ Light" },
          { value: "dark", label: "🌙 Dark" },
          { value: "system", label: "💻 System" },
        ]}
      />
    </Card>
  );
}

function FeedbackCard() {
  const { toast } = useUI();
  const [preview, setPreview] = useState("");
  return (
    <Card>
      <SectionTitle>💬 Help improve Kharcha</SectionTitle>
      <p className="mb-3 text-sm text-muted">
        Found a bug or have an idea? Your usage summary has counts only (days used, things you tried) – never amounts, items or names.
      </p>
      <div className="flex flex-wrap gap-2">
        {FEEDBACK_URL && (
          <a
            href={FEEDBACK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center rounded-2xl bg-accent px-4 text-sm font-semibold text-white dark:text-[#15142a]"
          >
            Send feedback
          </a>
        )}
        <Button
          variant="soft"
          onClick={async () => {
            setPreview(await usageSummary());
            toast((await copyUsage()) ? { emoji: "📋", message: "Usage summary copied" } : { emoji: "⚠️", tone: "warn", message: "Couldn't copy – select the text below" });
          }}
        >
          Copy my usage summary
        </Button>
      </div>
      {preview && <pre className="mt-3 whitespace-pre-wrap rounded-2xl bg-bg-soft p-3 text-xs text-muted select-all">{preview}</pre>}
    </Card>
  );
}

function AICard({ settings }: { settings: Settings }) {
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [pass, setPass] = useState(settings.appPasscode ?? "");
  useEffect(() => {
    getAIStatus().then(setStatus);
  }, []);
  return (
    <Card>
      <SectionTitle>🦉 AI guide</SectionTitle>
      <p className="text-sm">
        Status:{" "}
        {status == null ? (
          "checking…"
        ) : status.ai ? (
          <b className="text-good">
            online ({status.provider === "builtin" ? "Built-in offline engine" : status.provider === "gemini" ? "Google Gemini" : status.provider === "groq" ? "Groq (Llama 3.3)" : status.provider === "openrouter" ? "OpenRouter" : status.provider === "huggingface" ? "Hugging Face" : status.provider === "local" ? "Local LLM" : "Claude"})
          </b>
        ) : (
          <b className="text-bad">offline</b>
        )}
      </p>
      {status?.passcodeRequired && (
        <div className="mt-3 flex gap-2">
          <Input type="password" aria-label="App passcode" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="App passcode" />
          <Button variant="soft" onClick={() => db.settings.update("me", { appPasscode: pass })}>
            Save
          </Button>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">Stash works privately with a built-in offline engine. Your expense data never leaves your device.</p>
    </Card>
  );
}

function DataCard({ settings }: { settings: Settings }) {
  const { toast } = useUI();
  const fileRef = useRef<HTMLInputElement>(null);
  const [protectedStorage, setProtectedStorage] = useState<boolean | null>(null);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setProtectedStorage).catch(() => setProtectedStorage(false));
  }, []);

  async function doExport() {
    await backupNow();
    toast({ emoji: "💾", tone: "good", message: "Backup saved to your Downloads" });
  }

  async function protect() {
    const ok = (await navigator.storage?.persist?.()) ?? false;
    setProtectedStorage(ok);
    toast(
      ok
        ? { emoji: "🛡️", tone: "good", message: "This browser will keep your data" }
        : { emoji: "⚠️", tone: "warn", message: "The browser said no – install the app to your home screen and try again" },
    );
  }

  async function doImport(file: File) {
    try {
      const data = JSON.parse(await file.text());
      if (!isBackupFile(data)) throw new Error("Not a Kharcha backup file");
      if (!window.confirm("Replace ALL data on this device with this backup?")) return;
      await importBackup(data);
      toast({ emoji: "📥", tone: "good", message: "Backup restored" });
    } catch (e) {
      toast({ emoji: "⚠️", tone: "warn", message: e instanceof Error ? e.message : "Import failed" });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Card>
      <SectionTitle>☁️ Cloud sync & backup</SectionTitle>
      <div className="mb-4">
        <CloudSyncStatus />
      </div>
      <p className="mb-3 text-sm text-muted">
        Sign in to automatically sync your expenses, budgets, and goals securely to Cloud Firestore across your devices.
      </p>
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl bg-bg-soft p-3 text-sm">
          <div className="text-xs font-semibold text-muted">Last backup</div>
          <div className="font-semibold">
            {settings.lastBackupAt ? `${formatDistanceToNowStrict(settings.lastBackupAt)} ago` : "Never – back up today"}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-2xl bg-bg-soft p-3 text-sm">
          <div>
            <div className="text-xs font-semibold text-muted">Storage</div>
            <div className="font-semibold">
              {protectedStorage == null ? "Checking…" : protectedStorage ? "🛡️ Protected" : "⚠️ Browser may clear it"}
            </div>
          </div>
          {protectedStorage === false && (
            <Button size="sm" variant="soft" onClick={protect}>
              Protect
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href="/Kharcha.apk"
          download="Kharcha.apk"
          className="inline-flex h-11 items-center gap-2 rounded-2xl bg-accent px-4 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 active:scale-[0.98] dark:text-[#15142a]"
        >
          <Smartphone size={16} /> Install App (.apk)
        </a>
        <Button onClick={doExport}>
          <Download size={16} /> Export backup
        </Button>
        <Button variant="soft" onClick={() => fileRef.current?.click()}>
          <Upload size={16} /> Import backup
        </Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
        <Button
          variant="danger"
          onClick={async () => {
            if (!window.confirm("Delete ALL data on this device? This can't be undone.")) return;
            try {
              const { auth } = await import("@/lib/firebase");
              if (auth.currentUser) await auth.signOut();
            } catch {}
            await clearAll();
            window.location.reload();
          }}
        >
          <Trash2 size={16} /> Reset everything
        </Button>
      </div>
    </Card>
  );
}
