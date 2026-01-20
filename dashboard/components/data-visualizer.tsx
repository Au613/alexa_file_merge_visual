'use client'

import { useMemo, useState } from 'react'
import { Table, BarChart3, FileSpreadsheet, ArrowUpDown, History, EyeOff, Eye, Clock, ArrowRight, Download, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useData } from '@/lib/data-context'
import { getRainbowColor, getTimeBlockColor, formatDate, formatTime, RAINBOW_COLORS } from '@/lib/types'
import type { DataRow } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'

interface DataVisualizerProps {
  className?: string
}

export function DataVisualizer({ className }: DataVisualizerProps) {
  const { 
    filteredData, 
    selectedFiles, 
    selectedDay, 
    mergedData,
    excludedData,
    toggleRowExclusion,
    clearExclusions,
    exportLogAsJSON,
    exportLogAsCSV,
    exportExcludedAsCSV,
    reverseMerge
  } = useData()
  const [view, setView] = useState<'table' | 'segments' | 'log'>('table')
  const [showExcluded, setShowExcluded] = useState(true)
  const [sortColumn, setSortColumn] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const sortedData = useMemo(() => {
    if (!sortColumn) return filteredData
    
    return [...filteredData].sort((a, b) => {
      const aVal = a[sortColumn as keyof DataRow]
      const bVal = b[sortColumn as keyof DataRow]
      
      if (aVal === null || aVal === undefined) return 1
      if (bVal === null || bVal === undefined) return -1
      
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
      }
      
      const comparison = String(aVal).localeCompare(String(bVal))
      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [filteredData, sortColumn, sortDirection])

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  // Calculate segment distribution - group by time block (each 2-hour chunk)
  const segmentStats = useMemo(() => {
    const stats = new Map<string, { count: number; fileName: string; fileIndex: number; timeRange: string }>()
    
    filteredData.forEach(row => {
      // Use time range as key to group by 2-hour blocks
      const key = row._timeRange
      const existing = stats.get(key)
      if (existing) {
        existing.count++
      } else {
        stats.set(key, {
          count: 1,
          fileName: row._sourceFileName,
          fileIndex: row._sourceFileIndex,
          timeRange: row._timeRange
        })
      }
    })
    
    // Sort by time (extract start hour from time range label)
    return Array.from(stats.values()).sort((a, b) => {
      const aHour = parseInt(a.timeRange.split(' ')[0].replace(/[^0-9]/g, ''), 10)
      const bHour = parseInt(b.timeRange.split(' ')[0].replace(/[^0-9]/g, ''), 10)
      return aHour - bHour
    })
  }, [filteredData])

  // Data columns matching the Excel format
  const columns = [
    { key: 'subject', label: 'Subject/Observer' },
    { key: 'timestamp', label: 'Timestamp' },
    { key: 'behavior', label: 'Behavior Code' },
    { key: '_sourceFileName', label: 'File' }
  ]
  
  // Helper to truncate filename
  const truncateFileName = (name: string) => {
    // Remove extension and truncate to reasonable length
    const withoutExt = name.replace(/\.[^.]+$/, '')
    if (withoutExt.length > 20) {
      return withoutExt.slice(0, 18) + '...'
    }
    return withoutExt
  }

  if (!selectedDay || filteredData.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full text-center p-8", className)}>
        <div className="p-4 rounded-full bg-muted mb-4">
          <Table className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No Data Selected</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Select a day from the navigator to view merged behavior data with color-coded file segments.
        </p>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div>
          <h3 className="text-sm font-semibold">{formatDate(selectedDay.date)}</h3>
          <p className="text-xs text-muted-foreground">
            {filteredData.length.toLocaleString()} observations from {selectedFiles.length} files
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as 'table' | 'segments' | 'log')}>
            <TabsList className="h-8">
              <TabsTrigger value="table" className="text-xs px-3 h-7">
                <Table className="w-3 h-3 mr-1" />
                Table
              </TabsTrigger>
              <TabsTrigger value="segments" className="text-xs px-3 h-7">
                <BarChart3 className="w-3 h-3 mr-1" />
                Segments
              </TabsTrigger>
              <TabsTrigger value="log" className="text-xs px-3 h-7">
                <History className="w-3 h-3 mr-1" />
                Log
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {excludedData.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={clearExclusions}
              className="h-7 text-xs bg-transparent"
            >
              Clear Exclusions ({excludedData.length})
            </Button>
          )}
        </div>
      </div>

      {/* Segment Legend */}
      <div className="px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            <span className="text-xs text-muted-foreground mr-2 flex-shrink-0">Time Blocks:</span>
            {segmentStats.map((stat) => {
              const color = getTimeBlockColor(stat.timeRange)
              return (
                <Badge 
                  key={stat.timeRange}
                  variant="outline" 
                  className="text-[10px] px-2 flex items-center gap-1 flex-shrink-0"
                >
                  <div 
                    className="w-2 h-2 rounded-full" 
                    style={{ backgroundColor: color.hex }}
                  />
                  <span>{stat.timeRange}</span>
                  <span className="text-muted-foreground">({stat.count})</span>
                </Badge>
              )
            })}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {excludedData.length > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                <EyeOff className="w-3 h-3 mr-1" />
                {excludedData.length} excluded
              </Badge>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowExcluded(!showExcluded)}
              className="h-6 text-[10px] px-2"
            >
              {showExcluded ? <Eye className="w-3 h-3 mr-1" /> : <EyeOff className="w-3 h-3 mr-1" />}
              {showExcluded ? 'Hide' : 'Show'} Excluded
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      {view === 'table' ? (
        <>
          {/* Table */}
          <ScrollArea className="flex-1">
            <div className="min-w-[700px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border">
                    <th className="w-8 px-2 py-2 text-left font-medium text-muted-foreground">Inc</th>
                    <th className="w-8 px-2 py-2 text-left font-medium text-muted-foreground">#</th>
                    <th className="w-12 px-2 py-2 text-left font-medium text-muted-foreground">File</th>
                    <th className="w-3 px-1"></th>
                    {columns.map(col => (
                      <th 
                        key={col.key}
                        className="px-3 py-2 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                        onClick={() => handleSort(col.key)}
                      >
                        <div className="flex items-center gap-1">
                          {col.label}
                          {sortColumn === col.key && (
                            <ArrowUpDown className={cn(
                              "w-3 h-3",
                              sortDirection === 'desc' && "rotate-180"
                            )} />
                          )}
                        </div>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      Time Block
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedData
                    .filter(row => showExcluded || !row._excluded)
                    .map((row, idx) => {
                    const color = getTimeBlockColor(row._timeRange)
                    const isExcluded = row._excluded
                    
                    return (
                      <tr 
                        key={row._rowId}
                        className={cn(
                          "border-b border-border/50 transition-colors",
                          isExcluded 
                            ? "bg-destructive/10 opacity-50" 
                            : "hover:bg-muted/30"
                        )}
                        style={{ backgroundColor: isExcluded ? undefined : `${color.hex}10` }}
                      >
                        <td className="px-2 py-1.5">
                          <Checkbox
                            checked={!isExcluded}
                            onCheckedChange={() => toggleRowExclusion(row._rowId)}
                            className="w-4 h-4"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-xs text-muted-foreground font-mono">
                          {idx + 1}
                        </td>
                        <td className="px-2 py-1.5 text-xs text-muted-foreground font-mono">
                          {row._sourceFileIndex + 1}
                        </td>
                        <td className="px-1 py-1.5">
                          <div 
                            className={cn(
                              "w-2 h-full min-h-[24px] rounded-sm",
                              isExcluded && "opacity-30"
                            )}
                            style={{ backgroundColor: color.hex }}
                            title={row._timeRange}
                          />
                        </td>
                        <td className={cn("px-3 py-1.5", isExcluded && "line-through")}>
                          <span className="font-medium">{row.subject}</span>
                        </td>
                        <td className={cn("px-3 py-1.5 font-mono text-xs", isExcluded && "line-through")}>
                          {row.timestamp}
                        </td>
                        <td className="px-3 py-1.5">
                          <Badge 
                            variant="secondary"
                            className={cn("text-[10px] font-mono", isExcluded && "opacity-50")}
                          >
                            {row.behavior}
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5">
                          <span 
                            className={cn("text-xs font-mono text-muted-foreground", isExcluded && "line-through")}
                            title={row._sourceFileName}
                          >
                            {truncateFileName(row._sourceFileName)}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          <span 
                            className={cn("text-xs px-2 py-0.5 rounded-full", isExcluded && "opacity-50")}
                            style={{ 
                              backgroundColor: `${color.hex}20`,
                              color: color.hex
                            }}
                          >
                            {row._timeRange}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          {/* Summary Footer */}
          <div className="flex items-center justify-between p-3 border-t border-border bg-muted/30">
            <div className="text-xs text-muted-foreground">
              <span className="text-foreground font-medium">{mergedData.filter(r => !r._excluded).length.toLocaleString()}</span> included
              {excludedData.length > 0 && (
                <span className="ml-2 text-destructive">
                  <span className="font-medium">{excludedData.length}</span> excluded
                </span>
              )}
              <span className="ml-2">of {mergedData.length.toLocaleString()} total</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {segmentStats.map((stat) => {
                const color = getTimeBlockColor(stat.timeRange)
                return (
                  <span key={stat.timeRange} className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color.hex }} />
                    {stat.timeRange}: {stat.count}
                  </span>
                )
              })}
            </div>
          </div>
        </>
      ) : view === 'log' ? (
        <MergeLogView 
          dayLog={dayMergeLog} 
          onExportJSON={exportLogAsJSON}
          onExportCSV={exportLogAsCSV}
          onExportExcluded={exportExcludedAsCSV}
          onReverseMerge={(fileIndex) => {
            const data = reverseMerge(fileIndex)
            // Download as CSV
            const headers = ['Subject', 'Timestamp', 'Behavior']
            const csv = [
              headers.join(','),
              ...data.map(r => [r.subject, r.timestamp, r.behavior].map(c => `"${c}"`).join(','))
            ].join('\n')
            const blob = new Blob([csv], { type: 'text/csv' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `reconstructed_file_${fileIndex + 1}.csv`
            a.click()
            URL.revokeObjectURL(url)
          }}
        />
      ) : (
        <SegmentView data={filteredData} />
      )}
    </div>
  )
}

interface ExcludedRange {
  startRow: number
  endRow: number
}

interface SegmentViewProps {
  data: DataRow[]
}

function SegmentView({ data }: SegmentViewProps) {
  // Time blocks for full day (6AM to 6PM)
  const dayStartHour = 6
  const dayEndHour = 18
  const totalDayMinutes = (dayEndHour - dayStartHour) * 60

  // Calculate detailed stats per file with row ranges and excluded ranges
  const fileStats = useMemo(() => {
    // Group by file, then by time block within each file
    const fileMap = new Map<number, {
      fileIndex: number
      fileName: string
      timeBlocks: Map<string, { 
        timeRange: string
        count: number
        excludedCount: number
        includedCount: number
        startRow: number
        endRow: number
        startHour: number
        endHour: number
        excludedRanges: ExcludedRange[]
        includedRanges: ExcludedRange[]
      }>
    }>()

    // Sort data by time to get accurate row numbers
    const sortedByTime = [...data].sort((a, b) => {
      const aTime = a.time.split(':').map(Number)
      const bTime = b.time.split(':').map(Number)
      return (aTime[0] * 3600 + aTime[1] * 60 + aTime[2]) - (bTime[0] * 3600 + bTime[1] * 60 + bTime[2])
    })

    // Track row numbers per file
    const fileRowCounters = new Map<number, number>()

    sortedByTime.forEach(row => {
      const fileIndex = row._sourceFileIndex
      
      if (!fileRowCounters.has(fileIndex)) {
        fileRowCounters.set(fileIndex, 0)
      }
      const currentRowNum = fileRowCounters.get(fileIndex)! + 1
      fileRowCounters.set(fileIndex, currentRowNum)

      if (!fileMap.has(fileIndex)) {
        fileMap.set(fileIndex, {
          fileIndex,
          fileName: row._sourceFileName,
          timeBlocks: new Map()
        })
      }

      const file = fileMap.get(fileIndex)!
      const timeRange = row._timeRange

      if (!file.timeBlocks.has(timeRange)) {
        // Parse start/end hours from time range (e.g., "6AM - 8AM")
        const match = timeRange.match(/(\d+)(AM|PM)\s*-\s*(\d+)(AM|PM)/i)
        let startHour = 6, endHour = 8
        if (match) {
          startHour = parseInt(match[1], 10)
          if (match[2].toUpperCase() === 'PM' && startHour !== 12) startHour += 12
          if (match[2].toUpperCase() === 'AM' && startHour === 12) startHour = 0
          endHour = parseInt(match[3], 10)
          if (match[4].toUpperCase() === 'PM' && endHour !== 12) endHour += 12
          if (match[4].toUpperCase() === 'AM' && endHour === 12) endHour = 0
        }
        file.timeBlocks.set(timeRange, {
          timeRange,
          count: 0,
          excludedCount: 0,
          includedCount: 0,
          startRow: currentRowNum,
          endRow: currentRowNum,
          startHour,
          endHour,
          excludedRanges: [],
          includedRanges: []
        })
      }

      const block = file.timeBlocks.get(timeRange)!
      block.count++
      block.endRow = currentRowNum
      
      if (row._excluded) {
        block.excludedCount++
        // Track excluded ranges
        const lastExcluded = block.excludedRanges[block.excludedRanges.length - 1]
        if (lastExcluded && lastExcluded.endRow === currentRowNum - 1) {
          lastExcluded.endRow = currentRowNum
        } else {
          block.excludedRanges.push({ startRow: currentRowNum, endRow: currentRowNum })
        }
      } else {
        block.includedCount++
        // Track included ranges
        const lastIncluded = block.includedRanges[block.includedRanges.length - 1]
        if (lastIncluded && lastIncluded.endRow === currentRowNum - 1) {
          lastIncluded.endRow = currentRowNum
        } else {
          block.includedRanges.push({ startRow: currentRowNum, endRow: currentRowNum })
        }
      }
    })

    // Convert to array and sort by file index
    return Array.from(fileMap.values()).sort((a, b) => a.fileIndex - b.fileIndex)
  }, [data])

  // Get all time blocks sorted by time for color assignment
  const sortedTimeBlocks = useMemo(() => {
    const allBlocks = new Set<string>()
    fileStats.forEach(file => {
      file.timeBlocks.forEach((_, key) => allBlocks.add(key))
    })
    return Array.from(allBlocks).sort((a, b) => {
      const parseHour = (s: string) => {
        const match = s.match(/(\d+)(AM|PM)/i)
        if (!match) return 0
        let h = parseInt(match[1], 10)
        if (match[2].toUpperCase() === 'PM' && h !== 12) h += 12
        if (match[2].toUpperCase() === 'AM' && h === 12) h = 0
        return h
      }
      return parseHour(a) - parseHour(b)
    })
  }, [fileStats])

  // Color by time order (earliest = first color)
  const getColorByTimeOrder = (timeRange: string) => {
    const idx = sortedTimeBlocks.indexOf(timeRange)
    return RAINBOW_COLORS[idx >= 0 ? idx : 0]
  }
  
  return (
    <ScrollArea className="flex-1 p-4">
      <div className="space-y-6">
        {/* Legend - sorted by time */}
        <div>
          <h4 className="text-sm font-medium mb-2">Time Block Legend (earliest to latest)</h4>
          <div className="flex flex-wrap gap-2">
            {sortedTimeBlocks.map((timeRange, idx) => {
              const color = RAINBOW_COLORS[idx]
              return (
                <Badge 
                  key={timeRange}
                  variant="outline" 
                  className="text-xs px-2 py-1 flex items-center gap-1.5"
                >
                  <div 
                    className="w-3 h-3 rounded" 
                    style={{ backgroundColor: color.hex }}
                  />
                  <span>{timeRange}</span>
                </Badge>
              )
            })}
          </div>
        </div>

        {/* Stacked File Timeline Bars */}
        <div>
          <h4 className="text-sm font-medium mb-3">Data Distribution (Files Stacked)</h4>
          
          {/* Shared time axis */}
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1 px-0.5">
            <span>6AM</span>
            <span>8AM</span>
            <span>10AM</span>
            <span>12PM</span>
            <span>2PM</span>
            <span>4PM</span>
            <span>6PM</span>
          </div>
          
          {/* Stacked bars */}
          <div className="space-y-1">
            {fileStats.map((file) => {
              const sortedBlocks = Array.from(file.timeBlocks.values()).sort((a, b) => a.startHour - b.startHour)
              
              return (
                <div key={file.fileIndex} className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-12 flex-shrink-0">File {file.fileIndex + 1}</span>
                  <div className="flex-1 h-8 bg-muted/30 rounded border border-border relative overflow-hidden">
                    {sortedBlocks.map((block) => {
                      const color = getColorByTimeOrder(block.timeRange)
                      const startMinutes = (block.startHour - dayStartHour) * 60
                      const endMinutes = (block.endHour - dayStartHour) * 60
                      const leftPercent = (startMinutes / totalDayMinutes) * 100
                      const widthPercent = ((endMinutes - startMinutes) / totalDayMinutes) * 100
                      const keptPercent = block.count > 0 ? (block.includedCount / block.count) * 100 : 100
                      
                      return (
                        <div
                          key={block.timeRange}
                          className="absolute top-0 bottom-0 flex items-center justify-center group cursor-pointer"
                          style={{
                            left: `${leftPercent}%`,
                            width: `${widthPercent}%`,
                            background: block.excludedCount > 0 
                              ? `linear-gradient(to right, ${color.hex} ${keptPercent}%, ${color.hex}40 ${keptPercent}%)`
                              : color.hex
                          }}
                          title={`${block.timeRange}: ${block.includedCount} kept, ${block.excludedCount} excluded`}
                        >
                          <span className="text-[10px] font-medium text-white drop-shadow-sm">
                            {block.includedCount}/{block.count}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Block Details per File */}
        <div>
          <h4 className="text-sm font-medium mb-3">Block Details</h4>
          <div className="space-y-4">
            {fileStats.map((file) => {
              const sortedBlocks = Array.from(file.timeBlocks.values()).sort((a, b) => a.startHour - b.startHour)
              
              return (
                <div key={file.fileIndex}>
                  <div className="flex items-center gap-2 mb-2">
                    <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">File {file.fileIndex + 1}</span>
                    <span className="text-xs text-muted-foreground truncate">({file.fileName})</span>
                  </div>
                  
                  <div className="space-y-1.5">
                    {sortedBlocks.map((block) => {
                      const color = getColorByTimeOrder(block.timeRange)
                      return (
                        <div
                          key={block.timeRange}
                          className="text-xs p-2 rounded border"
                          style={{ 
                            borderColor: color.hex,
                            backgroundColor: `${color.hex}08`
                          }}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <div 
                                className="w-2 h-2 rounded-sm" 
                                style={{ backgroundColor: color.hex }}
                              />
                              <span className="font-medium">{block.timeRange}</span>
                              <span className="text-muted-foreground font-mono text-[10px]">
                                rows {block.startRow}-{block.endRow}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-green-600 font-medium">{block.includedCount} kept</span>
                              {block.excludedCount > 0 && (
                                <span className="text-destructive">{block.excludedCount} out</span>
                              )}
                            </div>
                          </div>
                          
                          {/* Visual row bar showing kept/excluded pattern */}
                          <div className="h-2 bg-muted rounded overflow-hidden flex">
                            {(() => {
                              const allRanges: { type: 'kept' | 'excluded'; start: number; end: number }[] = [
                                ...block.includedRanges.map(r => ({ type: 'kept' as const, start: r.startRow, end: r.endRow })),
                                ...block.excludedRanges.map(r => ({ type: 'excluded' as const, start: r.startRow, end: r.endRow }))
                              ].sort((a, b) => a.start - b.start)
                              
                              const totalRows = block.endRow - block.startRow + 1
                              
                              return allRanges.map((range, i) => {
                                const widthPct = ((range.end - range.start + 1) / totalRows) * 100
                                return (
                                  <div
                                    key={i}
                                    className="h-full"
                                    style={{
                                      width: `${widthPct}%`,
                                      backgroundColor: range.type === 'kept' ? color.hex : '#ef4444'
                                    }}
                                    title={`${range.type === 'kept' ? 'Kept' : 'Excluded'}: rows ${range.start}-${range.end}`}
                                  />
                                )
                              })
                            })()}
                          </div>
                          
                          {block.excludedRanges.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5 items-center">
                              <span className="text-[10px] text-muted-foreground">Gaps:</span>
                              {block.excludedRanges.map((range, i) => (
                                <span 
                                  key={i}
                                  className="text-[10px] px-1 py-0.5 rounded bg-destructive/15 text-destructive font-mono"
                                >
                                  {range.startRow === range.endRow 
                                    ? range.startRow 
                                    : `${range.startRow}-${range.endRow}`}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Merged Output Summary */}
        <div>
          <h4 className="text-sm font-medium mb-3">Merge Summary (Chronological Order)</h4>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th className="px-3 py-2 text-left font-medium">Time Block</th>
                  <th className="px-3 py-2 text-left font-medium">File</th>
                  <th className="px-3 py-2 text-left font-medium">Row Range</th>
                  <th className="px-3 py-2 text-left font-medium">Kept</th>
                  <th className="px-3 py-2 text-left font-medium">Excluded Rows</th>
                </tr>
              </thead>
              <tbody>
                {sortedTimeBlocks.map((timeRange, idx) => {
                  const color = RAINBOW_COLORS[idx]
                  const fileWithBlock = fileStats.find(f => f.timeBlocks.has(timeRange))
                  const block = fileWithBlock?.timeBlocks.get(timeRange)
                  
                  if (!block) return null
                  
                  return (
                    <tr 
                      key={timeRange}
                      className="border-b last:border-0"
                      style={{ backgroundColor: `${color.hex}08` }}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-2 h-4 rounded-sm" 
                            style={{ backgroundColor: color.hex }}
                          />
                          <span className="font-medium">{timeRange}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        File {fileWithBlock!.fileIndex + 1}
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">
                        {block.startRow}-{block.endRow}
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-green-600 font-medium">{block.includedCount}</span>
                        <span className="text-muted-foreground">/{block.count}</span>
                      </td>
                      <td className="px-3 py-2">
                        {block.excludedRanges.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {block.excludedRanges.map((range, i) => (
                              <span 
                                key={i}
                                className="px-1 py-0.5 rounded bg-destructive/15 text-destructive font-mono"
                              >
                                {range.startRow === range.endRow 
                                  ? range.startRow 
                                  : `${range.startRow}-${range.endRow}`}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}

// Merge Log View component

interface DayMergeLog {
  displayDate: string
  totalKept: number
  totalExcluded: number
  totalTimestampModifications: number
  files: {
    fileIndex: number
    fileName: string
    keptRows: number
    excludedRows: number
    timestampModifications: number
    rows: {
      action: 'kept' | 'excluded'
      rowIndex: number
      timeBlock: string
      originalTimestamp: string
      newTimestamp?: string
    }[]
  }[]
}

interface MergeLogViewProps {
  dayLog: any
  onExportJSON: () => void
  onExportCSV: () => void
  onExportExcluded: () => void
  onReverseMerge: (fileIndex: number) => void
}

function MergeLogView({ dayLog, onExportJSON, onExportCSV, onExportExcluded, onReverseMerge }: MergeLogViewProps) {
  const [expandedFile, setExpandedFile] = useState<number | null>(null)
  
  if (!dayLog) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <div className="p-4 rounded-full bg-muted mb-4">
          <History className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No Merge Log</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Select a day to see the merge log showing every row and its status.
        </p>
      </div>
    )
  }

  // Group rows into ranges for display
  const groupRowsIntoRanges = (rows: DayMergeLog['files'][0]['rows']) => {
    if (rows.length === 0) return []
    
    const ranges: { 
      action: 'kept' | 'excluded'
      startRow: number
      endRow: number
      count: number
      timeBlock: string
      hasTimestampMod: boolean
      rows: typeof rows
    }[] = []
    
    let currentRange: typeof ranges[0] | null = null
    
    rows.forEach(row => {
      if (!currentRange || 
          currentRange.action !== row.action || 
          currentRange.timeBlock !== row.timeBlock ||
          row.rowIndex !== currentRange.endRow + 1) {
        // Start new range
        if (currentRange) ranges.push(currentRange)
        currentRange = {
          action: row.action,
          startRow: row.rowIndex,
          endRow: row.rowIndex,
          count: 1,
          timeBlock: row.timeBlock,
          hasTimestampMod: !!row.newTimestamp,
          rows: [row]
        }
      } else {
        // Extend current range
        currentRange.endRow = row.rowIndex
        currentRange.count++
        if (row.newTimestamp) currentRange.hasTimestampMod = true
        currentRange.rows.push(row)
      }
    })
    
    if (currentRange) ranges.push(currentRange)
    return ranges
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Header with export buttons */}
      <div className="p-4 border-b bg-muted/30">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold">Merge Log for {dayLog.displayDate}</h4>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs bg-transparent" onClick={onExportJSON}>
              <Download className="w-3 h-3 mr-1" />
              JSON
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs bg-transparent" onClick={onExportCSV}>
              <Download className="w-3 h-3 mr-1" />
              CSV
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs text-destructive bg-transparent" onClick={onExportExcluded}>
              <Download className="w-3 h-3 mr-1" />
              Excluded Rows
            </Button>
          </div>
        </div>
        <div className="flex gap-4 text-xs">
          <span className="text-green-600">
            <span className="font-medium">{dayLog.totalKept}</span> rows kept
          </span>
          <span className="text-destructive">
            <span className="font-medium">{dayLog.totalExcluded}</span> rows excluded
          </span>
          <span className="text-amber-600">
            <span className="font-medium">{dayLog.totalTimestampModifications}</span> timestamps modified
          </span>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {/* File-by-file log */}
          {dayLog.files.map((file: DayMergeLog['files'][number]) => {
            const ranges = groupRowsIntoRanges(file.rows)
            const isExpanded = expandedFile === file.fileIndex
            
            return (
              <div key={file.fileIndex} className="border rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-muted/30 border-b flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium text-sm">File {file.fileIndex + 1}: {file.fileName}</span>
                    <span className="text-xs text-muted-foreground">
                      ({file.keptRows} kept, {file.excludedRows} excluded)
                    </span>
                  </div>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="h-7 text-xs"
                    onClick={() => onReverseMerge(file.fileIndex)}
                  >
                    <RotateCcw className="w-3 h-3 mr-1" />
                    Reverse Merge
                  </Button>
                </div>
                
                <div className="divide-y max-h-64 overflow-y-auto">
                  {ranges.map((range, idx) => {
                    const color = getTimeBlockColor(range.timeBlock)
                    const isKept = range.action === 'kept'
                    
                    return (
                      <div 
                        key={idx}
                        className={cn(
                          "px-3 py-2 text-xs flex items-center gap-3",
                          isKept ? "bg-green-500/5" : "bg-destructive/5"
                        )}
                      >
                        {isKept ? (
                          <Eye className="w-3 h-3 text-green-600 flex-shrink-0" />
                        ) : (
                          <EyeOff className="w-3 h-3 text-destructive flex-shrink-0" />
                        )}
                        
                        <span className={cn(
                          "font-medium w-16",
                          isKept ? "text-green-600" : "text-destructive"
                        )}>
                          {isKept ? 'Kept' : 'Excluded'}
                        </span>
                        
                        <span className="font-mono text-muted-foreground w-24">
                          {range.startRow === range.endRow 
                            ? `Row ${range.startRow}` 
                            : `Rows ${range.startRow}-${range.endRow}`}
                        </span>
                        
                        <span className="text-muted-foreground">
                          ({range.count} row{range.count !== 1 ? 's' : ''})
                        </span>
                        
                        <Badge 
                          variant="outline" 
                          className="text-[9px] ml-auto"
                          style={{ borderColor: color.hex, color: color.hex }}
                        >
                          {range.timeBlock}
                        </Badge>
                        
                        {range.hasTimestampMod && (
                          <Clock className="w-3 h-3 text-amber-600" />
                        )}
                      </div>
                    )
                  })}
                </div>
                
                {/* Show timestamp modifications for this file */}
                {file.timestampModifications > 0 && (
                  <div className="px-3 py-2 bg-amber-500/10 border-t">
                    <div 
                      className="flex items-center gap-2 cursor-pointer"
                      onClick={() => setExpandedFile(isExpanded ? null : file.fileIndex)}
                    >
                      <Clock className="w-3 h-3 text-amber-600" />
                      <span className="text-xs text-amber-700 font-medium">
                        {file.timestampModifications} timestamp modifications
                      </span>
                      <span className="text-xs text-muted-foreground">
                        (click to {isExpanded ? 'hide' : 'show'})
                      </span>
                    </div>
                    
                    {isExpanded && (
                      <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                        {file.rows.filter(r => r.newTimestamp).map((row, i) => (
                          <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                            <span className="text-muted-foreground w-12">Row {row.rowIndex}:</span>
                            <span className="text-destructive line-through">{row.originalTimestamp}</span>
                            <ArrowRight className="w-3 h-3 text-muted-foreground" />
                            <span className="text-green-600">{row.newTimestamp}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
