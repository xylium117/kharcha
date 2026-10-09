import fs from "fs";
import path from "path";
import { format, subDays } from "date-fns";

export interface CategoryInfo {
  id: string;
  name: string;
}

export interface ParsedExpenseResult {
  amount: number;
  title: string;
  categoryId: string;
  place: string | null;
  paymentMode: "UPI" | "Cash" | "Card" | "Other";
  tag: "need" | "want" | "waste";
  date: string;
  time: string | null;
}

/**
 * Built-in intelligent offline parser for quick expense notes.
 */
export function parseExpenseBuiltin(
  text: string,
  categories: CategoryInfo[],
  today: string,
  _weekday: string,
  _time: string,
): ParsedExpenseResult {
  const clean = text.trim();
  const lower = clean.toLowerCase();

  // 1. Extract Amount
  let amount = 0;
  const currMatch = lower.match(/(?:₹|rs\.?|inr)\s*(\d[\d,]*(?:\.\d{1,2})?)/);
  const trailingRsMatch = lower.match(/(\d[\d,]*(?:\.\d{1,2})?)\s*(?:rs|rupees|inr|bucks)/);
  if (currMatch) {
    amount = parseFloat(currMatch[1].replace(/,/g, ""));
  } else if (trailingRsMatch) {
    amount = parseFloat(trailingRsMatch[1].replace(/,/g, ""));
  } else {
    const nums = lower.match(/\b\d[\d,]*(?:\.\d{1,2})?\b/g);
    if (nums) {
      for (const n of nums) {
        const val = parseFloat(n.replace(/,/g, ""));
        if (val >= 2020 && val <= 2030) continue;
        amount = val;
        break;
      }
    }
  }

  // 2. Extract Payment Mode
  let paymentMode: "UPI" | "Cash" | "Card" | "Other" = "UPI";
  if (/\b(?:cash|nakad)\b/i.test(lower)) {
    paymentMode = "Cash";
  } else if (/\b(?:card|debit|credit)\b/i.test(lower)) {
    paymentMode = "Card";
  } else if (/\b(?:upi|gpay|google\s*pay|phonepe|paytm|scan|qr|online)\b/i.test(lower)) {
    paymentMode = "UPI";
  }

  // 3. Extract Date
  let date = today;
  if (/\byesterday\b/i.test(lower)) {
    const todayDate = new Date(`${today}T12:00:00`);
    date = format(subDays(todayDate, 1), "yyyy-MM-dd");
  } else if (/\bday before yesterday\b/i.test(lower)) {
    const todayDate = new Date(`${today}T12:00:00`);
    date = format(subDays(todayDate, 2), "yyyy-MM-dd");
  }

  // 4. Extract Time
  let parsedTime: string | null = null;
  const timeMatch = lower.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const ampmMatch = lower.match(/\b([1-9]|1[0-2])\s*(am|pm)\b/);
  if (timeMatch) {
    parsedTime = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
  } else if (ampmMatch) {
    let hour = parseInt(ampmMatch[1], 10);
    const isPm = ampmMatch[2] === "pm";
    if (isPm && hour < 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
    parsedTime = `${String(hour).padStart(2, "0")}:00`;
  }

  // 5. Extract Place
  let place: string | null = null;
  const placeMatch = clean.match(/\b(?:at|from|in)\s+([A-Za-z0-9'\s]+?)(?=[,.]|\b(?:paid|via|by|cash|upi|card|yesterday|today|regret|bought)\b|$)/i);
  if (placeMatch) {
    const candidate = placeMatch[1].trim();
    if (candidate && !/^(?:college|home|night|morning|evening|noon)$/i.test(candidate)) {
      place = candidate;
    }
  }

  // 6. Extract Tag
  let tag: "need" | "want" | "waste" = "want";
  const wasteKeywords = ["regret", "waste", "unnecessary", "junk", "impulse", "stupid", "useless", "mistake", "guilt"];
  const needKeywords = [
    "need", "essential", "notes", "book", "copy", "xerox", "photocopy", "stationery", "pen",
    "college", "exam", "tuition", "fee", "rent", "medicine", "doctor", "pharma", "clinic",
    "auto", "bus", "metro", "rickshaw", "train", "cab", "uber", "ola", "canteen", "mess",
    "ration", "groceries", "milk", "vegetables", "lunch", "dinner", "breakfast", "tiffin",
    "fare", "fuel", "petrol"
  ];
  const wantKeywords = [
    "want", "zomato", "swiggy", "starbucks", "cafe", "coffee", "treat", "party", "movie",
    "game", "gaming", "shopping", "clothes", "burger", "pizza", "biryani", "ice cream",
    "dessert", "snack", "beer", "drink", "momos", "maggi"
  ];

  if (wasteKeywords.some((w) => lower.includes(w))) {
    tag = "waste";
  } else if (needKeywords.some((w) => lower.includes(w))) {
    tag = "need";
  } else if (wantKeywords.some((w) => lower.includes(w))) {
    tag = "want";
  }

  // 7. Match Category
  const catKeywords: Record<string, string[]> = {
    food: ["food", "chai", "coffee", "momos", "biryani", "burger", "pizza", "roll", "dosa", "thali", "maggi", "dinner", "lunch", "breakfast", "snack", "canteen", "mess", "zomato", "swiggy", "eating", "eat", "cafe", "bakery"],
    transport: ["transport", "travel", "auto", "cab", "uber", "ola", "metro", "bus", "train", "rickshaw", "ticket", "petrol", "fuel", "fare"],
    academics: ["study", "academic", "book", "copy", "pen", "print", "xerox", "photocopy", "notes", "stationery", "fee", "course", "project", "college"],
    bills: ["bill", "recharge", "jio", "airtel", "vi", "wifi", "internet", "electricity", "subscription", "spotify", "netflix"],
    personal: ["personal", "shopping", "clothes", "shoes", "wear", "salon", "haircut", "skincare"],
    health: ["health", "medical", "medicine", "tablet", "doctor", "clinic", "test", "bandaid"],
  };

  let categoryId = categories[0]?.id || "food";
  let bestScore = -1;

  for (const cat of categories) {
    const cName = cat.name.toLowerCase();
    if (lower.includes(cName)) {
      categoryId = cat.id;
      bestScore = 100;
      break;
    }
    for (const [group, words] of Object.entries(catKeywords)) {
      if (cName.includes(group)) {
        for (const w of words) {
          if (lower.includes(w) && bestScore < 10) {
            categoryId = cat.id;
            bestScore = 10;
          }
        }
      }
    }
  }

  // 8. Extract Title
  let title = clean;
  if (currMatch) title = title.replace(currMatch[0], "");
  else if (trailingRsMatch) title = title.replace(trailingRsMatch[0], "");
  else if (amount > 0) title = title.replace(new RegExp(`\\b${amount}\\b`), "");

  if (placeMatch) title = title.replace(placeMatch[0], "");

  const wordsToRemove = [
    /\bpaid\b/gi, /\bvia\b/gi, /\bthrough\b/gi, /\busing\b/gi,
    /\bupi\b/gi, /\bcash\b/gi, /\bcard\b/gi, /\bgpay\b/gi, /\bphonepe\b/gi, /\bpaytm\b/gi,
    /\byesterday\b/gi, /\btoday\b/gi,
    /\bregret it\b/gi, /\bregret\b/gi, /\bwaste\b/gi,
    /\bspent\b/gi, /\bfor\b/gi
  ];
  for (const reg of wordsToRemove) {
    title = title.replace(reg, "");
  }

  title = title.replace(/^[,\-–.\s]+|[,\-–.\s]+$/g, "").replace(/\s{2,}/g, " ").trim();

  if (!title) {
    const matchedCat = categories.find((c) => c.id === categoryId);
    title = matchedCat?.name || "Expense";
  } else {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }

  return {
    amount: amount || 0,
    title,
    categoryId,
    place,
    paymentMode,
    tag,
    date,
    time: parsedTime,
  };
}

// ---------------------------------------------------------------------------
// Training dataset loader & similarity index (llm/data/stash_train.jsonl)
// ---------------------------------------------------------------------------
interface StashExample {
  question: string;
  answer: string;
  tokens: Set<string>;
}

let cachedExamples: StashExample[] | null = null;

function tokenize(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const stopWords = new Set(["a", "an", "the", "in", "on", "at", "for", "to", "of", "and", "or", "is", "my", "this", "it"]);
  return new Set(words.filter((w) => !stopWords.has(w)));
}

function loadTrainExamples(): StashExample[] {
  if (cachedExamples) return cachedExamples;
  const filePath = path.join(process.cwd(), "llm", "data", "stash_train.jsonl");
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const result: StashExample[] = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const msgs = parsed.messages || [];
          const userMsg = msgs[1]?.content || "";
          const assistantMsg = msgs[2]?.content || "";
          const parts = userMsg.split("</finance_snapshot>\n\n");
          const question = parts.length > 1 ? parts[1].trim() : userMsg;
          result.push({
            question,
            answer: assistantMsg,
            tokens: tokenize(question),
          });
        } catch {
          // Skip invalid line
        }
      }
      cachedExamples = result;
      return result;
    }
  } catch (err) {
    console.warn("Could not load stash_train.jsonl:", err);
  }
  return [];
}

function findBestTrainingMatch(query: string, examples: StashExample[]): { example: StashExample; score: number } | null {
  if (!examples.length) return null;
  const qTokens = tokenize(query);
  if (!qTokens.size) return null;

  let best: StashExample | null = null;
  let bestScore = 0;

  for (const ex of examples) {
    let intersection = 0;
    for (const t of qTokens) {
      if (ex.tokens.has(t)) intersection++;
    }
    const union = new Set([...qTokens, ...ex.tokens]).size;
    const jaccard = union > 0 ? intersection / union : 0;
    if (jaccard > bestScore) {
      bestScore = jaccard;
      best = ex;
    }
  }

  return best ? { example: best, score: bestScore } : null;
}

/**
 * Built-in intelligent offline financial mentor chat generator.
 * Grounded in live student snapshot data and trained patterns from stash_train.jsonl.
 */
export async function* builtinChat(
  _system: string,
  history: { role: "user" | "assistant"; content: string }[],
): AsyncGenerator<string> {
  const last = history[history.length - 1];
  const userText = last?.content || "";

  // Extract snapshot if present in the prompt
  const snapshotMatch = userText.match(/<finance_snapshot>([\s\S]*?)<\/finance_snapshot>/);
  const snapshot = snapshotMatch ? snapshotMatch[1].trim() : "";
  const query = userText.replace(/<finance_snapshot>[\s\S]*?<\/finance_snapshot>/, "").trim();
  const lower = query.toLowerCase();

  // Helper to extract numbers from snapshot
  const extractSnapshotNum = (pattern: RegExp): number => {
    const m = snapshot.match(pattern);
    if (!m) return 0;
    const cleanNum = m[1].replace(/,/g, "");
    return parseFloat(cleanNum) || 0;
  };

  const safeToday = extractSnapshotNum(/SAFE TO SPEND TODAY:\s*[^0-9]*([0-9,.]+)/i);
  const remaining = extractSnapshotNum(/Remaining:\s*[^0-9]*([0-9,.]+)/i);
  const spentToday = extractSnapshotNum(/Spent today:\s*[^0-9]*([0-9,.]+)/i);
  const dailyAllowance = extractSnapshotNum(/Daily allowance today:\s*[^0-9]*([0-9,.]+)/i);
  const budget = extractSnapshotNum(/Monthly budget[^:]*:\s*[^0-9]*([0-9,.]+)/i);
  const spent = extractSnapshotNum(/Spent so far:\s*[^0-9]*([0-9,.]+)/i);
  const projectedEnd = extractSnapshotNum(/projected period total\s*[^0-9]*([0-9,.]+)/i);

  const daysLeftMatch = snapshot.match(/(\d+)\s*days left/i);
  const daysLeft = daysLeftMatch ? parseInt(daysLeftMatch[1], 10) : 10;

  const streakMatch = snapshot.match(/Logging streak:\s*(\d+)/i);
  const streak = streakMatch ? parseInt(streakMatch[1], 10) : 0;

  const healthMatch = snapshot.match(/health:\s*([a-zA-Z]+)/i);
  const health = healthMatch ? healthMatch[1].toLowerCase() : "ok";

  // Extract tags: need / want / waste
  const nwwMatch = snapshot.match(/Need\/Want\/Waste this period:\s*need\s*[^0-9]*([0-9,.]+)[^a-z]*want\s*[^0-9]*([0-9,.]+)[^a-z]*waste\s*[^0-9]*([0-9,.]+)/i);
  const tagNeed = nwwMatch ? parseFloat(nwwMatch[1].replace(/,/g, "")) : extractSnapshotNum(/\bneed\s*[:\s]*₹?\s*([0-9,.]+)/i);
  const tagWant = nwwMatch ? parseFloat(nwwMatch[2].replace(/,/g, "")) : extractSnapshotNum(/\bwant\s*[:\s]*₹?\s*([0-9,.]+)/i);
  const tagWaste = nwwMatch ? parseFloat(nwwMatch[3].replace(/,/g, "")) : extractSnapshotNum(/\bwaste\s*[:\s]*₹?\s*([0-9,.]+)/i);

  const categoryMatch = snapshot.match(/This period by category:\s*([^\n.]+)/i);
  const categoryStr = categoryMatch ? categoryMatch[1].trim() : "";

  // Parse category totals to find top category
  let topCat = "Food";
  let maxCatVal = -1;
  if (categoryStr) {
    const pairs = categoryStr.split(",").map((s) => s.trim());
    for (const p of pairs) {
      const m = p.match(/^([A-Za-z\s&]+)\s*[^0-9]*([0-9,.]+)/);
      if (m) {
        const catName = m[1].trim();
        const catVal = parseFloat(m[2].replace(/,/g, ""));
        if (catVal > maxCatVal) {
          maxCatVal = catVal;
          topCat = catName;
        }
      }
    }
  }

  const recurringMatch = snapshot.match(/Upcoming recurring this period:\s*[^0-9]*([0-9,.]+)/i);
  const upcomingRecurring = recurringMatch ? parseFloat(recurringMatch[1].replace(/,/g, "")) : 0;

  const goalMatch = snapshot.match(/Reserved for goals for rest of period:\s*[^0-9]*([0-9,.]+)/i);
  const goalReserve = goalMatch ? parseFloat(goalMatch[1].replace(/,/g, "")) : 0;

  const goalGapMatch = snapshot.match(/needs\s*[^0-9]*([0-9,.]+)\/day/i);
  const goalGap = goalGapMatch ? goalGapMatch[1].replace(/,/g, "") : "50";

  // Extract asked price
  const priceMatch = lower.match(/(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d{1,2})?)(?:\s*(?:rs|rupees|inr|bucks))?/i);
  let askedPrice = 0;
  if (priceMatch) {
    const rawNum = priceMatch[1].replace(/,/g, "");
    const val = parseFloat(rawNum);
    if (!(val >= 2024 && val <= 2030 && !/(?:₹|rs\.?|inr|rupees|bucks)/i.test(priceMatch[0]))) {
      askedPrice = val;
    }
  }

  // Extract clean item name for purchase queries
  let mentionedItem = "";
  let itemClean = query
    .replace(/(?:₹|rs\.?|inr)\s*[\d,]+(?:\.\d+)?/gi, "")
    .replace(/\b[\d,]+\s*(?:rs|rupees|bucks|inr)\b/gi, "")
    .replace(/\b[\d,]+\b/g, "");
  itemClean = itemClean
    .replace(/\b(?:is|a|an|the|good|idea|right|now|can|i|afford|tonight|should|buy|for|on|worth|it|purchase|get)\b/gi, " ")
    .replace(/[^a-zA-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (itemClean.length > 1) {
    mentionedItem = itemClean;
  } else if (askedPrice > 0) {
    mentionedItem = "this item";
  }

  // Load training examples from stash_train.jsonl
  const trainExamples = loadTrainExamples();
  const bestMatch = findBestTrainingMatch(query, trainExamples);

  let response = "";

  // 1. Cheap dinner ideas under ₹X (e.g. ₹80, ₹50, ₹100)
  if (/\b(?:dinner|lunch|breakfast|food|meal|eat|cheap.*ideas?|ideas?.*under)\b/i.test(lower)) {
    const targetBudget = askedPrice > 0 ? askedPrice : 80;
    response = `Here are student-tested dinner ideas under ₹${targetBudget}:\n\n` +
      `• **Canteen Thali / Dal-Chawal**: Usually ₹50–₹70, hot, filling, and balanced.\n` +
      `• **Campus Egg Bhurji & Rotis / Maggi + Boiled Egg**: ~₹30–₹45 at the local stall.\n` +
      `• **Paneer or Veg Roll / Masala Dosa**: ~₹40–₹60 from the college street corner.\n\n` +
      `All well within your safe spend of ₹${Math.round(safeToday)} today! Skipping delivery app fees alone saves ₹60–₹80 tonight. 🦉`;
  }
  // 2. Where am I wasting the most money?
  else if (/\b(?:waste|wasting|leaks?|overspending|cut\s*down)\b/i.test(lower)) {
    const totalTracked = spent > 0 ? spent : (tagNeed + tagWant + tagWaste);
    const wastePct = totalTracked > 0 ? Math.round((tagWaste / totalTracked) * 100) : 0;
    const wantPct = totalTracked > 0 ? Math.round((tagWant / totalTracked) * 100) : 0;
    response = `Looking at your tags and spending leaks:\n\n` +
      `• **Waste Tagged**: ₹${Math.round(tagWaste)} (${wastePct}% of spending) is labelled as waste or regret this period.\n` +
      `• **Discretionary Wants**: ₹${Math.round(tagWant)} (${wantPct}%) went toward non-essential wants.\n` +
      `• **Top Category**: Your biggest category is **${topCat}** (₹${Math.round(maxCatVal > 0 ? maxCatVal : 0)}), which has the most room to trim.\n\n` +
      `Try swapping one Zomato/Swiggy order for canteen this week and see how much buffer it recovers. 🦉`;
  }
  // 3. Plan my spending for the rest of this month
  else if (/\b(?:plan.*spending|spending.*plan|rest\s*of\s*(?:this\s*)?month|pace.*month|budget.*plan)\b/i.test(lower)) {
    const effRemaining = Math.max(0, remaining - upcomingRecurring - goalReserve);
    const calcDaily = daysLeft > 0 ? Math.round(effRemaining / daysLeft) : dailyAllowance;
    const displayDaily = dailyAllowance > 0 ? dailyAllowance : (calcDaily > 0 ? calcDaily : Math.round(remaining / Math.max(daysLeft, 1)));
    response = `Here is your spending plan and allowance breakdown for the remaining **${daysLeft} days**:\n\n` +
      `• **Remaining Pocket Money**: ₹${Math.round(remaining)}\n` +
      `• **Daily Allowance Breakdown**: ₹${Math.round(displayDaily)}/day (SAFE TO SPEND TODAY: ₹${Math.round(safeToday)})\n` +
      `• **Commitments**: Upcoming recurring bills: ₹${Math.round(upcomingRecurring)}, Goals reserve: ₹${Math.round(goalReserve)}\n\n` +
      `Priorities: cover recurring ₹${Math.round(upcomingRecurring)}, keep goal reserve, then ₹${Math.round(safeToday)} today. Stick to need-first spending and review every evening for 2 minutes. 🦉`;
  }
  // 4. Am I spending too much?
  else if (/\b(?:spending\s*too\s*much|over\s*budget|track|pacing)\b/i.test(lower)) {
    const tail = health === "good" ? "You're in great shape!" : health === "ok" ? "A bit tight but manageable — tighten wants this week." : "You're tracking over budget. Time to cut waste now.";
    response = `At this pace you'll end the month at ₹${Math.round(projectedEnd)} vs your ₹${Math.round(budget)} budget — that's ${health}. ${tail}`;
  }
  // 5. How can I save faster for my goal?
  else if (/\b(?:save.*faster|savings?\s*goal|reach.*goal)\b/i.test(lower)) {
    response = `You need ₹${goalGap}/day for your goal. Your daily allowance is ₹${Math.round(dailyAllowance)}. The gap is manageable if you cut one want per day. Consider auto-moving a small amount right when pocket money arrives.`;
  }
  // 6. How is my logging streak going?
  else if (/\b(?:streak|streak\s*days)\b/i.test(lower)) {
    const comment = streak >= 7 ? "nice consistency!" : streak >= 3 ? "keep it going!" : "just getting started — log today and build the habit!";
    response = `You're on a ${streak}-day streak — ${comment}. Consistent logging makes my advice way more accurate.`;
  }
  // 7. Should I invest my pocket money?
  else if (/\b(?:invest|stocks?|crypto|mutual\s*funds?)\b/i.test(lower)) {
    response = `Pocket money is best kept liquid for daily needs. If you have a steady surplus, a liquid fund or high-interest savings account beats letting it sit. For stocks or crypto — learn first, invest later; never put money you can't afford to lose. I'm not a licensed advisor, so do your own research before committing any amount.`;
  }
  // 8. Purchase decision (e.g. "Is a ₹1,200 jacket a good idea right now?", "Can I afford...", "Should I buy...")
  else if (askedPrice > 0 || /\b(?:can i|should i|afford|buy|purchase|spend|get|order|worth it|good idea)\b/i.test(lower)) {
    const price = askedPrice > 0 ? askedPrice : 100;
    const item = mentionedItem || "this item";

    let verdict: "go" | "think" | "skip";
    let verdictText: string;

    if (price <= safeToday * 0.8 && price <= remaining * 0.5) {
      verdict = "go";
      verdictText = "fits comfortably within today's limit";
    } else if (price <= safeToday * 1.3 && price <= remaining * 0.8) {
      verdict = "think";
      verdictText = "slightly stretches today's limit";
    } else {
      verdict = "skip";
      verdictText = "goes over what you can safely spend today";
    }

    if (/\bgood\s*idea\b/i.test(lower)) {
      response = `Right now your safe-to-spend is ₹${Math.round(safeToday)} and you have ₹${Math.round(remaining)} left this period. ₹${Math.round(price)} on ${item} ${verdictText}.\n\nVERDICT: ${verdict}`;
    } else if (/\btonight|can\s*i\s*afford\b/i.test(lower)) {
      const tail = verdict === "go" ? "It fits fine — go ahead! 🎉" : verdict === "think" ? "It would eat into tomorrow's buffer, so think before you swipe." : "It would push you over today's limit. Skip it for now.";
      response = `Your SAFE TO SPEND TODAY is ₹${Math.round(safeToday)}. A ₹${Math.round(price)} ${item} ${verdictText}. ${tail}\n\nVERDICT: ${verdict}`;
    } else {
      const tail = verdict === "go" ? `All clear — ₹${Math.round(price)} fits comfortably.` : verdict === "think" ? "Possible, but it will tighten things until next pocket money." : "Not right now — you would be dipping into reserves.";
      response = `Quick check: safe today = ₹${Math.round(safeToday)}, period remaining = ₹${Math.round(remaining)}. ₹${Math.round(price)} on ${item} ${verdictText}. ${tail}\n\nVERDICT: ${verdict}`;
    }
  }
  // 9. Match from stash_train.jsonl dataset if high similarity
  else if (bestMatch && bestMatch.score >= 0.35) {
    let adapted = bestMatch.example.answer;
    adapted = adapted.replace(/₹\d+/g, `₹${Math.round(safeToday)}`);
    response = adapted;
  }
  // 10. General friendly fallback
  else {
    response = `Hoo hoo! 🦉 Stash here. Right now you have ₹${Math.round(safeToday)} safe to spend today and ₹${Math.round(remaining)} left in your monthly pocket money with ${daysLeft} days to go. Ask me about your budget, safe spending, or any purchase!`;
  }

  // Stream out response in smooth chunks
  const words = response.split(" ");
  for (let i = 0; i < words.length; i += 3) {
    const chunk = words.slice(i, i + 3).join(" ") + (i + 3 < words.length ? " " : "");
    yield chunk;
  }
}

/**
 * Built-in weekly report card generator.
 */
export function builtinWeeklyReport(
  name: string,
  summary: string,
  suggestedGrade: string,
): {
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  headline: string;
  wins: string[];
  tip: string;
  funLine: string;
} {
  const allowedGrades = ["A+", "A", "B", "C", "D", "F"] as const;
  const grade = (allowedGrades.includes(suggestedGrade as any) ? suggestedGrade : "B") as "A+" | "A" | "B" | "C" | "D" | "F";

  const headlines: Record<string, string> = {
    "A+": "Masterclass in pocket money control!",
    "A": "Excellent discipline all week!",
    "B": "Solid week with steady pace!",
    "C": "Decent week, watch the mid-week splurges!",
    "D": "A bit tight this week, time to recalibrate!",
    "F": "Heavy week on spending, let's reset!",
  };

  const tips: Record<string, string> = {
    "A+": "Keep funneling your extra surplus into your savings goals.",
    "A": "Try one no-spend day this week to grow your buffer even faster.",
    "B": "Swap one food delivery order for a campus canteen meal this week.",
    "C": "Set a hard daily cap of ₹150 for non-essential treats this coming week.",
    "D": "Hold off on all wishlist items until the next pocket money deposit.",
    "F": "Focus strictly on 'needs' (canteen, metro/auto, notes) for the next 5 days.",
  };

  const funLines: Record<string, string> = {
    "A+": "Your pocket money graph looks smoother than a fresh cup of filter coffee. 🦉",
    "A": "Your variance is low and your financial vibes are high. 🦉",
    "B": "The law of averages is safely on your side this week. 🦉",
    "C": "Even Einstein had an outlier week once in a while. 🦉",
    "D": "Standard deviation took the wheel for a bit, but we can reel it back! 🦉",
    "F": "Outliers happen! Next week is a completely clean slate. 🦉",
  };

  return {
    grade,
    headline: headlines[grade] || "Steady progress on your finances!",
    wins: [
      `Maintained active tracking throughout the week for ${name}`,
      "Kept essential expenses organized by category",
      "Gained clear visibility over daily spending patterns",
    ],
    tip: tips[grade] || "Keep logging daily to maintain your safe-to-spend buffer.",
    funLine: funLines[grade] || "A wise owl never forgets to log their chai! 🦉",
  };
}
