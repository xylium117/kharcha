"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  FlaskConical,
  HandCoins,
  History,
  Home,
  MessageCircleHeart,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Settings as SettingsIcon,
  ShoppingBag,
  Target,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BADGES, earnedBadges } from "@/lib/badges";
import { celebrate } from "@/lib/confetti";
import { db } from "@/lib/db";
import { FEEDBACK_URL } from "@/lib/feedback";
import { useBudget, useSettings } from "@/lib/hooks";
import { postDueRecurring } from "@/lib/recurring";
import type { BudgetSummary } from "@/lib/budget";
import type { Expense } from "@/lib/types";
import { AddExpenseSheet, type AddTab } from "./AddExpenseSheet";
import { Mascot } from "./Mascot";
import { Onboarding } from "./Onboarding";
import { Sheet, cn } from "./ui";

interface ToastData {
  id: number;
  message: ReactNode;
  emoji?: string;
  tone?: "default" | "warn" | "good";
  action?: { label: string; onClick: () => void };
}

interface UIContextValue {
  openAdd: (opts?: { tab?: AddTab; edit?: Expense; prefill?: Partial<Expense> }) => void;
  toast: (t: Omit<ToastData, "id">) => void;
  budget: BudgetSummary | undefined;
}

const UIContext = createContext<UIContextValue | null>(null);

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used inside AppShell");
  return ctx;
}

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/history", label: "History", icon: History },
  { href: "/guide", label: "Ask Stash", icon: MessageCircleHeart },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/stats", label: "Stats Lab", icon: FlaskConical },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/splits", label: "Splits & IOUs", icon: HandCoins },
  { href: "/buy", label: "Should I buy it?", icon: ShoppingBag },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

const MOBILE_MAIN = ["/", "/history", "/guide"];

export function AppShell({ children }: { children: ReactNode }) {
  const settings = useSettings();
  const budget = useBudget();
  const pathname = usePathname();
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [add, setAdd] = useState<{ open: boolean; nonce: number; tab?: AddTab; edit?: Expense; prefill?: Partial<Expense> }>({ open: false, nonce: 0 });
  const [moreOpen, setMoreOpen] = useState(false);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const toastId = useRef(0);

  const toast = useCallback((t: Omit<ToastData, "id">) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.action ? 5500 : 3500);
  }, []);

  const openAdd = useCallback<UIContextValue["openAdd"]>((opts) => setAdd((a) => ({ open: true, nonce: a.nonce + 1, ...opts })), []);

  // Post recurring expenses once the app is set up.
  const ready = !!settings;
  useEffect(() => {
    if (!ready) return;
    postDueRecurring().then((n) => {
      if (n > 0) toast({ emoji: "🔁", message: `Added ${n} recurring expense${n > 1 ? "s" : ""}` });
    });
  }, [ready, toast]);

  useBadgeWatcher(toast);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // Chrome (Android) fires this when Kharcha can be installed; offer it unless dismissed before.
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      try {
        if (localStorage.getItem("pp-install-dismissed")) return;
      } catch {}
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallEvt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Ask the browser not to clear our data when space runs low (granted silently for installed apps).
  useEffect(() => {
    if (!ready) return;
    navigator.storage
      ?.persisted?.()
      .then((yes) => (yes ? true : navigator.storage.persist?.()))
      .catch(() => {});
  }, [ready]);

  if (settings === undefined) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Mascot mood="chill" size={84} className="animate-bob" />
      </div>
    );
  }
  if (settings === null) return <Onboarding />;

  return (
    <UIContext.Provider value={{ openAdd, toast, budget }}>
      <div className="mx-auto flex min-h-dvh max-w-6xl">
        {/* Sidebar (laptop) */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 px-4 py-6 md:flex">
          <Link href="/" className="mb-6 flex items-center gap-2 px-2">
            <Mascot mood="happy" size={40} />
            <div>
              <div className="text-lg font-extrabold leading-tight tracking-tight">Kharcha</div>
              <div className="text-xs text-muted">hey {settings.name} 👋</div>
            </div>
          </Link>
          {NAV.map((n) => (
            <NavLink key={n.href} {...n} active={pathname === n.href} />
          ))}
          <button
            onClick={() => openAdd()}
            className="mt-4 flex h-12 items-center justify-center gap-2 rounded-2xl bg-accent font-semibold text-white shadow-[0_8px_20px_-8px_var(--accent)] transition hover:brightness-110 active:scale-[0.98] dark:text-[#15142a]"
          >
            <Plus size={18} /> Add expense
          </button>
        </aside>

        <main className="min-w-0 flex-1 px-4 pb-32 pt-5 sm:px-6 md:pb-12 md:pt-8">
          {installEvt && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
              <span className="text-xl">📲</span>
              <span className="min-w-0 flex-1">
                <b>Install Kharcha</b> – opens like an app from your home screen, and your data is safer.
              </span>
              <span className="flex gap-2">
                <button
                  onClick={async () => {
                    await installEvt.prompt();
                    setInstallEvt(null);
                  }}
                  className="h-9 rounded-full bg-accent px-3 text-xs font-bold text-white dark:text-[#15142a]"
                >
                  Install
                </button>
                <button
                  onClick={() => {
                    try {
                      localStorage.setItem("pp-install-dismissed", "1");
                    } catch {}
                    setInstallEvt(null);
                  }}
                  className="h-9 rounded-full px-3 text-xs font-bold"
                >
                  Not now
                </button>
              </span>
            </div>
          )}
          {children}
        </main>
      </div>

      {/* Bottom nav (phone) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 items-center px-2">
          {NAV.filter((n) => MOBILE_MAIN.includes(n.href))
            .slice(0, 2)
            .map((n) => (
              <BottomLink key={n.href} {...n} active={pathname === n.href} />
            ))}
          <div className="flex justify-center">
            <button
              onClick={() => openAdd()}
              aria-label="Add expense"
              className="-mt-7 grid size-15 place-items-center rounded-full bg-accent text-white shadow-[0_10px_24px_-6px_var(--accent)] ring-4 ring-bg transition active:scale-90 dark:text-[#15142a]"
            >
              <Plus size={28} strokeWidth={2.5} />
            </button>
          </div>
          <BottomLink {...NAV[2]} label="Stash" active={pathname === "/guide"} />
          <button
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold",
              !MOBILE_MAIN.includes(pathname) ? "text-accent" : "text-muted",
            )}
          >
            <MoreHorizontal size={22} />
            More
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="grid grid-cols-3 gap-2">
          {NAV.filter((n) => !MOBILE_MAIN.includes(n.href)).map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setMoreOpen(false)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-2xl border border-line p-3 text-center text-xs font-semibold",
                pathname === n.href ? "bg-accent-soft text-accent" : "bg-bg-soft",
              )}
            >
              <n.icon size={22} />
              {n.label}
            </Link>
          ))}
          {FEEDBACK_URL && (
            <a
              href={FEEDBACK_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMoreOpen(false)}
              className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-bg-soft p-3 text-center text-xs font-semibold"
            >
              <MessageSquareText size={22} />
              Send feedback
            </a>
          )}
        </div>
      </Sheet>

      <AddExpenseSheet
        key={add.nonce}
        open={add.open}
        initialTab={add.tab}
        edit={add.edit}
        prefill={add.prefill}
        onClose={() => setAdd((a) => ({ ...a, open: false }))}
      />

      {/* Toasts */}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              role="status"
              className={cn(
                "pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-medium shadow-soft",
                t.tone === "warn"
                  ? "border-warn/30 bg-[#fff4dc] text-[#7a4b00] dark:bg-[#3a2e10] dark:text-[#ffd98a]"
                  : t.tone === "good"
                    ? "border-good/30 bg-[#e3fbf2] text-[#0f6b4e] dark:bg-[#123a2e] dark:text-[#8ff0cc]"
                    : "border-line bg-card text-ink",
              )}
            >
              {t.emoji && <span className="text-lg">{t.emoji}</span>}
              <span>{t.message}</span>
              {t.action && (
                <button
                  onClick={() => {
                    t.action!.onClick();
                    setToasts((ts) => ts.filter((x) => x.id !== t.id));
                  }}
                  className="ml-1 rounded-lg px-2 py-1 font-bold text-accent hover:bg-accent-soft"
                >
                  {t.action.label}
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </UIContext.Provider>
  );
}

function NavLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: typeof Home; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex h-11 items-center gap-3 rounded-2xl px-3 text-sm font-semibold transition",
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-card hover:text-ink",
      )}
    >
      <Icon size={18} />
      {label}
    </Link>
  );
}

function BottomLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: typeof Home; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold", active ? "text-accent" : "text-muted")}
    >
      <Icon size={22} />
      {label}
    </Link>
  );
}

/** Unlocks badges as their conditions are met. */
function useBadgeWatcher(toast: UIContextValue["toast"]) {
  const data = useLiveQuery(async () => {
    const [settings, expenses, goals, contributions, ious, wishlist, badges] = await Promise.all([
      db.settings.get("me"),
      db.expenses.toArray(),
      db.goals.toArray(),
      db.goalContributions.toArray(),
      db.ious.toArray(),
      db.wishlist.toArray(),
      db.badges.toArray(),
    ]);
    return { settings, expenses, goals, contributions, ious, wishlist, badges };
  }, []);

  const pending = useRef(new Set<string>());
  useEffect(() => {
    if (!data?.settings) return;
    const have = new Set(data.badges.map((b) => b.id));
    const earned = earnedBadges({ ...data, settings: data.settings, now: new Date() });
    const fresh = earned.filter((id) => !have.has(id) && !pending.current.has(id));
    if (!fresh.length) return;
    fresh.forEach((id) => pending.current.add(id));
    db.badges.bulkPut(fresh.map((id) => ({ id, unlockedAt: Date.now() }))).then(() => {
      const first = BADGES.find((b) => b.id === fresh[0])!;
      celebrate();
      toast({
        emoji: first.emoji,
        tone: "good",
        message: fresh.length === 1 ? `Badge unlocked: ${first.name}!` : `${fresh.length} new badges unlocked! 🎉`,
      });
    });
  }, [data, toast]);
}

/** Chrome's install prompt event (not in TypeScript's DOM types yet). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
