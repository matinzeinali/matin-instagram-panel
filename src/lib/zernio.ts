import { NextResponse } from "next/server";

/** Forward a local API request to a fixed Zernio endpoint without exposing the API key. */
export async function proxyZernio(request: Request, endpoint: string) {
  const apiKey = process.env.ZERNIO_API_KEY?.trim();
  const baseUrl = process.env.ZERNIO_BASE_URL?.trim();

  if (!apiKey) {
    return NextResponse.json({ error: "کلید API در فایل .env.local تنظیم نشده است." }, { status: 503 });
  }
  if (!baseUrl) {
    return NextResponse.json({ error: "ZERNIO_BASE_URL در فایل .env.local تنظیم نشده است." }, { status: 503 });
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(`${baseUrl.replace(/\/$/, "")}${endpoint}`);
  incomingUrl.searchParams.forEach((value, key) => upstreamUrl.searchParams.set(key, value));

  const method = request.method.toUpperCase();
  const headers = new Headers({ Authorization: `Bearer ${apiKey}`, Accept: "application/json" });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  const body = method === "GET" || method === "HEAD" ? undefined : await request.text();

  try {
    const response = await fetch(upstreamUrl, {
      method,
      headers,
      body,
      cache: "no-store",
    });
    const responseBody = await response.text();
    return new NextResponse(responseBody || null, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "ارتباط با Zernio برقرار نشد." }, { status: 502 });
  }
}

/**
 * Check that an automation belongs to the given account.
 * Uses GET /comment-automations/{id}, which returns the automation with its accountId
 * (the list endpoint only filters by profileId, so it cannot be used for this).
 */
export async function automationBelongsToAccount(automationId: string, _profileId: string | undefined, accountId: string) {
  const apiKey = process.env.ZERNIO_API_KEY?.trim();
  const baseUrl = process.env.ZERNIO_BASE_URL?.trim();
  if (!apiKey || !baseUrl || !automationId || !accountId) return false;
  try {
    const url = `${baseUrl.replace(/\/$/, "")}/comment-automations/${encodeURIComponent(automationId)}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) return false;
    const body = await response.json() as { automation?: { accountId?: unknown } };
    return sameId(body.automation?.accountId, accountId);
  } catch {
    return false;
  }
}

/** Accounts in Zernio responses may expose `_id` or `id`; populated references may be objects. */
export function sameId(value: unknown, id: string | undefined) {
  if (!id) return false;
  if (typeof value === "string") return value === id;
  if (value && typeof value === "object") {
    const record = value as { _id?: unknown; id?: unknown };
    return record._id === id || record.id === id;
  }
  return false;
}

export async function verifyConnectedAccount(profileId: string, accountId: string) {
  const apiKey = process.env.ZERNIO_API_KEY?.trim();
  const baseUrl = process.env.ZERNIO_BASE_URL?.trim();
  if (!apiKey || !baseUrl) return { valid: false, error: "تنظیمات Zernio در .env.local کامل نیست." };
  try {
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/accounts`);
    url.searchParams.set("profileId", profileId);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }, cache: "no-store" });
    const body = await response.json();
    if (!response.ok) return { valid: false, error: typeof body.error === "string" ? body.error : "بررسی حساب متصل ناموفق بود." };
    const accounts = Array.isArray(body) ? body : Array.isArray(body.accounts) ? body.accounts : Array.isArray(body.data) ? body.data : [];
    return { valid: accounts.some((account: { id?: string; _id?: string }) => (account._id || account.id) === accountId) };
  } catch {
    return { valid: false, error: "ارتباط با Zernio برای بررسی حساب برقرار نشد." };
  }
}

/** Read a decoded path segment (counted from the end) without throwing on malformed escapes. */
export function pathSegment(request: Request, fromEnd: number) {
  const raw = new URL(request.url).pathname.split("/").filter(Boolean).at(-fromEnd) || "";
  try { return decodeURIComponent(raw); } catch { return raw; }
}
