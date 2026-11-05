import { NextResponse } from "next/server";
import { createUser, listUsers, updateUserStore, validateCredentials, withAuth } from "@/lib/auth";
import { verifyConnectedAccount } from "@/lib/zernio";

export const runtime = "nodejs";

export const GET = withAuth(async () => NextResponse.json({ users: await listUsers() }), "admin");

export const POST = withAuth(async (request: Request) => {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "درخواست معتبر نیست." }, { status: 400 }); }
  const credentials = validateCredentials(body.username, body.password);
  if ("error" in credentials) return NextResponse.json({ error: credentials.error }, { status: 400 });
  const profileId = typeof body.profileId === "string" ? body.profileId.trim() : "";
  const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
  if (!profileId || !accountId) return NextResponse.json({ error: "برای این کاربر یک حساب اجتماعی انتخاب کن." }, { status: 400 });
  const verification = await verifyConnectedAccount(profileId, accountId);
  if (!verification.valid) return NextResponse.json({ error: verification.error || "حساب انتخاب‌شده در این پروفایل متصل نیست." }, { status: 400 });
  const created = await updateUserStore(async (store) => {
    if (store.users.some((candidate) => candidate.username === credentials.username)) return false;
    store.users.push(await createUser(credentials.username, credentials.password, "user", { profileId, accountId }));
    return true;
  });
  if (!created) return NextResponse.json({ error: "این نام کاربری قبلاً استفاده شده است." }, { status: 409 });
  return NextResponse.json({ users: await listUsers() }, { status: 201 });
}, "admin");
