/** @type {import('next').NextConfig} */
// NEXT_OUTPUT=export builds plain static files (out/) for the desktop app, which serves them itself;
// otherwise the usual standalone server build for Docker.
const desktop = process.env.NEXT_OUTPUT === "export";

const nextConfig = {
  // Standalone output — the Docker build copies only the compiled server +
  // its traced dependencies, not the whole node_modules tree. Same reasoning
  // as the storefront's own next.config.js.
  output: desktop ? "export" : "standalone",
  // No Next image server in a static build.
  images: desktop ? { unoptimized: true } : undefined,
  // Separate build folder so a desktop build never clobbers a running dev server's .next.
  distDir: desktop ? ".next-desktop" : ".next",
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  // This repo sits nested under the storefront's own directory (which has
  // its own lockfile) rather than in a real workspace — pin the root
  // explicitly so Turbopack doesn't guess wrong.
  turbopack: {
    root: __dirname,
  },
};

module.exports = nextConfig;
