import type { Metadata } from 'next';
import { ThemeProvider } from '@/shared/theme/ThemeProvider';
import '@fontsource-variable/inter';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/noto-sans-thai';
import '@/shared/theme/tokens.css';
export const metadata: Metadata = {
  title: 'Labs D x Partner',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
