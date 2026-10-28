/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output — the Docker build copies only the compiled server +
  // its traced dependencies, not the whole node_modules tree. Same reasoning
  // as the storefront's own next.config.js.
  output: "standalone",
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
