import { NextResponse } from "next/server";
import { readSessionUser, withAuth } from "@/lib/auth";

export const runtime = "nodejs";

export const GET = withAuth(async (request: Request) => {
  const user = await readSessionUser(request);
  const apiKey = process.env.ZERNIO_API_KEY;
  const baseUrl = process.env.ZERNIO_BASE_URL;

  if (!apiKey?.trim()) {
    return NextResponse.json(
      { error: "کلید API تنظیم نشده است. مقدار ZERNIO_API_KEY را در فایل .env.local وارد و سرور را دوباره اجرا کن." },
      { status: 503 },
    );
  }
  if (!baseUrl?.trim()) {
    return NextResponse.json(
      { error: "آدرس ZERNIO_BASE_URL در فایل .env.local تنظیم نشده است." },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/profiles`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      cache: "no-store",
    });
    const body = await response.text();
    if (!response.ok || !user || user.role === "admin") return new NextResponse(body, { status: response.status, headers: { "Content-Type": response.headers.get("content-type") || "application/json" } });
    const result = JSON.parse(body) as Record<string, unknown>;
    const visible = (value: unknown) => Array.isArray(value) ? value.filter((profile) => typeof profile === "object" && profile !== null && ((profile as Record<string, unknown>)._id === user.profileId || (profile as Record<string, unknown>).id === user.profileId)) : value;
    if (Array.isArray(result)) return NextResponse.json({ profiles: visible(result) }, { headers: { "Cache-Control": "no-store" } });
    if (Array.isArray(result.profiles)) result.profiles = visible(result.profiles);
    else if (Array.isArray(result.data)) result.data = visible(result.data);
    else return NextResponse.json({ profiles: [] }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(result, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "ارتباط با Zernio برقرار نشد." }, { status: 502 });
  }
});
