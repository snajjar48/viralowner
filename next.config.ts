import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The mock processing engine copies this sample video into storage the
  // first time a render finishes (src/lib/processing/mock-output.ts).
  outputFileTracingIncludes: {
    "/api/projects/**": ["./assets/mock/**"],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
