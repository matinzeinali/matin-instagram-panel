import { NextResponse } from "next/server";
import { automationBelongsToAccount, pathSegment, proxyZernio } from "@/lib/zernio";
import { readSessionUser, withAccountAuth } from "@/lib/auth";

export const runtime = "nodejs";

const automationIdFrom = (request: Request) => pathSegment(request, 2);

export const GET = withAccountAuth(async (request: Request) => {
  const automationId = automationIdFrom(request);
  const user = await readSessionUser(request);
  if (user?.role !== "admin" && !(user?.accountId && await automationBelongsToAccount(automationId, user.profileId, user.accountId))) {
    return NextResponse.json({ error: "این اتوماسیون متعلق به حساب تو نیست." }, { status: 403 });
  }
  return proxyZernio(request, `/comment-automations/${encodeURIComponent(automationId)}/logs`);
}, (request) => new URL(request.url).searchParams.get("accountId") || "");
