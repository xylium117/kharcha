import { aiProvider } from "@/lib/server/ai";

export const dynamic = "force-dynamic";

export async function GET() {
  const provider = aiProvider();
  return Response.json({
    ai: provider !== null,
    provider,
    // Gemini's free tier may use prompts to improve Google's products, so the client sends less detail.
    trimSnapshot: provider === "gemini",
    passcodeRequired: Boolean(process.env.APP_PASSCODE),
  });
}
