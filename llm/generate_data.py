#!/usr/bin/env python3
"""
generate_data.py — synthesise Stash training examples.

Each example is a single chat turn:
  system  = GURU_SYSTEM (same prompt used in production)
  user    = <finance_snapshot>\\n...\\n</finance_snapshot>\\n\\n<question>
  assistant = a Stash-style answer (with optional VERDICT line)

The data is synthetic but grounded in realistic Indian student finance
numbers. No real user data is ever read.

Usage:
  uv run python generate_data.py --out data/Kharcha_train.jsonl --samples 2000
"""

from __future__ import annotations

import argparse
import json
import random
import textwrap
from pathlib import Path

# ---------------------------------------------------------------------------
# Exact system prompt mirrored from src/lib/server/ai.ts
# ---------------------------------------------------------------------------
GURU_SYSTEM = textwrap.dedent("""\
    You are Stash 🦉, an owl and the personal money mentor inside "Kharcha", \
an expense tracker for college students in India who live on monthly pocket money from family. \
Speak to the user as "you" and refer to yourself as "I". Don't assume their name, course or background; \
if the snapshot includes a name, you may use it now and then (if they're also called Stash, enjoy the coincidence).

    Personality: warm, encouraging, a little witty, like a smart senior from college. \
Light Hinglish is fine occasionally. A quick, simple stats analogy (averages, outliers, "your typical day") \
can make a point land – don't overdo it.

    How to answer:
    - Every user turn starts with a <finance_snapshot> block containing live numbers from the app. \
Ground every number you mention in it; never invent figures. If something isn't in the snapshot, say so.
    - Use ₹ and Indian number formatting. Keep replies short and skimmable: usually 2–6 sentences or a \
few bullets, under ~120 words unless asked for detail.
    - Be honest about tradeoffs. Don't lecture or shame; suggest cheaper swaps (canteen vs Zomato, \
sharing, walking short distances) when relevant.
    - For "can I buy / eat / spend on X" questions: compare the price with SAFE TO SPEND TODAY and \
remaining budget, mention the effect on goals if relevant, then end with a final line exactly in the form \
"VERDICT: go", "VERDICT: think" or "VERDICT: skip" (go = fits comfortably, think = possible but has a cost, \
skip = doesn't fit). Only add a VERDICT line for these purchase decisions.
    - For general tips, plans or questions about spending patterns, give concrete, student-realistic advice \
based on the data.
    - You are not a licensed financial advisor: for investing questions (stocks, crypto, mutual funds), \
keep it to general education and suggest learning more before putting pocket money at risk.""")

# ---------------------------------------------------------------------------
# Snapshot templates
# ---------------------------------------------------------------------------
NAMES = ["Arjun", "Priya", "Rahul", "Ananya", "Dev", "Meera", "Rohan", "Sneha", "Kabir", "Ishaan"]
SEASONS = ["Normal days", "Exam season (prioritise food, notes, transport; go easy on fun)",
           "Fest mode (extra fun budget this month)", "Home trip (expect lower daily spending)"]
CATEGORIES = ["Food", "Transport", "Entertainment", "Stationery", "Clothing", "Health", "Subscriptions", "Misc"]
TAGS = ["need", "want", "waste"]


def rand_snapshot(rng: random.Random) -> dict:
    """Return a dict of finance numbers for one synthetic student."""
    budget = rng.choice([3000, 4000, 5000, 6000, 8000, 10000])
    days_in_period = 30
    day_index = rng.randint(5, 28)
    days_left = days_in_period - day_index + 1
    spent = round(budget * rng.uniform(0.3, 0.85))
    saved_this_period = round(budget * rng.uniform(0, 0.15))
    income_this_period = rng.choice([0, 0, 200, 500, 1000])
    lent = rng.choice([0, 0, 0, 200, 350, 500])
    upcoming_recurring = rng.choice([0, 100, 200, 299, 499])
    goal_reserve = rng.choice([0, 0, 100, 200, 500])
    remaining = budget - spent - saved_this_period + income_this_period - lent
    daily_allowance = round(max(remaining - upcoming_recurring - goal_reserve, 0) / max(days_left, 1))
    spent_today = rng.randint(0, min(daily_allowance + 100, 500))
    safe_today = max(daily_allowance - spent_today, 0)
    projected_end = round(spent / day_index * days_in_period) if day_index > 0 else spent
    health = ("good" if projected_end < budget * 0.9 else
              "ok" if projected_end < budget else "over")
    streak = rng.randint(0, 21)

    # categories
    n_cats = rng.randint(2, 5)
    cats = rng.sample(CATEGORIES, n_cats)
    cat_totals = {}
    remainder_cat = spent
    for c in cats[:-1]:
        v = round(remainder_cat * rng.uniform(0.1, 0.5))
        cat_totals[c] = v
        remainder_cat -= v
    cat_totals[cats[-1]] = max(remainder_cat, 0)

    need = round(spent * rng.uniform(0.3, 0.6))
    want = round(spent * rng.uniform(0.2, 0.4))
    waste = max(spent - need - want, 0)

    # recent expenses (3-6 items)
    recent = []
    for _ in range(rng.randint(3, 6)):
        cat = rng.choice(CATEGORIES)
        amt = rng.choice([30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 350, 400, 499])
        tag = rng.choice(TAGS)
        recent.append(f"- {rng.randint(1,28)} Oct 12:30pm: ₹{amt} ({cat}, {tag})")

    # goals (0-2)
    goal_lines = []
    for i in range(rng.randint(0, 2)):
        target = rng.choice([2000, 3000, 5000, 8000, 10000, 15000])
        saved_g = round(target * rng.uniform(0, 0.8))
        per_day = round((target - saved_g) / max(days_left, 1))
        goal_lines.append(f"- Goal {i+1}: ₹{saved_g} of ₹{target} saved, deadline 2025-12-31, needs ₹{per_day}/day")
    if not goal_lines:
        goal_lines = ["- none"]

    # IOUs
    owed_to_me = rng.choice([0, 0, 0, 200, 350, 500])
    i_owe = rng.choice([0, 0, 0, 150, 300])
    wishlist_item = rng.choice(["empty", "Clothing item ₹1200", "Entertainment item ₹499", "Stationery item ₹250"])

    return dict(
        name=rng.choice(NAMES),
        season=rng.choice(SEASONS),
        day_index=day_index,
        days_in_period=days_in_period,
        days_left=days_left,
        budget=budget,
        spent=spent,
        saved_this_period=saved_this_period,
        income_this_period=income_this_period,
        lent=lent,
        upcoming_recurring=upcoming_recurring,
        goal_reserve=goal_reserve,
        remaining=remaining,
        daily_allowance=daily_allowance,
        spent_today=spent_today,
        safe_today=safe_today,
        projected_end=projected_end,
        health=health,
        streak=streak,
        cat_totals=cat_totals,
        need=need,
        want=want,
        waste=waste,
        recent=recent,
        goal_lines=goal_lines,
        owed_to_me=owed_to_me,
        i_owe=i_owe,
        wishlist_item=wishlist_item,
    )


def build_snapshot_text(s: dict) -> str:
    cats_str = ", ".join(f"{k} ₹{v}" for k, v in s["cat_totals"].items())
    return "\n".join([
        f"Name: {s['name']}. Now: Thu 10 Oct 2024, 2:30 PM.",
        f"Season mode: {s['season']}.",
        f"Budget period: 1 Oct – 31 Oct (day {s['day_index']} of {s['days_in_period']}, {s['days_left']} days left incl. today).",
        f"Monthly budget (pocket money): ₹{s['budget']}. Spent so far: ₹{s['spent']}. Moved to savings goals: ₹{s['saved_this_period']}. Remaining: ₹{s['remaining']}.",
        f"Money in this period (gifts, refunds, friends paying back): ₹{s['income_this_period']}. Paid for friends who still owe me: ₹{s['lent']}.",
        f"Upcoming recurring this period: ₹{s['upcoming_recurring']}. Reserved for goals for rest of period: ₹{s['goal_reserve']}.",
        f"Daily allowance today: ₹{s['daily_allowance']}. Spent today: ₹{s['spent_today']}. SAFE TO SPEND TODAY: ₹{s['safe_today']}.",
        f"Pace: projected period total ₹{s['projected_end']} vs budget ₹{s['budget']} (health: {s['health']}).",
        f"Logging streak: {s['streak']} days.",
        f"This period by category: {cats_str}.",
        f"Need/Want/Waste this period: need ₹{s['need']}, want ₹{s['want']}, waste ₹{s['waste']}.",
        "Recent expenses:",
        *s["recent"],
        "Savings goals:",
        *s["goal_lines"],
        f"Open IOUs: friends owe me ₹{s['owed_to_me']} (1 item); I owe ₹{s['i_owe']} (1 item).",
        f"Cool-off wishlist: {s['wishlist_item']}.",
    ])


# ---------------------------------------------------------------------------
# Question + answer templates
# ---------------------------------------------------------------------------
PURCHASE_QA: list[tuple[str, str]] = [
    # (question_template, answer_template)
    ("Can I afford a ₹{price} {item} tonight?",
     "Your SAFE TO SPEND TODAY is ₹{safe}. A ₹{price} {item} {verdict_text}. "
     "{'It fits fine — go ahead! 🎉' if verdict=='go' else 'It would eat into tomorrow's buffer, so think before you swipe.' if verdict=='think' else 'It would push you over today's limit. Skip it for now.'}\n\nVERDICT: {verdict}"),
    ("Is ₹{price} on {item} a good idea right now?",
     "Right now your safe-to-spend is ₹{safe} and you have ₹{remaining} left this period. "
     "₹{price} on {item} {verdict_text}.\n\nVERDICT: {verdict}"),
    ("Should I buy {item} for ₹{price}?",
     "Quick check: safe today = ₹{safe}, period remaining = ₹{remaining}. "
     "{'All clear — ₹' + str(price) + ' fits comfortably.' if verdict=='go' else 'Possible, but it'll tighten things until next pocket money.' if verdict=='think' else 'Not right now — you'd be dipping into reserves.'}\n\nVERDICT: {verdict}"),
]

ADVICE_QA: list[tuple[str, str]] = [
    ("Where am I wasting the most money?",
     "Looking at your tags: ₹{waste} is labelled as waste this period "
     "— that's {waste_pct:.0f}% of what you've spent. "
     "Your biggest category is {top_cat}, which might have room to trim. "
     "Try swapping one Zomato order for canteen this week and see how it feels."),
    ("How can I save faster for my goal?",
     "You need ₹{goal_per_day}/day for your goal. Your daily allowance is ₹{daily}. "
     "The gap is ₹{gap}/day — doable if you cut one want per day. "
     "Consider auto-moving a small amount right when pocket money arrives."),
    ("Plan my spending for the rest of this month.",
     "You have {days_left} days left and ₹{remaining} remaining (₹{daily}/day). "
     "Priorities: cover recurring ₹{recurring}, keep goal reserve, then ₹{safe_today} today. "
     "Stick to need-first spending and review every evening for 2 minutes."),
    ("Am I spending too much?",
     "At this pace you'll end the month at ₹{projected} vs your ₹{budget} budget — that's {health}. "
     "{'You're in great shape!' if health=='good' else 'A bit tight but manageable — tighten wants this week.' if health=='ok' else 'You're tracking over budget. Time to cut waste now.'}"),
    ("Cheap dinner ideas under ₹80.",
     "Canteen thali is usually ₹50–70 and keeps you full. "
     "Maggi + egg at home can be under ₹30. "
     "If you're craving something different, a sandwich from the college stall is ~₹40. "
     "All well within your safe spend of ₹{safe} today!"),
    ("How is my logging streak going?",
     "You're on a {streak}-day streak — {'nice consistency!' if streak>=7 else 'keep it going!' if streak>=3 else 'just getting started — log today and build the habit!'}. "
     "Consistent logging makes my advice way more accurate."),
    ("Should I invest my pocket money?",
     "Pocket money is best kept liquid for daily needs. "
     "If you have a steady surplus, a liquid fund or high-interest savings account beats letting it sit. "
     "For stocks or crypto — learn first, invest later; never put money you can't afford to lose. "
     "I'm not a licensed advisor, so do your own research before committing any amount."),
]


def make_purchase_example(rng: random.Random, s: dict) -> dict:
    items_prices = [
        ("pizza", 350), ("burger", 150), ("biryani", 200), ("movie ticket", 250),
        ("earphones", 800), ("shirt", 699), ("skincare product", 499), ("book", 299),
        ("café coffee", 180), ("gym session", 100), ("game pass", 499), ("headphones", 1200),
        ("jacket", 1200), ("sneakers", 2000), ("stationery kit", 400), ("lunch combo", 120),
    ]
    item, price = rng.choice(items_prices)
    safe = s["safe_today"]
    remaining = s["remaining"]

    if price <= safe * 0.8:
        verdict = "go"
        verdict_text = "fits easily within today's limit"
    elif price <= safe * 1.3:
        verdict = "think"
        verdict_text = "slightly stretches today's limit"
    else:
        verdict = "skip"
        verdict_text = "goes over what you can safely spend today"

    q_tmpl, a_tmpl = rng.choice(PURCHASE_QA)
    question = q_tmpl.format(price=price, item=item)
    answer = eval(f'f"""{a_tmpl}"""', {"price": price, "item": item, "safe": safe,
                                        "remaining": remaining, "verdict": verdict,
                                        "verdict_text": verdict_text})
    return {"question": question, "answer": answer}


def make_advice_example(rng: random.Random, s: dict) -> dict:
    top_cat = max(s["cat_totals"], key=s["cat_totals"].get)
    waste_pct = s["waste"] / max(s["spent"], 1) * 100
    gap = max(0, (s["goal_lines"][0].split("₹")[-1].split("/")[0]) if s["goal_lines"][0] != "- none" else 0)
    q_tmpl, a_tmpl = rng.choice(ADVICE_QA)
    question = q_tmpl
    try:
        answer = eval(f'f"""{a_tmpl}"""', {
            "waste": s["waste"], "waste_pct": waste_pct, "top_cat": top_cat,
            "goal_per_day": gap, "daily": s["daily_allowance"], "gap": 0,
            "days_left": s["days_left"], "remaining": s["remaining"],
            "recurring": s["upcoming_recurring"], "safe_today": s["safe_today"],
            "projected": s["projected_end"], "budget": s["budget"], "health": s["health"],
            "safe": s["safe_today"], "streak": s["streak"],
        })
    except Exception:
        answer = a_tmpl  # fallback: use template as-is
    return {"question": question, "answer": answer}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="data/Kharcha_train.jsonl")
    parser.add_argument("--samples", type=int, default=2000)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    written = 0
    with out_path.open("w", encoding="utf-8") as f:
        for _ in range(args.samples):
            s = rand_snapshot(rng)
            snapshot_text = build_snapshot_text(s)
            if rng.random() < 0.5:
                qa = make_purchase_example(rng, s)
            else:
                qa = make_advice_example(rng, s)

            user_content = f"<finance_snapshot>\n{snapshot_text}\n</finance_snapshot>\n\n{qa['question']}"
            record = {
                "messages": [
                    {"role": "system", "content": GURU_SYSTEM},
                    {"role": "user", "content": user_content},
                    {"role": "assistant", "content": qa["answer"]},
                ]
            }
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
            written += 1

    print(f"✅ Wrote {written} examples → {out_path}")


if __name__ == "__main__":
    main()
