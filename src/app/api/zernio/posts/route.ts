import { proxyZernio, sameId } from "@/lib/zernio";
import { readSessionUser, withAccountAuth, withAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const GET = withAuth(async (request: Request) => {
  const user = await readSessionUser(request);
  if (user?.role !== "admin") {
    // Check access before calling Zernio, and reject duplicated profileId params (the proxy forwards the last one).
    const profileIds = new URL(request.url).searchParams.getAll("profileId");
    if (!user?.accountId || profileIds.length !== 1 || profileIds[0] !== user.profileId) return NextResponse.json({ error: "این پروفایل به حساب کاربری تو تخصیص داده نشده است." }, { status: 403 });
  }
  const response = await proxyZernio(request, "/posts");
  if (user?.role !== "admin" && response.ok) {
    const result = await response.json().catch(() => ({})) as Record<string, unknown> | unknown[];
    const filter = (rows: unknown) => Array.isArray(rows) ? rows.map((post) => {
      if (!post || typeof post !== "object") return null;
      const item = post as Record<string, unknown>;
      const platforms = Array.isArray(item.platforms) ? item.platforms.filter((target) => target && typeof target === "object" && sameId((target as Record<string, unknown>).accountId, user?.accountId)) : [];
      return platforms.length ? { ...item, platforms } : null;
    }).filter(Boolean) : [];
    if (Array.isArray(result)) return NextResponse.json({ posts: filter(result) });
    if (Array.isArray(result.posts)) result.posts = filter(result.posts);
    else if (Array.isArray(result.data)) result.data = filter(result.data);
    else return NextResponse.json({ posts: [] });
    return NextResponse.json(result);
  }
  return response;
});
export const POST = withAccountAuth(async (request: Request) => {
  return proxyZernio(request, "/posts");
}, async (request) => {
  const body = await request.json() as { platforms?: Array<{ accountId?: unknown }> };
  return (body.platforms || []).map((target) => typeof target.accountId === "string" ? target.accountId : "");
});
