import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'v0 App',
  description: 'Created with v0',
  generator: 'v0.dev',
}

import { PersistenceMonitor } from '@/components/persistence-monitor'
import { PlainModeProvider } from './providers/plain-mode-provider'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        <PlainModeProvider>
          {children}
          <PersistenceMonitor />
        </PlainModeProvider>
      </body>
    </html>
  )
}
