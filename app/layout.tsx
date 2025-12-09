import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'v0 App',
  description: 'Created with v0',
  generator: 'v0.dev',
}

import { PersistenceMonitor } from '@/components/persistence-monitor'
import { PlainModeProvider } from './providers/plain-mode-provider'
import { Toaster } from '@/components/ui/toaster'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#4F46E5" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body>
        <PlainModeProvider>
          {children}
          <PersistenceMonitor />
          <Toaster />
        </PlainModeProvider>
      </body>
    </html>
  )
}
