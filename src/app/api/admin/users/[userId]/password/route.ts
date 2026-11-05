import { NextResponse } from "next/server";
import { createUser, updateUserStore, validateCredentials, withAuth } from "@/lib/auth";

export const runtime = "nodejs";

export const PATCH = withAuth(async (request: Request, context: { params: Promise<{ userId: string }> }) => {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "درخواست معتبر نیست." }, { status: 400 }); }
  const userId = (await context.params).userId;
  const user = await updateUserStore(async (store) => {
    const target = store.users.find((candidate) => candidate.id === userId);
    if (!target) return null;
    const credentials = validateCredentials(target.username, body.newPassword);
    if ("error" in credentials) throw new Error(credentials.error);
    const replacement = await createUser(target.username, credentials.password, target.role);
    target.passwordSalt = replacement.passwordSalt;
    target.passwordHash = replacement.passwordHash;
    target.sessionVersion += 1;
    return { id: target.id, username: target.username };
  }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "بازنشانی گذرواژه انجام نشد." }));
  if (!user) return NextResponse.json({ error: "حساب پیدا نشد." }, { status: 404 });
  if ("error" in user) return NextResponse.json({ error: user.error }, { status: 400 });
  return NextResponse.json({ user, message: "گذرواژه عوض شد؛ نشست‌های قبلی این کاربر باطل شدند." });
}, "admin");
