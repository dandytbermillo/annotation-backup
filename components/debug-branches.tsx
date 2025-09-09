"use client"

import { useEffect, useState } from "react"
import { UnifiedProvider } from "@/lib/provider-switcher"

export function DebugBranches() {
  const [branches, setBranches] = useState<any[]>([])

  useEffect(() => {
    const updateBranches = () => {
      const provider = UnifiedProvider.getInstance()
      const branchesMap = provider.getBranchesMap()
      const branchArray = Array.from(branchesMap.entries())
      setBranches(branchArray)
    }

    // Initial load
    updateBranches()

    // Update every second
    const interval = setInterval(updateBranches, 1000)

    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      left: 20,
      background: 'rgba(0,0,0,0.8)',
      color: 'white',
      padding: '10px',
      borderRadius: '8px',
      fontSize: '12px',
      maxWidth: '400px',
      maxHeight: '200px',
      overflow: 'auto',
      zIndex: 9999
    }}>
      <h3 style={{ margin: '0 0 10px 0' }}>Debug: Branches ({branches.length})</h3>
      {branches.map(([id, branch]) => (
        <div key={id} style={{ marginBottom: '5px' }}>
          <strong>{id}:</strong> {branch.title} ({branch.type}) - {branch.branches?.length || 0} children
        </div>
      ))}
    </div>
  )
} 
