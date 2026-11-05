import { proxyZernio } from "@/lib/zernio";
import { withAccountAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const GET = withAccountAuth((request: Request) => proxyZernio(request, "/inbox/conversations"), (request) => new URL(request.url).searchParams.get("accountId") || "");
