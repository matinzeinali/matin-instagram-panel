import { NextResponse } from "next/server";
import { readSessionUser, withAuth } from "@/lib/auth";

export const runtime = "nodejs";

export const GET = withAuth(async (request: Request) => {
  const user = await readSessionUser(request);
  const apiKey = process.env.ZERNIO_API_KEY;
  const baseUrl = process.env.ZERNIO_BASE_URL;
  const profileId = new URL(request.url).searchParams.get("profileId")?.trim();

  if (!apiKey?.trim()) {
    return NextResponse.json(
      { error: "کلید API در فایل .env.local تنظیم نشده است." },
      { status: 503 },
    );
  }
  if (!baseUrl?.trim()) {
    return NextResponse.json(
      { error: "ZERNIO_BASE_URL در فایل .env.local تنظیم نشده است." },
      { status: 503 },
    );
  }
  if (!profileId) {
    return NextResponse.json({ error: "Profile ID لازم است." }, { status: 400 });
  }
  if (/^(sk|zrk)_/i.test(profileId)) {
    return NextResponse.json({ error: "به‌جای Profile ID، کلید API وارد شده است." }, { status: 400 });
  }
  if (user?.role !== "admin" && (user?.profileId !== profileId || !user.accountId)) {
    return NextResponse.json({ error: "این پروفایل به حساب کاربری تو تخصیص داده نشده است." }, { status: 403 });
  }

  const url = new URL(`${baseUrl.replace(/\/$/, "")}/accounts`);
  url.searchParams.set("profileId", profileId);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      cache: "no-store",
    });
    const body = await response.text();
    if (response.ok && user?.role !== "admin") {
      const result = JSON.parse(body) as Record<string, unknown>;
      const filterAssigned = (value: unknown) => Array.isArray(value) ? value.filter((account) => typeof account === "object" && account !== null && ((account as Record<string, unknown>)._id === user?.accountId || (account as Record<string, unknown>).id === user?.accountId)) : value;
      if (Array.isArray(result)) return NextResponse.json({ accounts: filterAssigned(result) }, { headers: { "Cache-Control": "no-store" } });
      if (Array.isArray(result.accounts)) result.accounts = filterAssigned(result.accounts);
      else if (Array.isArray(result.data)) result.data = filterAssigned(result.data);
      else return NextResponse.json({ accounts: [] }, { headers: { "Cache-Control": "no-store" } });
      return NextResponse.json(result, { status: response.status, headers: { "Cache-Control": "no-store" } });
    }
    return new NextResponse(body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") || "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "ارتباط با Zernio برقرار نشد." }, { status: 502 });
  }
});
