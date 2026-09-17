'use client';
import { PageFailure } from '@/shared/ui/PageFailure';
export default function ErrorPage({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageFailure digest={error.digest} onRetry={() => window.location.reload()} />;
}
