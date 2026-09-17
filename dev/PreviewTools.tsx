'use client';
import { useApplicationPresentation } from '@/shared/routing/ApplicationPresentation';
import { Suspense, useSyncExternalStore, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/shared/ui/Button';
import styles from './preview-tools.module.css';

const changed = 'preview-tools-closed';
function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(changed, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(changed, listener);
  };
}
function enabled() {
  return new URLSearchParams(window.location.search).get('devtools') === '1';
}
const serverClosed = () => false;
function closeTools() {
  const url = new URL(window.location.href);
  url.searchParams.delete('devtools');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  window.dispatchEvent(new Event(changed));
}

/** Page-local explicit URL opt-in. Closed children are never mounted; no persisted preference. */
export function PreviewTools({
  children,
  toolbar = false,
}: {
  children: ReactNode;
  toolbar?: boolean;
}) {
  const { sampleData } = useApplicationPresentation();
  if (sampleData) return null;
  return (
    <Suspense fallback={null}>
      <ToolsGate toolbar={toolbar}>{children}</ToolsGate>
    </Suspense>
  );
}

function ToolsGate({ children, toolbar }: { children: ReactNode; toolbar: boolean }) {
  // Next also notifies this hook for router navigation and its supported native history integration.
  // The external subscription supplies immediate shared-close/back updates without patching history.
  useSearchParams();
  const open = useSyncExternalStore(subscribe, enabled, serverClosed);
  return (
    <>
      {open && (
        <>
          {toolbar && (
            <div className={styles.close}>
              <Button onClick={closeTools}>ปิดเครื่องมือทดสอบ</Button>
            </div>
          )}
          {children}
        </>
      )}
    </>
  );
}
