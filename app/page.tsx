"use client"

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Page() {
  const router = useRouter()
  
  useEffect(() => {
    // Redirect to Context-OS with a default feature
    router.push('/context-os?feature=new_feature')
  }, [router])
  
  return (
    <div className="w-screen h-screen flex items-center justify-center bg-gray-950">
      <div className="text-white text-2xl font-semibold animate-pulse">Redirecting to Context-OS...</div>
    </div>
  )
}
