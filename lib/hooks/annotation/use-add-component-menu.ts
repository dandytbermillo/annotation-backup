"use client"

import { useMemo, useState, useCallback } from "react"

interface UseAddComponentMenuOptions {
  externalShowAddComponentMenu?: boolean
  onToggleAddComponentMenu?: () => void
}

export function useAddComponentMenu({
  externalShowAddComponentMenu,
  onToggleAddComponentMenu,
}: UseAddComponentMenuOptions) {
  const [internalShowAddComponentMenu, setInternalShowAddComponentMenu] = useState(false)

  const showAddComponentMenu = useMemo(() => {
    return externalShowAddComponentMenu !== undefined
      ? externalShowAddComponentMenu
      : internalShowAddComponentMenu
  }, [externalShowAddComponentMenu, internalShowAddComponentMenu])

  const toggleAddComponentMenu = useCallback(() => {
    if (onToggleAddComponentMenu) {
      onToggleAddComponentMenu()
      return
    }

    setInternalShowAddComponentMenu(prev => !prev)
  }, [onToggleAddComponentMenu])

  const closeAddComponentMenu = useCallback(() => {
    if (onToggleAddComponentMenu && externalShowAddComponentMenu !== undefined) {
      onToggleAddComponentMenu()
      return
    }

    setInternalShowAddComponentMenu(false)
  }, [externalShowAddComponentMenu, onToggleAddComponentMenu])

  return {
    showAddComponentMenu,
    toggleAddComponentMenu,
    closeAddComponentMenu,
    setInternalShowAddComponentMenu,
  }
}
