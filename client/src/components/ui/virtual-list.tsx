/**
 * High-performance virtual list component for rendering large datasets
 * Optimized for 60,000+ card collections with minimal DOM nodes
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  overscan?: number;
  onScroll?: (scrollTop: number) => void;
  className?: string;
}

export function VirtualList<T>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 5,
  onScroll,
  className = "",
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const scrollElementRef = useRef<HTMLDivElement>(null);

  const totalHeight = items.length * itemHeight;
  
  // Calculate visible range with overscan
  const visibleRange = useMemo(() => {
    const visibleStart = Math.floor(scrollTop / itemHeight);
    const visibleEnd = Math.min(
      visibleStart + Math.ceil(containerHeight / itemHeight),
      items.length - 1
    );
    
    return {
      start: Math.max(0, visibleStart - overscan),
      end: Math.min(items.length - 1, visibleEnd + overscan),
    };
  }, [scrollTop, itemHeight, containerHeight, items.length, overscan]);

  // Get visible items
  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.start, visibleRange.end + 1);
  }, [items, visibleRange]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    setScrollTop(scrollTop);
    onScroll?.(scrollTop);
  }, [onScroll]);

  return (
    <div
      ref={scrollElementRef}
      className={`overflow-auto ${className}`}
      style={{ height: containerHeight }}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div
          style={{
            transform: `translateY(${visibleRange.start * itemHeight}px)`,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
          }}
        >
          {visibleItems.map((item, index) => (
            <div
              key={visibleRange.start + index}
              style={{ height: itemHeight }}
            >
              {renderItem(item, visibleRange.start + index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Optimized card grid component using virtual scrolling
interface VirtualCardGridProps<T> {
  items: T[];
  itemHeight: number;
  itemsPerRow: number;
  containerHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  gap?: number;
  className?: string;
}

export function VirtualCardGrid<T>({
  items,
  itemHeight,
  itemsPerRow,
  containerHeight,
  renderItem,
  gap = 16,
  className = "",
}: VirtualCardGridProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  
  // Group items into rows
  const rows = useMemo(() => {
    const grouped: T[][] = [];
    for (let i = 0; i < items.length; i += itemsPerRow) {
      grouped.push(items.slice(i, i + itemsPerRow));
    }
    return grouped;
  }, [items, itemsPerRow]);

  const rowHeight = itemHeight + gap;
  const totalHeight = rows.length * rowHeight;

  // Calculate visible rows
  const visibleRange = useMemo(() => {
    const visibleStart = Math.floor(scrollTop / rowHeight);
    const visibleEnd = Math.min(
      visibleStart + Math.ceil(containerHeight / rowHeight) + 1,
      rows.length - 1
    );
    
    return {
      start: Math.max(0, visibleStart - 2),
      end: Math.min(rows.length - 1, visibleEnd + 2),
    };
  }, [scrollTop, rowHeight, containerHeight, rows.length]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  return (
    <div
      className={`overflow-auto ${className}`}
      style={{ height: containerHeight }}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div
          style={{
            transform: `translateY(${visibleRange.start * rowHeight}px)`,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
          }}
        >
          {rows.slice(visibleRange.start, visibleRange.end + 1).map((row, rowIndex) => (
            <div
              key={visibleRange.start + rowIndex}
              className="flex gap-4"
              style={{ 
                height: itemHeight,
                marginBottom: gap,
              }}
            >
              {row.map((item, itemIndex) => (
                <div key={itemIndex} className="flex-1">
                  {renderItem(item, (visibleRange.start + rowIndex) * itemsPerRow + itemIndex)}
                </div>
              ))}
              {/* Fill remaining space if row is incomplete */}
              {row.length < itemsPerRow && (
                <div style={{ flex: itemsPerRow - row.length }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}