import { aiProvider } from "@/lib/server/ai";

export const dynamic = "force-dynamic";

export async function GET() {
  const provider = aiProvider();
  return Response.json({
    ai: true,
    provider,
    trimSnapshot: false,
    passcodeRequired: Boolean(process.env.APP_PASSCODE),
  });
}
