import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'v0 App',
  description: 'Created with v0',
  generator: 'v0.dev',
}

import { PlainModeProvider } from './providers/plain-mode-provider'
import { KnownTermsProvider } from './providers/known-terms-provider'
import { Toaster } from '@/components/ui/toaster'
import { buildKnownTermsSnapshot } from '@/lib/docs/known-terms-snapshot'

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Build knownTerms snapshot at SSR time for cold-start availability
  const knownTermsSnapshot = await buildKnownTermsSnapshot()

  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#4F46E5" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body>
        <KnownTermsProvider snapshot={knownTermsSnapshot}>
          <PlainModeProvider>
            {children}
            <Toaster />
          </PlainModeProvider>
        </KnownTermsProvider>
      </body>
    </html>
  )
}
