import type { NextConfig } from "next";

const isDesktopBuild = process.env.DESKTOP_BUILD === "true";

const nextConfig: NextConfig = {
  reactCompiler: true,
  ...(isDesktopBuild
    ? {
        output: "export" as const,
        images: {
          unoptimized: true,
        },
      }
    : {}),
};

export default nextConfig;
