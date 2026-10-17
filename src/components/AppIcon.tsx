import type { FC, SVGProps } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";

// Prevent FontAwesome from automatically injecting CSS since we imported styles.css above
config.autoAddCss = false;

// Solid FontAwesome Icons
import {
  faCircleCheck,
  faHeart,
  faTrashCan,
  faFaceSmile,
  faFaceMeh,
  faFaceFrown,
  faFaceFrownOpen,
  faFaceAngry,
  faTrophy,
  faFire,
  faStar,
  faGraduationCap,
  faTag,
  faSun,
  faMoon,
  faShieldHalved,
  faRotate,
  faPen,
  faHandshake,
  faBan,
  faCoins,
  faChartLine,
  faHouse,
  faChampagneGlasses,
} from "@fortawesome/free-solid-svg-icons";

// Lucide outline/fallback icons
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Award,
  Banknote,
  BarChart3,
  BookOpen,
  Calendar,
  CalendarDays,
  Download,
  FileText,
  Home,
  Inbox,
  Lightbulb,
  Lock,
  Medal,
  PartyPopper,
  PieChart,
  Receipt,
  Rocket,
  Search,
  ShieldCheck,
  Snowflake,
  Sparkles,
  SunMedium,
  TrendingDown,
  Undo2,
  XCircle,
  Zap,
} from "lucide-react";

interface IconConfig {
  emoji?: string;
  faIcon?: IconDefinition;
  lucideIcon?: FC<SVGProps<SVGSVGElement> & { size?: number | string }>;
  color?: string;
}

const ICON_MAP: Record<string, IconConfig> = {
  // Categories (Original Emojis)
  "🍛": { emoji: "🍛" },
  food: { emoji: "🍛" },
  "☕": { emoji: "☕" },
  chai: { emoji: "☕" },
  "🚌": { emoji: "🚌" },
  transport: { emoji: "🚌" },
  "📚": { emoji: "📚" },
  books: { emoji: "📚" },
  "📱": { emoji: "📱" },
  mobile: { emoji: "📱" },
  "🎬": { emoji: "🎬" },
  fun: { emoji: "🎬" },
  "🛍️": { emoji: "🛍️" },
  shopping: { emoji: "🛍️" },
  "💊": { emoji: "💊" },
  health: { emoji: "💊" },
  "🏠": { emoji: "🏠" },
  hostel: { emoji: "🏠" },
  "✨": { emoji: "✨" },
  other: { emoji: "✨" },
  "🍜": { emoji: "🍜" },
  "🥪": { emoji: "🥪" },
  "🛺": { emoji: "🛺" },

  // Goals & Wishlist (Original Emojis)
  "🎯": { emoji: "🎯" },
  target: { emoji: "🎯" },
  "🎧": { emoji: "🎧" },
  headphones: { emoji: "🎧" },
  "💻": { emoji: "💻" },
  laptop: { emoji: "💻" },
  "👟": { emoji: "👟" },
  shoes: { emoji: "👟" },
  "🏖️": { emoji: "🏖️" },
  trip: { emoji: "🏖️" },
  "🎸": { emoji: "🎸" },
  guitar: { emoji: "🎸" },
  "📷": { emoji: "📷" },
  camera: { emoji: "📷" },
  "🎁": { emoji: "🎁" },
  gift: { emoji: "🎁" },
  "🚲": { emoji: "🚲" },
  bike: { emoji: "🚲" },
  "🎮": { emoji: "🎮" },
  gaming: { emoji: "🎮" },
  "✈️": { emoji: "✈️" },
  flight: { emoji: "✈️" },
  "⌚": { emoji: "⌚" },
  watch: { emoji: "⌚" },
  "💍": { emoji: "💍" },
  jewelry: { emoji: "💍" },
  "🐷": { emoji: "🐷" },
  piggy: { emoji: "🐷" },
  "💰": { emoji: "💰" },
  savings: { emoji: "💰" },

  // Tags & Statuses (Solid Icons)
  "✅": { faIcon: faCircleCheck, color: "#06D6A0" },
  need: { faIcon: faCircleCheck, color: "#06D6A0" },
  check: { faIcon: faCircleCheck, color: "#06D6A0" },
  "💭": { faIcon: faHeart, color: "#FFB703" },
  want: { faIcon: faHeart, color: "#FFB703" },
  "🗑️": { faIcon: faTrashCan, color: "#EF476F" },
  waste: { faIcon: faTrashCan, color: "#EF476F" },
  trash: { faIcon: faTrashCan, color: "#EF476F" },
  "⚠️": { lucideIcon: AlertTriangle, color: "#FFB703" },
  warn: { lucideIcon: AlertTriangle, color: "#FFB703" },
  "❌": { lucideIcon: XCircle, color: "#EF476F" },
  skip: { lucideIcon: XCircle, color: "#EF476F" },

  // Badges & Milestones (Solid Icons)
  "🔥": { faIcon: faFire, color: "#FF7043" },
  flame: { faIcon: faFire, color: "#FF7043" },
  "🏆": { faIcon: faTrophy, color: "#FFD166" },
  trophy: { faIcon: faTrophy, color: "#FFD166" },
  "🏅": { lucideIcon: Medal, color: "#C8B6FF" },
  medal: { lucideIcon: Medal, color: "#C8B6FF" },
  "🐣": { faIcon: faStar, color: "#FFD166" },
  "📆": { lucideIcon: CalendarDays, color: "#4EA8DE" },
  "🚀": { lucideIcon: Rocket, color: "#FF6B8B" },
  "0️⃣": { emoji: "0️⃣" },
  zero: { emoji: "0️⃣" },
  "🥷": { faIcon: faShieldHalved, color: "#9D86F0" },
  "🤝": { faIcon: faHandshake, color: "#48CAE4" },
  handshake: { faIcon: faHandshake, color: "#48CAE4" },
  repayment: { faIcon: faHandshake, color: "#48CAE4" },
  "🗡️": { lucideIcon: Award, color: "#FF6B8B" },
  "💯": { faIcon: faTrophy, color: "#FFD166" },

  // Challenges & Audits
  "🚫🍕": { faIcon: faBan, color: "#EF476F" },
  "no-junk": { faIcon: faBan, color: "#EF476F" },
  money: { faIcon: faCoins, color: "#FFD166" },
  coins: { faIcon: faCoins, color: "#FFD166" },
  "🧘": { lucideIcon: Activity, color: "#9D86F0" },
  zen: { lucideIcon: Activity, color: "#9D86F0" },
  "📉": { lucideIcon: TrendingDown, color: "#4EA8DE" },
  "trend-down": { lucideIcon: TrendingDown, color: "#4EA8DE" },
  "📈": { faIcon: faChartLine, color: "#06D6A0" },

  // Semester Mode (Solid Icons)
  "🌤️": { faIcon: faSun, color: "#F59E0B" },
  normal: { faIcon: faSun, color: "#F59E0B" },
  "🎉": { faIcon: faChampagneGlasses, color: "#DB2777" },
  fest: { faIcon: faChampagneGlasses, color: "#DB2777" },
  exam: { faIcon: faGraduationCap, color: "#7C3AED" },
  home: { faIcon: faHouse, color: "#0D9488" },
  "🔍": { lucideIcon: Search, color: "#9D86F0" },
  search: { lucideIcon: Search, color: "#9D86F0" },
  "🗓️": { lucideIcon: Calendar, color: "#4EA8DE" },
  "📅": { lucideIcon: Calendar, color: "#4EA8DE" },
  calendar: { lucideIcon: Calendar, color: "#4EA8DE" },
  "📊": { lucideIcon: BarChart3, color: "#9D86F0" },
  chart: { lucideIcon: BarChart3, color: "#9D86F0" },
  "🍩": { lucideIcon: PieChart, color: "#FF85A1" },
  pie: { lucideIcon: PieChart, color: "#FF85A1" },
  "💡": { lucideIcon: Lightbulb, color: "#FFD166" },
  lightbulb: { lucideIcon: Lightbulb, color: "#FFD166" },
  "⚡": { lucideIcon: Zap, color: "#FFD166" },
  zap: { lucideIcon: Zap, color: "#FFD166" },
  "🧾": { lucideIcon: Receipt, color: "#FF9F43" },
  receipt: { lucideIcon: Receipt, color: "#FF9F43" },
  "🔒": { lucideIcon: Lock, color: "#D4A373" },
  lock: { lucideIcon: Lock, color: "#D4A373" },
  "💸": { lucideIcon: Banknote, color: "#06D6A0" },
  "🔁": { faIcon: faRotate, color: "#9D86F0" },
  repeat: { faIcon: faRotate, color: "#9D86F0" },
  "✏️": { faIcon: faPen, color: "#4EA8DE" },
  edit: { faIcon: faPen, color: "#4EA8DE" },
  "↩️": { lucideIcon: Undo2, color: "#4EA8DE" },
  "↩": { lucideIcon: Undo2, color: "#4EA8DE" },
  refund: { lucideIcon: Undo2, color: "#4EA8DE" },
  "🎓": { faIcon: faGraduationCap, color: "#9D86F0" },
  grad: { faIcon: faGraduationCap, color: "#9D86F0" },
  "📜": { lucideIcon: FileText, color: "#48CAE4" },
  doc: { lucideIcon: FileText, color: "#48CAE4" },
  "💳": { lucideIcon: AlertCircle, color: "#A0C4FF" },
  card: { lucideIcon: AlertCircle, color: "#A0C4FF" },
  "🧊": { lucideIcon: Snowflake, color: "#9BF6FF" },
  freeze: { lucideIcon: Snowflake, color: "#9BF6FF" },
  "❄️": { lucideIcon: Snowflake, color: "#9BF6FF" },
  "🏷️": { faIcon: faTag, color: "#C8B6FF" },
  tag: { faIcon: faTag, color: "#C8B6FF" },
  "☀️": { faIcon: faSun, color: "#FFD166" },
  light: { faIcon: faSun, color: "#FFD166" },
  "🌙": { faIcon: faMoon, color: "#C8B6FF" },
  dark: { faIcon: faMoon, color: "#C8B6FF" },
  "📋": { lucideIcon: FileText, color: "#A0C4FF" },
  "💾": { lucideIcon: Download, color: "#A0C4FF" },
  save: { lucideIcon: Download, color: "#A0C4FF" },
  "🛡️": { lucideIcon: ShieldCheck, color: "#06D6A0" },
  shield: { lucideIcon: ShieldCheck, color: "#06D6A0" },
  "📥": { lucideIcon: Inbox, color: "#B8F2E6" },
  import: { lucideIcon: Inbox, color: "#B8F2E6" },

  // Moods (Solid Icons)
  "😄": { faIcon: faFaceSmile, color: "#FFD166" },
  "🙂": { faIcon: faFaceSmile, color: "#B8F2E6" },
  "😐": { faIcon: faFaceMeh, color: "#A0C4FF" },
  "😕": { faIcon: faFaceFrown, color: "#FFD6A5" },
  "😩": { faIcon: faFaceFrownOpen, color: "#FFADAD" },
  "😭": { faIcon: faFaceFrown, color: "#FFADAD" },
  "😡": { faIcon: faFaceAngry, color: "#EF476F" },
};

export function AppIcon({
  name,
  icon,
  size = 18,
  className,
  color,
  colored = true,
}: {
  name?: string | null;
  icon?: string | null;
  size?: number;
  className?: string;
  color?: string;
  colored?: boolean;
}) {
  const iconKey = name ?? icon;
  if (!iconKey) return null;
  const trimmed = iconKey.trim();

  // 1. Check if configured in ICON_MAP
  const conf = ICON_MAP[trimmed] || ICON_MAP[trimmed.toLowerCase()];

  if (conf) {
    if (conf.emoji) {
      return (
        <span
          className={className}
          style={{ fontSize: `${size}px`, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          role="img"
          aria-hidden="true"
        >
          {conf.emoji}
        </span>
      );
    }

    const finalColor = color || (colored ? conf.color : undefined);

    if (conf.faIcon) {
      return (
        <FontAwesomeIcon
          icon={conf.faIcon}
          style={{
            width: `${size}px`,
            height: `${size}px`,
            fontSize: `${size}px`,
            color: finalColor,
            display: "inline-block",
            verticalAlign: "middle",
          }}
          className={className}
          aria-hidden="true"
        />
      );
    }

    if (conf.lucideIcon) {
      const LucideComp = conf.lucideIcon;
      return (
        <LucideComp
          size={size}
          className={className}
          style={finalColor ? { color: finalColor } : undefined}
          aria-hidden="true"
        />
      );
    }
  }

  // 2. If it's a raw Unicode emoji (e.g. user-defined category/goal emoji), render directly!
  if (/\p{Extended_Pictographic}/u.test(trimmed)) {
    return (
      <span
        className={className}
        style={{ fontSize: `${size}px`, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
        role="img"
        aria-hidden="true"
      >
        {trimmed}
      </span>
    );
  }

  // 3. Fallback
  return (
    <Sparkles
      size={size}
      className={className}
      style={{ color: color || (colored ? "#FFAA00" : undefined) }}
      aria-hidden="true"
    />
  );
}

export function getIconConfig(name: string): IconConfig | undefined {
  const trimmed = name.trim();
  return ICON_MAP[trimmed] || ICON_MAP[trimmed.toLowerCase()];
}
