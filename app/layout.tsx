import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageMotion } from '@/shared/motion/PageMotion';
import { NavigationQueryCache } from '@/shared/query/NavigationQueryCache';
import { ThemeProvider } from '@/shared/theme/ThemeProvider';
import { restoreTheme } from '@/shared/theme/restore-theme';
import '@fontsource-variable/inter';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/noto-sans-thai';
import '@/shared/theme/typography.css';
import '@/shared/theme/tokens.css';
import '@/shared/motion/interaction.css';
export const metadata: Metadata = {
  title: 'Labs D x Partner',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(${restoreTheme.toString()})();` }} />
      </head>
      <body>
        <NavigationQueryCache>
          <ThemeProvider>{children}</ThemeProvider>
        </NavigationQueryCache>
        <Suspense fallback={null}>
          <PageMotion />
        </Suspense>
      </body>
    </html>
  );
}
