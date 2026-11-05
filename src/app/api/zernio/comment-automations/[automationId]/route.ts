import { NextResponse } from "next/server";
import { automationBelongsToAccount, pathSegment, proxyZernio } from "@/lib/zernio";
import { readSessionUser, withAccountAuth } from "@/lib/auth";

export const runtime = "nodejs";

const automationIdFrom = (request: Request) => pathSegment(request, 1);

async function handle(request: Request) {
  const automationId = automationIdFrom(request);
  const user = await readSessionUser(request);
  // The account check in withAccountAuth only covers the query string; the automation id in the
  // path must also belong to the user's account, or a user could edit/delete another account's rule.
  if (user?.role !== "admin" && !(user?.accountId && await automationBelongsToAccount(automationId, user.profileId, user.accountId))) {
    return NextResponse.json({ error: "این اتوماسیون متعلق به حساب تو نیست." }, { status: 403 });
  }
  return proxyZernio(request, `/comment-automations/${encodeURIComponent(automationId)}`);
}

const accountIdFromQuery = (request: Request) => new URL(request.url).searchParams.get("accountId") || "";

export const PATCH = withAccountAuth(handle, accountIdFromQuery);
export const DELETE = withAccountAuth(handle, accountIdFromQuery);
