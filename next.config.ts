import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.G0_ENABLED === "1" ? ".next-g0" : ".next",
  /* config options here */
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    // reactCompiler: true,
    // turbopackFileSystemCache: true,
    optimizePackageImports: ['lucide-react'],
    cssChunking: 'strict', // More granular CSS chunks
    inlineCss: true, // Inline critical CSS
    useLightningcss: true, // Faster CSS compilation (experimental)
  },
};

export default nextConfig;
