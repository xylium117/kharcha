import { describe, expect, it } from "vitest";
import { splitVerdict } from "@/lib/verdict";

describe("splitVerdict", () => {
  it("extracts the verdict line", () => {
    const r = splitVerdict("Pizza is ₹350 and you have ₹420 safe today.\n\nVERDICT: go");
    expect(r.verdict).toBe("go");
    expect(r.text).toBe("Pizza is ₹350 and you have ₹420 safe today.");
  });

  it("handles bold markdown and case", () => {
    expect(splitVerdict("Hmm.\n**Verdict: Skip**").verdict).toBe("skip");
  });

  it("hides a half-streamed verdict line only while streaming", () => {
    expect(splitVerdict("Looks fine.\nVERD", true).text).toBe("Looks fine.");
    expect(splitVerdict("Good vibes only.\nV", true).text).toBe("Good vibes only.");
    expect(splitVerdict("Great Value", true).text).toBe("Great Value");
    expect(splitVerdict("Great Value").text).toBe("Great Value");
  });

  it("leaves replies without a verdict alone", () => {
    expect(splitVerdict("Try cooking with friends twice a week.")).toEqual({ text: "Try cooking with friends twice a week." });
  });
});
