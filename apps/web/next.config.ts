import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only the container build (apps/web/Dockerfile) produces the self-contained
  // server; `next start` in dev and CI is untouched.
  output: process.env.DOCKER_BUILD === "1" ? "standalone" : undefined,

  // Dev only: hostnames other than localhost that may load the dev server's
  // assets, e.g. your Mac's LAN address when testing on a real phone. Set
  // ALLOWED_DEV_ORIGINS=192.168.1.20 in .env.local (comma-separated; hostname
  // only, no scheme or port). Without it the page renders on the phone but its
  // JavaScript is blocked with a 403, so forms silently do nothing.
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
};

export default nextConfig;
