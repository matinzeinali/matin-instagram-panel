import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";

export const runtime = "nodejs";

export const GET = withAuth(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const destination = new URL("/", request.url);
  const error = params.get("error") || params.get("error_description") || params.get("platformerror");

  if (error) {
    destination.searchParams.set("connection", "failed");
    destination.searchParams.set("reason", error.slice(0, 80));
    return NextResponse.redirect(destination);
  }

  const platform = params.get("connected") || params.get("platform");
  const profileId = params.get("profileId");
  const accountId = params.get("accountId");
  const username = params.get("username");

  if (platform && profileId && accountId) {
    destination.searchParams.set("connection", "connected");
    destination.searchParams.set("platform", platform);
    destination.searchParams.set("profileId", profileId);
    destination.searchParams.set("accountId", accountId);
    if (username) destination.searchParams.set("username", username);
  } else {
    destination.searchParams.set("connection", "incomplete");
  }

  return NextResponse.redirect(destination);
}, "admin");
