import { NextResponse } from "next/server";
import { updateUserStore, withAuth } from "@/lib/auth";
import { verifyConnectedAccount } from "@/lib/zernio";

export const runtime = "nodejs";

export const PATCH = withAuth(async (request: Request, context: { params: Promise<{ userId: string }> }) => {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "درخواست معتبر نیست." }, { status: 400 }); }
  const profileId = typeof body.profileId === "string" ? body.profileId.trim() : "";
  const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
  if (!profileId || !accountId) return NextResponse.json({ error: "یک حساب اجتماعی انتخاب کن." }, { status: 400 });
  const verification = await verifyConnectedAccount(profileId, accountId);
  if (!verification.valid) return NextResponse.json({ error: verification.error || "حساب انتخاب‌شده در این پروفایل متصل نیست." }, { status: 400 });
  const userId = (await context.params).userId;
  const updated = await updateUserStore((store) => {
    const target = store.users.find((candidate) => candidate.id === userId && candidate.role === "user");
    if (!target) return null;
    target.profileId = profileId;
    target.accountId = accountId;
    target.sessionVersion += 1;
    return { id: target.id, username: target.username };
  });
  if (!updated) return NextResponse.json({ error: "حساب کاربری پیدا نشد." }, { status: 404 });
  return NextResponse.json({ user: updated, message: "دسترسی کاربر به حساب انتخاب‌شده تغییر کرد و نشست‌های قبلی بسته شدند." });
}, "admin");
