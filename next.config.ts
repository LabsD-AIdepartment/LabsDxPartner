import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
export default function config(phase: string): NextConfig {
  return {
    agentRules: false,
    devIndicators: false,
    poweredByHeader: false,
    reactStrictMode: true,
    turbopack: {
      resolveAlias: {
        '@partner-pitch': phase === PHASE_DEVELOPMENT_SERVER ? './dev/PitchApplication.tsx' : './src/features/pitch/UnavailablePitch.tsx',
        '@marketing-ads-preview':
          phase === PHASE_DEVELOPMENT_SERVER
            ? './dev/AdRegistrationPreview.tsx'
            : './src/features/marketing-ads/UnavailablePreview.tsx',
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
        '@withdrawal-preview':
          phase === PHASE_DEVELOPMENT_SERVER
            ? './dev/WithdrawalPreview.tsx'
            : './src/features/withdrawals/UnavailablePreview.tsx',
        '@access-preview':
          phase === PHASE_DEVELOPMENT_SERVER
            ? './dev/AccessPreview.tsx'
            : './src/features/login/UnavailablePreview.tsx',
        '@foundation-gallery':
          phase === PHASE_DEVELOPMENT_SERVER
            ? './dev/FoundationGallery.tsx'
            : './src/features/foundation/UnavailableGallery.tsx',
        // Development-only demo-dataset snapshot handler. Outside the dev server this resolves to a
        // 404 stub, so the node:sqlite read path (and its fixture marker) never ships to production.
        '@demo-dataset-handler':
          phase === PHASE_DEVELOPMENT_SERVER
            ? './dev/demo-dataset/handler.ts'
            : './dev/demo-dataset/handler.unavailable.ts',
        // Development-only ad-performance snapshot handler. Outside the dev server this resolves to a
        // 404 stub, so the node:fs snapshot read path (and its fixture marker) never ships to production.
        '@ad-performance-handler':
          phase === PHASE_DEVELOPMENT_SERVER
            ? './dev/ad-performance/handler.ts'
            : './dev/ad-performance/handler.unavailable.ts',
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
