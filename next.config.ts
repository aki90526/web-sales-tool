import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: "./tsconfig.next.json"
  },

  // 左下の Next.js 開発インジケータを非表示（エラーは引き続き表示される）
  devIndicators: false,

  // 別デバイス（同一LAN / Tailscale）から dev サーバーに繋ぐとき用（cross-origin 許可）
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "akihitos-MacBook-Pro.local",
    "akihitos-macbook-pro",
    "192.168.10.14", // 同一LAN
    "100.120.106.69", // Tailscale（このMac）
    "*.local",
    "*.ts.net" // Tailscale MagicDNS
  ]
};

export default nextConfig;
