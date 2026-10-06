import './globals.css';
import type { ReactNode } from 'react';
import { AppProvider } from '@/lib/store';
import Shell from '@/components/Shell';

export const metadata = { title: 'Agentic Clinical Trial Matching (mockup)', description: 'Interactive mockup of the Agentic Clinical Trial Matching PRD. Synthetic data only.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProvider>
          <Shell>{children}</Shell>
        </AppProvider>
      </body>
    </html>
  );
}
