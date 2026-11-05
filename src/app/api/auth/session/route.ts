import { NextResponse } from "next/server";
import { getSetupStatus, readSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await readSessionUser(request);
  const { setupRequired } = await getSetupStatus();
  return NextResponse.json({ authenticated: Boolean(user), user: user ? { id: user.id, username: user.username, role: user.role, profileId: user.profileId, accountId: user.accountId } : null, setupRequired }, { headers: { "Cache-Control": "no-store" } });
}
