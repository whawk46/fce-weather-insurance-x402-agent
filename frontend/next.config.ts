import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["ecies-geth", "dotenv"],
};

export default nextConfig;
