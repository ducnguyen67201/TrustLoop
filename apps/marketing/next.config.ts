import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Self-contained server bundle for Docker deploys (Railway, Fly, Render, etc.)
  output: "standalone",
  // Trace files from the monorepo root so workspace packages (@shared/brand)
  // are included in the standalone output.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Let Next transpile TS source from shared workspace packages.
  transpilePackages: ["@shared/brand"],
};

export default nextConfig;
