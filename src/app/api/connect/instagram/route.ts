import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";

export const runtime = "nodejs";

export const GET = withAuth(async (request: Request) => {
  const apiKey = process.env.ZERNIO_API_KEY;
  const baseUrl = process.env.ZERNIO_BASE_URL;
  const appUrl = process.env.APP_URL;
  const profileId = new URL(request.url).searchParams.get("profileId");

  if (!apiKey?.trim()) {
    return NextResponse.json(
      { error: "کلید API تنظیم نشده است. مقدار ZERNIO_API_KEY را در فایل .env.local وارد و سرور را دوباره اجرا کن." },
      { status: 503 },
    );
  }
  if (!baseUrl?.trim() || !appUrl?.trim()) {
    return NextResponse.json({ error: "ZERNIO_BASE_URL یا APP_URL در فایل .env.local تنظیم نشده است." }, { status: 503 });
  }
  if (!profileId?.trim()) {
    return NextResponse.json({ error: "Profile ID را از فهرست پروفایل‌ها انتخاب کن." }, { status: 400 });
  }
  if (/^(sk|zrk)_/i.test(profileId.trim())) {
    return NextResponse.json(
      { error: "این مقدار شبیه کلید API است، نه Profile ID. کلید را در .env.local بگذار و اینجا Profile ID را انتخاب کن." },
      { status: 400 },
    );
  }

  // Confirm the exact query parameter names and response shape against your
  // current Zernio API documentation before using this route in production.
  const callbackUrl = `${appUrl.replace(/\/$/, "")}/api/connect/callback`;
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/connect/instagram`);
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
    return NextResponse.json({ error: "شروع OAuth با خطا مواجه شد." }, { status: 502 });
  }
}, "admin");
