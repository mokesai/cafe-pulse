import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Packages that should only run on Node.js server (not edge runtime)
  // googleapis uses CommonJS exports which breaks the edge runtime
  serverExternalPackages: ['googleapis', 'google-auth-library'],

  // Enable experimental features for better performance
  experimental: {
    // Disabled: causes `next build` to crash with `TypeError: Cannot read properties of undefined (reading 'length')`
    // on this project (Next.js 15.5.7).
    // optimizePackageImports: ['lucide-react', '@supabase/supabase-js'],
  },

  // Image optimization settings
  images: {
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60,
  },

  // Webpack optimizations
  webpack: (config) => {
    config.optimization.splitChunks = {
      ...config.optimization.splitChunks,
      cacheGroups: {
        ...config.optimization.splitChunks?.cacheGroups,
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all' as const,
          minSize: 20000,
          maxSize: 244000,
        },
        admin: {
          test: /[\\/]src[\\/]components[\\/]admin[\\/]/,
          name: 'admin',
          chunks: 'all' as const,
          minSize: 10000,
        },
      },
    }
    return config
  },

  compress: true,

  eslint: {
    dirs: ['src'],
    ignoreDuringBuilds: true,
  },

  typescript: {
    ignoreBuildErrors: true,
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
        ],
      },
      {
        source: '/images/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ]
  },
};

export default nextConfig;
