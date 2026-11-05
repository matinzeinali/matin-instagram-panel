import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve("."),
  // Keep production builds isolated from a concurrently running `next dev` server.
  distDir: process.env.NEXT_DIST_DIR?.trim() || (process.env.NODE_ENV === "production" ? ".next-prod" : ".next"),
};
export default nextConfig;
