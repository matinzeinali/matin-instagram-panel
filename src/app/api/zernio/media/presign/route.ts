import { proxyZernio } from "@/lib/zernio";
import { withAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const POST = withAuth((request: Request) => proxyZernio(request, "/media/presign"));
