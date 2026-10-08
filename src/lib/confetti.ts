"use client";

import confetti from "canvas-confetti";

const COLORS = ["#C8B6FF", "#B8F2E6", "#FFD6A5", "#FFC6D9", "#A0C4FF", "#FDFFB6"];

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function celebrate(big = false) {
  if (reducedMotion()) return;
  confetti({ particleCount: big ? 160 : 80, spread: big ? 100 : 70, origin: { y: 0.7 }, colors: COLORS, scalar: 0.9 });
  if (big) {
    setTimeout(() => confetti({ particleCount: 60, angle: 60, spread: 55, origin: { x: 0 }, colors: COLORS }), 200);
    setTimeout(() => confetti({ particleCount: 60, angle: 120, spread: 55, origin: { x: 1 }, colors: COLORS }), 350);
  }
}
