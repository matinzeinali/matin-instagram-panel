import { pathSegment, proxyZernio } from "@/lib/zernio";
import { withAccountAuth } from "@/lib/auth";

export const runtime = "nodejs";

function endpoint(request: Request) {
  return `/inbox/comments/${encodeURIComponent(pathSegment(request, 1))}`;
}

export const GET = withAccountAuth((request: Request) => proxyZernio(request, endpoint(request)), (request) => new URL(request.url).searchParams.get("accountId") || "");
export const POST = withAccountAuth((request: Request) => proxyZernio(request, endpoint(request)), async (request) => {
  const body = await request.json() as { accountId?: unknown };
  return typeof body.accountId === "string" ? body.accountId : undefined;
});
