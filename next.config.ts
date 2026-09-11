import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin the workspace root — the parent Desktop\Startup folder has an
  // unrelated package-lock.json from another project that Turbopack was
  // otherwise auto-detecting as the root.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
