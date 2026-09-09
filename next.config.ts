import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
export default function config(phase: string): NextConfig {
  return {
    agentRules: false,
    poweredByHeader: false,
    reactStrictMode: true,
    turbopack: {
      resolveAlias: {
        '@account-preview':
          phase === PHASE_DEVELOPMENT_SERVER
            ? './dev/AccountPreview.tsx'
            : './src/features/account/UnavailablePreview.tsx',
        '@operations-preview':
          phase === PHASE_DEVELOPMENT_SERVER
            ? './dev/OperationsPreview.tsx'
            : './src/features/operations/UnavailablePreview.tsx',
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
        ...['/login', '/invite', '/reset-password'].map((source) => ({
          source,
          headers: [
            { key: 'Cache-Control', value: 'private, no-store' },
            { key: 'Referrer-Policy', value: 'no-referrer' },
            {
              key: 'Content-Security-Policy',
              value:
                "connect-src 'self'; img-src 'self' data:; font-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'",
            },
          ],
        })),
        {
          source: '/api/v1/:path*',
          headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
        },
      ];
    },
  };
}
