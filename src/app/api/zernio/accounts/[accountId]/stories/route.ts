import { pathSegment, proxyZernio } from "@/lib/zernio";
import { withAccountAuth } from "@/lib/auth";

export const runtime = "nodejs";

// Currently active Instagram stories (24h), used to bind a story-reply rule to one story.
export const GET = withAccountAuth(
  (request: Request) => proxyZernio(request, `/accounts/${encodeURIComponent(pathSegment(request, 2))}/instagram/stories`),
  (request) => pathSegment(request, 2),
);
