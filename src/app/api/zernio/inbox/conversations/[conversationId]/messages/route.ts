import { pathSegment, proxyZernio } from "@/lib/zernio";
import { withAccountAuth } from "@/lib/auth";

export const runtime = "nodejs";

function endpoint(request: Request) {
  return `/inbox/conversations/${encodeURIComponent(pathSegment(request, 2))}/messages`;
}

export const GET = withAccountAuth((request: Request) => proxyZernio(request, endpoint(request)), (request) => new URL(request.url).searchParams.get("accountId") || "");
export const POST = withAccountAuth((request: Request) => proxyZernio(request, endpoint(request)), (request) => new URL(request.url).searchParams.get("accountId") || "");
