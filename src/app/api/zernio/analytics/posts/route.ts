import { proxyZernio } from "@/lib/zernio";
import { readSessionUser, withAccountAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const GET = withAccountAuth(async (request: Request) => {
  const user = await readSessionUser(request);
  if (user?.role !== "admin" && new URL(request.url).searchParams.get("profileId") !== user?.profileId) return NextResponse.json({ error: "این پروفایل به حساب کاربری تو تخصیص داده نشده است." }, { status: 403 });
  return proxyZernio(request, "/analytics");
}, (request) => new URL(request.url).searchParams.get("accountId") || "");
