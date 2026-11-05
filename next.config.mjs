/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // PGlite loads its WASM/data files through import.meta.url; webpack rewrites
  // those URLs into objects, breaking its Node FS adapter. Keep the driver (and
  // postgres-js, which must not be bundled) external to the server build.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  webpack: (config, { dev }) => {
    if (dev) {
      // PGlite writes its WAL into .data/pglite on every query. Without this the
      // dev watcher recompiles on each write and aborts in-flight server actions.
      config.watchOptions = {
        ...(config.watchOptions ?? {}),
        ignored: ["**/node_modules/**", "**/.git/**", "**/.data/**", "**/.next/**"],
      };
    }
    return config;
  },
};

export default nextConfig;
