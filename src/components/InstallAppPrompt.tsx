"use client";

import { useEffect, useState } from "react";
import { Download, Smartphone, X } from "lucide-react";
import { Mascot } from "./Mascot";

export function InstallAppPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      document.referrer.includes("android-app://");

    if (isStandalone) return;

    const ua = navigator.userAgent || "";
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    if (!isMobile) return;

    const dismissed = localStorage.getItem("kharcha-apk-dismissed");
    if (dismissed && Date.now() - Number(dismissed) < 7 * 24 * 60 * 60 * 1000) {
      return;
    }

    const timer = setTimeout(() => setShow(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem("kharcha-apk-dismissed", String(Date.now()));
    } catch {}
  }

  return (
    <aside
      aria-label="Install App"
      className="fixed inset-x-3 bottom-20 z-50 mx-auto max-w-md animate-in fade-in slide-in-from-bottom-4 duration-300 md:hidden"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-card/95 p-3.5 shadow-soft backdrop-blur-md">
        <div className="relative shrink-0">
          <Mascot mood="happy" size={38} />
          <span className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-accent text-white">
            <Smartphone size={10} />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold leading-tight">Install Kharcha</div>
          <div className="text-xs text-muted">Get the Android app for faster access</div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href="/Kharcha.apk"
            download="Kharcha.apk"
            onClick={() => {
              try {
                localStorage.setItem("kharcha-apk-dismissed", String(Date.now()));
              } catch {}
              setShow(false);
            }}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-bold text-white shadow-sm transition active:scale-95 dark:text-[#15142a]"
          >
            <Download size={14} />
            Install App
          </a>

          <button
            onClick={dismiss}
            aria-label="Dismiss install prompt"
            className="grid size-8 place-items-center rounded-xl text-muted hover:bg-bg-soft hover:text-ink active:scale-95"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
