import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@shared/rest", "@shared/types", "@shared/env", "@shared/brand"],
};

export default nextConfig;
