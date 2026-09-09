import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
export default function config(phase: string): NextConfig {
  return {
    agentRules: false,
    poweredByHeader: false,
    reactStrictMode: true,
    turbopack: {
      resolveAlias: {
        '@transactions-preview':
          phase === PHASE_DEVELOPMENT_SERVER
            ? './dev/TransactionsPreview.tsx'
            : './src/features/transactions/UnavailablePreview.tsx',
        '@content-preview':
          phase === PHASE_DEVELOPMENT_SERVER
            ? './dev/ContentPreview.tsx'
            : './src/features/content/UnavailablePreview.tsx',
        '@overview-preview':
          phase === PHASE_DEVELOPMENT_SERVER
            ? './dev/OverviewPreview.tsx'
            : './src/features/overview/UnavailablePreview.tsx',
        '@access-preview':
          phase === PHASE_DEVELOPMENT_SERVER
            ? './dev/AccessPreview.tsx'
            : './src/features/login/UnavailablePreview.tsx',
        '@foundation-gallery':
          phase === PHASE_DEVELOPMENT_SERVER
            ? './dev/FoundationGallery.tsx'
            : './src/features/foundation/UnavailableGallery.tsx',
      },
    },
    async headers() {
      return [
        {
          source: '/api/v1/:path*',
          headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
        },
      ];
    },
  };
}
