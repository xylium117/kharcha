import type { Health } from "@/lib/budget";
import { cn } from "./ui";

export type Mood = "happy" | "chill" | "worried" | "party";

export function moodFromHealth(h: Health | undefined): Mood {
  if (h === "great") return "happy";
  if (h === "ok") return "chill";
  if (h === "tight" || h === "over") return "worried";
  return "chill";
}

/** Stash the owl. */
export function Mascot({ mood = "happy", size = 72, className }: { mood?: Mood; size?: number; className?: string }) {
  const eye = (cx: number) => {
    if (mood === "party") {
      return <path d={`M${cx - 7} 44 q7 -8 14 0`} stroke="#2d2a3e" strokeWidth="3.2" fill="none" strokeLinecap="round" />;
    }
    return (
      <g>
        <circle cx={cx} cy={44} r={11} fill="#fff" />
        <circle cx={cx + (mood === "worried" ? -1 : 1)} cy={mood === "worried" ? 46 : 45} r={mood === "worried" ? 4.2 : 5.5} fill="#2d2a3e" />
        <circle cx={cx + 3} cy={42} r={1.8} fill="#fff" />
        {mood === "chill" && <path d={`M${cx - 11} 41 h22`} stroke="#9d86f0" strokeWidth="9" strokeLinecap="round" />}
      </g>
    );
  };
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      role="img"
      aria-label={`Stash the owl looking ${mood}`}
    >
      {mood === "party" && (
        <g>
          <path d="M50 2 L38 24 L62 24 Z" fill="#FFC6D9" stroke="#2d2a3e" strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="50" cy="3" r="3.5" fill="#FDFFB6" stroke="#2d2a3e" strokeWidth="1.2" />
          <circle cx="16" cy="18" r="2.5" fill="#B8F2E6" />
          <circle cx="86" cy="22" r="2.5" fill="#FFD6A5" />
          <rect x="80" y="8" width="5" height="5" rx="1" fill="#A0C4FF" transform="rotate(20 82 10)" />
          <rect x="10" y="30" width="5" height="5" rx="1" fill="#FFC6D9" transform="rotate(-20 12 32)" />
        </g>
      )}
      {/* ear tufts */}
      <path d="M24 30 L22 14 L36 24 Z" fill="#9d86f0" />
      <path d="M76 30 L78 14 L64 24 Z" fill="#9d86f0" />
      {/* body */}
      <ellipse cx="50" cy="58" rx="32" ry="34" fill="#C8B6FF" />
      <ellipse cx="50" cy="68" rx="20" ry="20" fill="#FFF4E8" />
      {/* belly feathers */}
      <path d="M42 66 q4 4 8 0 q4 4 8 0" stroke="#e9d9c5" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M44 74 q3 3 6 0 q3 3 6 0" stroke="#e9d9c5" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* wings */}
      <path d="M19 56 q-6 16 6 26 q2 -14 -6 -26 Z" fill="#9d86f0" />
      <path d="M81 56 q6 16 -6 26 q-2 -14 6 -26 Z" fill="#9d86f0" />
      {/* eyes */}
      {eye(38)}
      {eye(62)}
      {mood === "worried" && (
        <g stroke="#2d2a3e" strokeWidth="2.6" strokeLinecap="round">
          <path d="M29 30 L44 34" />
          <path d="M71 30 L56 34" />
        </g>
      )}
      {/* beak */}
      <path d="M45 52 L55 52 L50 60 Z" fill="#FFB86B" stroke="#e8964a" strokeWidth="1" strokeLinejoin="round" />
      {/* blush */}
      {mood !== "worried" && (
        <g fill="#FFADAD" opacity="0.7">
          <ellipse cx="27" cy="55" rx="5" ry="3" />
          <ellipse cx="73" cy="55" rx="5" ry="3" />
        </g>
      )}
      {mood === "worried" && <path d="M80 34 q4 6 0 9 q-4 -3 0 -9 Z" fill="#A0C4FF" />}
      {/* feet */}
      <g fill="#FFB86B">
        <ellipse cx="41" cy="91" rx="6" ry="3" />
        <ellipse cx="59" cy="91" rx="6" ry="3" />
      </g>
    </svg>
  );
}
