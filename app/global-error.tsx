'use client';
import { PageFailure } from '@/shared/ui/PageFailure';
import { useEffect } from 'react';
import { restoreTheme } from '@/shared/theme/restore-theme';
import '@fontsource-variable/inter';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/noto-sans-thai';
import '@/shared/theme/typography.css';
import '@/shared/theme/tokens.css';

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { restoreTheme(); }, []);
  return <html lang="th"><body><PageFailure digest={error.digest} onRetry={() => window.location.reload()} /></body></html>;
}
