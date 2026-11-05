import { proxyZernio } from "@/lib/zernio";
import { withAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const GET = withAuth((request: Request) => proxyZernio(request, "/analytics/dashboard"), "admin");
