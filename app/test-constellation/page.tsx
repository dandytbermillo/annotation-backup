"use client"

import { ConstellationPanel } from '@/components/constellation/constellation-panel'

export default function TestConstellationPage() {
  return (
    <div className="w-screen h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center mb-8">
        <h1 className="text-3xl text-white mb-4">Constellation Canvas Test</h1>
        <p className="text-slate-400 mb-8">This is a standalone test of the canvas component</p>

        <ConstellationPanel />
      </div>
    </div>
  )
}
