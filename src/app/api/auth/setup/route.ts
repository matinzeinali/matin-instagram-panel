import { NextResponse } from "next/server";
import { createUser, setSessionCookie, updateUserStore, validateCredentials } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "درخواست معتبر نیست." }, { status: 400 }); }
  const credentials = validateCredentials(body.username, body.password);
  if ("error" in credentials) return NextResponse.json({ error: credentials.error }, { status: 400 });

  const user = await updateUserStore(async (store) => {
    if (store.users.some((candidate) => candidate.role === "admin")) return null;
    const admin = await createUser(credentials.username, credentials.password, "admin");
    store.users.push(admin);
    return admin;
  });
  if (!user) return NextResponse.json({ error: "راه‌اندازی قبلاً انجام شده است؛ وارد حساب شو." }, { status: 409 });
  const response = NextResponse.json({ user: { id: user.id, username: user.username, role: user.role, profileId: user.profileId, accountId: user.accountId } });
  await setSessionCookie(response, user);
  return response;
}
