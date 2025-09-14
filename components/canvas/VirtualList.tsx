"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"

interface VirtualListProps<T> {
  items: T[]
  itemHeight: number
  height?: number
  overscan?: number
  renderItem: (item: T, index: number) => React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export function VirtualList<T>({
  items,
  itemHeight,
  height,
  overscan = 6,
  renderItem,
  className,
  style,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null)
  const [scrollTop, setScrollTop] = useState(0)

  const effectiveHeight = height ?? measuredHeight ?? 0

  // Measure height if not provided
  useEffect(() => {
    if (height || !containerRef.current) return
    const el = containerRef.current

    const measure = () => {
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.height && rect.height !== measuredHeight) {
        setMeasuredHeight(rect.height)
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [height, measuredHeight])

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.target as HTMLDivElement).scrollTop)
  }, [])

  const totalHeight = items.length * itemHeight
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
  const visibleCount = effectiveHeight ? Math.ceil(effectiveHeight / itemHeight) + overscan * 2 : 0
  const endIndex = Math.min(items.length, startIndex + visibleCount)

  const slice = useMemo(() => items.slice(startIndex, endIndex), [items, startIndex, endIndex])
  const offsetY = startIndex * itemHeight

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ overflowY: 'auto', position: 'relative', height, ...style }}
      onScroll={onScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: offsetY, left: 0, right: 0 }}>
          {slice.map((item, i) => (
            <div key={startIndex + i} style={{ height: itemHeight }}>
              {renderItem(item, startIndex + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default VirtualList

