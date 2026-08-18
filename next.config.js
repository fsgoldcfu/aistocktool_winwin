/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  experimental: {
    // indexAnalysis reads these CSVs at runtime in the two dynamic API routes.
    // Explicit tracing prevents Vercel from omitting them from the serverless bundle.
    outputFileTracingIncludes: {
      '/api/index-scanner': ['./data/index-history/*.csv'],
      '/api/today-picks': ['./data/index-history/*.csv'],
    },
  },
};

module.exports = nextConfig;
