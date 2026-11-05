import { pathSegment, proxyZernio } from "@/lib/zernio";
import { withAccountAuth } from "@/lib/auth";

export const runtime = "nodejs";

// The 25 most recent posts that exist on the platform for this account (live from Instagram/Facebook),
// used to bind an auto-reply rule to one post.
export const GET = withAccountAuth(
  (request: Request) => proxyZernio(request, `/accounts/${encodeURIComponent(pathSegment(request, 2))}/posts`),
  (request) => pathSegment(request, 2),
);
