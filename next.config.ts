import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Annict / しょぼいカレンダー / 公式サイト等の外部画像を許可
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
};

export default nextConfig;
