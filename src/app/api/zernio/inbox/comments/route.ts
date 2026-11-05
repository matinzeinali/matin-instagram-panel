import { NextResponse } from "next/server";
import { proxyZernio, sameId } from "@/lib/zernio";
import { withAccountAuth } from "@/lib/auth";

export const runtime = "nodejs";

// GET /inbox/comments lists the POSTS that have comments (not the comments themselves) and aggregates
// every account; keep only the requested account's posts.
export const GET = withAccountAuth(async (request: Request) => {
  const accountId = new URL(request.url).searchParams.get("accountId") || "";
  const response = await proxyZernio(request, "/inbox/comments");
  if (!response.ok || !accountId) return response;
  const body = await response.json().catch(() => null) as { data?: unknown[] } | null;
  if (!body || !Array.isArray(body.data)) return NextResponse.json({ data: [] }, { headers: { "Cache-Control": "no-store" } });
  body.data = body.data.filter((post) => post && typeof post === "object" && sameId((post as { accountId?: unknown }).accountId, accountId));
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}, (request) => new URL(request.url).searchParams.get("accountId") || "");
