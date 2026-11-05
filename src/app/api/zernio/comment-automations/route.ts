import { NextResponse } from "next/server";
import { proxyZernio, sameId } from "@/lib/zernio";
import { withAccountAuth } from "@/lib/auth";

export const runtime = "nodejs";

// Zernio's list endpoint only filters by profileId, so the automations of every account in the
// profile come back together. Keep only the requested account's rules (withAccountAuth has already
// checked that a non-admin user may see that account).
export const GET = withAccountAuth(async (request: Request) => {
  const accountId = new URL(request.url).searchParams.get("accountId") || "";
  const response = await proxyZernio(request, "/comment-automations");
  if (!response.ok || !accountId) return response;
  const body = await response.json().catch(() => null) as { automations?: unknown[] } | null;
  if (!body || !Array.isArray(body.automations)) return NextResponse.json({ automations: [] }, { headers: { "Cache-Control": "no-store" } });
  body.automations = body.automations.filter((item) => item && typeof item === "object" && sameId((item as { accountId?: unknown }).accountId, accountId));
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}, (request) => new URL(request.url).searchParams.get("accountId") || "");

export const POST = withAccountAuth((request: Request) => proxyZernio(request, "/comment-automations"), async (request) => {
  const body = await request.json() as { accountId?: unknown };
  return typeof body.accountId === "string" ? body.accountId : undefined;
});
