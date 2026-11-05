import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";

export const runtime = "nodejs";

const oauthPlatforms = new Set([
  "facebook",
  "instagram",
  "twitter",
  "linkedin",
  "tiktok",
  "youtube",
  "pinterest",
  "reddit",
  "threads",
  "googlebusiness",
  "snapchat",
  "whatsapp",
  "discord",
  "slack",
]);

export const GET = withAuth(async (request: Request, context: { params: Promise<{ platform: string }> }) => {
  const { platform: requestedPlatform } = await context.params;
  const platform = requestedPlatform.toLowerCase();
  const apiKey = process.env.ZERNIO_API_KEY?.trim();
  const baseUrl = process.env.ZERNIO_BASE_URL?.trim();
  const appUrl = process.env.APP_URL?.trim();
  const profileId = new URL(request.url).searchParams.get("profileId")?.trim();

  if (!oauthPlatforms.has(platform)) {
    return NextResponse.json({ error: "این پلتفرم با OAuth عمومی پشتیبانی نمی‌شود." }, { status: 400 });
  }
  if (!apiKey || !baseUrl || !appUrl) {
    return NextResponse.json({ error: "تنظیمات Zernio در .env.local کامل نیست." }, { status: 503 });
  }
  if (!profileId || /^(sk|zrk)_/i.test(profileId)) {
    return NextResponse.json({ error: "Profile ID معتبر لازم است." }, { status: 400 });
  }

  const callbackUrl = `${appUrl.replace(/\/$/, "")}/api/connect/callback`;
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/connect/${platform}`);
  url.searchParams.set("profileId", profileId);
  url.searchParams.set("redirect_url", callbackUrl);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      cache: "no-store",
    });
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") || "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "شروع اتصال با Zernio ناموفق بود." }, { status: 502 });
  }
}, "admin");
