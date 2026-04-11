import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for Docker deploys (Railway, Fly, Render, etc.)
  output: "standalone",
  // Trace files from the monorepo root so workspace packages (@shared/brand)
  // are included in the standalone output. `next build` always runs from the
  // package root, so resolving against cwd is safe and avoids the import.meta
  // usage that trips Next 16's CJS config compiler in an ESM package.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  // Let Next transpile TS source from shared workspace packages.
  transpilePackages: ["@shared/brand"],
};

export default nextConfig;
