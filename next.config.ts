import type { NextConfig } from 'next';

// GitHub Pages のプロジェクトサイト（https://<user>.github.io/ai-news-digest/）に置くため
// basePath / assetPrefix が要る。ローカル開発では空にする。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
