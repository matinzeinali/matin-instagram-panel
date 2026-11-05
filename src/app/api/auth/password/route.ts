import { NextResponse } from "next/server";
import { clearSessionCookie, createUser, passwordMatches, readSessionUser, updateUserStore, validateCredentials, withAuth } from "@/lib/auth";

export const runtime = "nodejs";

export const POST = withAuth(async (request: Request) => {
  const sessionUser = await readSessionUser(request);
  if (!sessionUser) return NextResponse.json({ error: "نشست منقضی شده است." }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "درخواست معتبر نیست." }, { status: 400 }); }
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const credentials = validateCredentials(sessionUser.username, body.newPassword);
  if ("error" in credentials) return NextResponse.json({ error: credentials.error }, { status: 400 });

  const updated = await updateUserStore(async (store) => {
    const user = store.users.find((candidate) => candidate.id === sessionUser.id);
    if (!user || !(await passwordMatches(currentPassword, user))) return false;
    const replacement = await createUser(user.username, credentials.password, user.role);
    user.passwordSalt = replacement.passwordSalt;
    user.passwordHash = replacement.passwordHash;
    user.sessionVersion += 1;
    return true;
  });
  if (!updated) return NextResponse.json({ error: "گذرواژهٔ فعلی درست نیست." }, { status: 400 });
  const response = NextResponse.json({ success: true, message: "گذرواژه عوض شد؛ دوباره وارد شو." });
  clearSessionCookie(response);
  return response;
});
