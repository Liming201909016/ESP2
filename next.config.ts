import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@modelcontextprotocol/sdk", "@azure/storage-blob"],
};

export default nextConfig;
