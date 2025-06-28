"use client"

import dynamic from 'next/dynamic'

const AnnotationApp = dynamic(
  () => import('@/components/annotation-app').then(mod => ({ default: mod.AnnotationApp })),
  { 
    ssr: false,
    loading: () => (
      <div className="w-screen h-screen flex items-center justify-center bg-gray-950">
        <div className="text-white text-2xl font-semibold animate-pulse">Loading application...</div>
      </div>
    )
  }
)

export default function Page() {
  return <AnnotationApp />
}
