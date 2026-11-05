import { NextResponse } from "next/server";
import { findUserByUsername, passwordMatches, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
const failedAttempts = new Map<string, { count: number; firstAt: number; blockedUntil: number }>();
const maxAttempts = 6;
const attemptWindowMs = 15 * 60 * 1000;

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const existing = failedAttempts.get(ip);
  if (existing?.blockedUntil && existing.blockedUntil > now) return NextResponse.json({ error: "تعداد تلاش‌ها زیاد بود. ۱۵ دقیقه دیگر دوباره امتحان کن." }, { status: 429 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "نام کاربری یا گذرواژه نادرست است." }, { status: 401 }); }
  const username = typeof body.username === "string" ? body.username.normalize("NFKC").trim().toLocaleLowerCase("en-US") : "";
  const password = typeof body.password === "string" ? body.password : "";
  const user = await findUserByUsername(username);
  const valid = Boolean(user && await passwordMatches(password, user));
  if (!valid || !user) {
    const attempts = existing && now - existing.firstAt < attemptWindowMs ? existing : { count: 0, firstAt: now, blockedUntil: 0 };
    attempts.count += 1;
    if (attempts.count >= maxAttempts) attempts.blockedUntil = now + attemptWindowMs;
    failedAttempts.set(ip, attempts);
    return NextResponse.json({ error: "نام کاربری یا گذرواژه نادرست است." }, { status: 401 });
  }

  failedAttempts.delete(ip);
  const response = NextResponse.json({ user: { id: user.id, username: user.username, role: user.role, profileId: user.profileId, accountId: user.accountId } });
  await setSessionCookie(response, user);
  return response;
}
