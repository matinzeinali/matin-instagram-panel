import { NextResponse } from "next/server";
import { automationBelongsToAccount, pathSegment } from "@/lib/zernio";
import { readSessionUser, withAccountAuth } from "@/lib/auth";
import { DEFAULT_FOLLOWUP_SETTING, getFollowupSetting, normaliseFollowupSetting, saveFollowupSetting } from "@/lib/followup-store";

export const runtime = "nodejs";

const accountIdFromQuery = (request: Request) => new URL(request.url).searchParams.get("accountId") || "";

/** The rule id in the path must belong to the user's account (withAccountAuth only checks the query string). */
async function ruleAllowed(request: Request, ruleId: string) {
  const user = await readSessionUser(request);
  if (user?.role === "admin") return true;
  return Boolean(user?.accountId && await automationBelongsToAccount(ruleId, user.profileId, user.accountId));
}

export const GET = withAccountAuth(async (request: Request) => {
  const ruleId = pathSegment(request, 1);
  if (!(await ruleAllowed(request, ruleId))) return NextResponse.json({ error: "این قانون متعلق به حساب تو نیست." }, { status: 403 });
  const setting = await getFollowupSetting(ruleId);
  return NextResponse.json({ setting: setting ?? DEFAULT_FOLLOWUP_SETTING, configured: Boolean(setting) }, { headers: { "Cache-Control": "no-store" } });
}, accountIdFromQuery);

export const PUT = withAccountAuth(async (request: Request) => {
  const ruleId = pathSegment(request, 1);
  if (!(await ruleAllowed(request, ruleId))) return NextResponse.json({ error: "این قانون متعلق به حساب تو نیست." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const { setting, error } = normaliseFollowupSetting(body);
  if (!setting) return NextResponse.json({ error: error || "تنظیمات نامعتبر است." }, { status: 400 });
  await saveFollowupSetting(ruleId, setting);
  return NextResponse.json({ setting });
}, accountIdFromQuery);
