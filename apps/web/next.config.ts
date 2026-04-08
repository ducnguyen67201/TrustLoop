import type { NextConfig } from "next";
import path from "node:path";

// Skip Next.js lockfile patching for SWC packages — in npm workspace monorepos,
// the package manager detection runs from apps/web/ (no lockfile), falls through
// to globally-installed pnpm, and fails. The SWC binary is installed correctly
// via optionalDependencies.
process.env.NEXT_IGNORE_INCORRECT_LOCKFILE = "1";

const monorepoRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  transpilePackages: ["@shared/rest", "@shared/types", "@shared/env"],
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
