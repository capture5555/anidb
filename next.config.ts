import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Cloudflare Workers には Next.js の画像最適化サーバーが無いため無効化。
    // 社内サイトなので原寸配信で許容（必要になったら Cloudflare Images loader を導入）。
    unoptimized: true,
  },
};

export default nextConfig;
