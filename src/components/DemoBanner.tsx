"use client";

/**
 * ⚠️  DEMO BANNER — DEVELOPMENT ONLY.
 * This component is rendered only when NEXT_PUBLIC_DEMO_MODE=true.
 * It must NOT be shipped in production builds.
 * Remove this component (and its import in layout.tsx) before release.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { loadShortDemoData } from "@/lib/demo";

export function DemoBanner() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return null;

  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");

  async function handleSeedAndGo() {
    setState("loading");
    try {
      await loadShortDemoData("Aayush", 6000);
      setState("done");
      router.push("/stats");
    } catch (err) {
      console.error("Demo seed failed:", err);
      setState("idle");
      alert("Demo seed failed: " + String(err));
    }
  }

  async function handleClear() {
    const { clearAll } = await import("@/lib/backup");
    await clearAll();
    router.push("/");
    router.refresh();
  }

  return (
    <div
      id="demo-banner"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: "linear-gradient(90deg, #ea580c 0%, #c2410c 100%)",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexWrap: "wrap",
        gap: "10px",
        padding: "6px 14px",
        fontSize: "12px",
        fontFamily: "system-ui, sans-serif",
        boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
      }}
    >
      <span style={{ fontWeight: 700, letterSpacing: "0.03em" }}>
        ⚠️ DEMO MODE (NOT FOR RELEASE)
      </span>
      <span style={{ opacity: 0.6 }}>|</span>

      <button
        id="demo-seed-btn"
        onClick={handleSeedAndGo}
        disabled={state === "loading"}
        style={{
          background: "rgba(255,255,255,0.2)",
          border: "1px solid rgba(255,255,255,0.4)",
          color: "#fff",
          borderRadius: "6px",
          padding: "4px 12px",
          fontSize: "13px",
          fontWeight: 600,
          cursor: state === "loading" ? "wait" : "pointer",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.35)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.2)")}
      >
        {state === "loading" ? "⏳ Seeding 30 days…" : state === "done" ? "✅ Done!" : "🗂️ Load 30-day demo → Stats"}
      </button>

      <button
        id="demo-clear-btn"
        onClick={handleClear}
        style={{
          background: "rgba(0,0,0,0.2)",
          border: "1px solid rgba(255,255,255,0.3)",
          color: "#fff",
          borderRadius: "6px",
          padding: "4px 12px",
          fontSize: "13px",
          fontWeight: 600,
          cursor: "pointer",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.4)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.2)")}
      >
        🗑️ Clear all data
      </button>
    </div>
  );
}
