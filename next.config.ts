import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
export default function config(phase: string): NextConfig {
  return {
    agentRules: false,
    poweredByHeader: false,
    reactStrictMode: true,
    turbopack: {
      resolveAlias: {
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
