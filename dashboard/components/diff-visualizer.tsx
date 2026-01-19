'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
  Table, 
  BarChart3, 
  FileSpreadsheet, 
  History, 
  Download, 
  RotateCcw, 
  Eye, 
  EyeOff, 
  Clock, 
  ArrowRight,
  ArrowLeft
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDiff } from '@/lib/diff-context'
import { groupRowsByStatus, generateMergedFileBlocks } from '@/lib/diff-analysis'
import type { DiffAnalysis } from '@/lib/types'

// Colors for different files
const FILE_COLORS = [
  { hex: '#3b82f6', name: 'Blue' },
  { hex: '#22c55e', name: 'Green' },
  { hex: '#f59e0b', name: 'Amber' },
  { hex: '#ef4444', name: 'Red' },
  { hex: '#8b5cf6', name: 'Purple' },
  { hex: '#06b6d4', name: 'Cyan' },
]

interface DiffVisualizerProps {
  onBack: () => void
}

export function DiffVisualizer({ onBack }: DiffVisualizerProps) {
  const { 
    diffAnalysis, 
    originalFiles,
    mergedFile,
    exportAsJSON, 
    exportAsCSV, 
    exportExcludedAsCSV,
    downloadReconstructedFile
  } = useDiff()
  
  const [activeTab, setActiveTab] = useState<'summary' | 'table' | 'log'>('summary')

  if (!diffAnalysis) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">No analysis data available.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <div className="h-4 w-px bg-border" />
          <h2 className="font-semibold">Merge Analysis: {diffAnalysis.displayDate}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportAsJSON}>
            <Download className="w-4 h-4 mr-1" />
            JSON
          </Button>
          <Button variant="outline" size="sm" onClick={exportAsCSV}>
            <Download className="w-4 h-4 mr-1" />
            CSV
          </Button>
          <Button variant="outline" size="sm" className="text-destructive bg-transparent" onClick={exportExcludedAsCSV}>
            <Download className="w-4 h-4 mr-1" />
            Excluded
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex-1 flex flex-col">
        <div className="px-4 border-b">
          <TabsList className="h-10">
            <TabsTrigger value="summary" className="gap-1.5">
              <BarChart3 className="w-4 h-4" />
              Summary
            </TabsTrigger>
            <TabsTrigger value="table" className="gap-1.5">
              <Table className="w-4 h-4" />
              All Rows
              <Badge variant="secondary" className="ml-1 text-[9px] px-1 h-4">
                {diffAnalysis.totalOriginalRows}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="log" className="gap-1.5">
              <History className="w-4 h-4" />
              Log
              <Badge variant="secondary" className="ml-1 text-[9px] px-1 h-4">
                {diffAnalysis.originalFiles.reduce((sum, f) => sum + f.rows.length, 0)}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="summary" className="flex-1 m-0 overflow-auto">
          <SummaryView analysis={diffAnalysis} onReverseMerge={downloadReconstructedFile} />
        </TabsContent>

        <TabsContent value="table" className="flex-1 m-0 overflow-hidden">
          <TableView analysis={diffAnalysis} />
        </TabsContent>

        <TabsContent value="log" className="flex-1 m-0 overflow-hidden">
          <LogView analysis={diffAnalysis} onReverseMerge={downloadReconstructedFile} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// Summary View
function SummaryView({ analysis, onReverseMerge }: { analysis: DiffAnalysis; onReverseMerge: (idx: number) => void }) {
  return (
    <ScrollArea className="flex-1 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Overall Stats */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard 
            label="Original Rows" 
            value={analysis.totalOriginalRows} 
            className="bg-muted/50"
          />
          <StatCard 
            label="Kept" 
            value={analysis.totalKept} 
            className="bg-green-500/10 text-green-700"
            percent={Math.round((analysis.totalKept / analysis.totalOriginalRows) * 100)}
          />
          <StatCard 
            label="Excluded" 
            value={analysis.totalExcluded} 
            className="bg-destructive/10 text-destructive"
            percent={Math.round((analysis.totalExcluded / analysis.totalOriginalRows) * 100)}
          />
          <StatCard 
            label="Timestamp Changes" 
            value={analysis.totalTimestampModifications} 
            className="bg-amber-500/10 text-amber-700"
          />
        </div>

        {/* Merged File Info */}
        <div className="p-4 rounded-lg border bg-green-500/5 border-green-500/20">
          <div className="flex items-center gap-2 mb-2">
            <FileSpreadsheet className="w-5 h-5 text-green-600" />
            <span className="font-medium">Merged Output</span>
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="font-mono">{analysis.mergedFile.fileName}</span>
            <span className="mx-2">-</span>
            <span>{analysis.mergedFile.totalRows} rows</span>
          </div>
        </div>

        {/* Per-File Breakdown */}
        <div>
          <h3 className="text-sm font-medium mb-3">Original Files Breakdown</h3>
          <div className="space-y-3">
            {analysis.originalFiles.map((file, idx) => {
              const color = FILE_COLORS[idx % FILE_COLORS.length]
              const keptPercent = Math.round((file.keptRows / file.totalRows) * 100)
              const excludedPercent = Math.round((file.excludedRows / file.totalRows) * 100)
              
              return (
                <div 
                  key={file.fileIndex}
                  className="p-4 rounded-lg border"
                  style={{ borderColor: `${color.hex}40` }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-sm"
                        style={{ backgroundColor: color.hex }}
                      />
                      <span className="font-medium text-sm">File {idx + 1}: {file.fileName}</span>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-7 text-xs"
                      onClick={() => onReverseMerge(file.fileIndex)}
                    >
                      <RotateCcw className="w-3 h-3 mr-1" />
                      Reverse Merge
                    </Button>
                  </div>
                  
                  {/* Progress bar */}
                  <div className="h-3 bg-muted rounded-full overflow-hidden flex mb-2">
                    <div 
                      className="h-full bg-green-500 transition-all"
                      style={{ width: `${keptPercent}%` }}
                      title={`${file.keptRows} kept`}
                    />
                    <div 
                      className="h-full bg-destructive transition-all"
                      style={{ width: `${excludedPercent}%` }}
                      title={`${file.excludedRows} excluded`}
                    />
                  </div>
                  
                  <div className="flex gap-4 text-xs">
                    <span className="text-muted-foreground">
                      {file.totalRows} total
                    </span>
                    <span className="text-green-600">
                      {file.keptRows} kept ({keptPercent}%)
                    </span>
                    <span className="text-destructive">
                      {file.excludedRows} excluded ({excludedPercent}%)
                    </span>
                    {file.timestampModifications > 0 && (
                      <span className="text-amber-600">
                        {file.timestampModifications} timestamp changes
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Visual Timeline - Original Files */}
        <div>
          <h3 className="text-sm font-medium mb-3">Original Files - Row Distribution</h3>
          <div className="space-y-2">
            {analysis.originalFiles.map((file, idx) => {
              const color = FILE_COLORS[idx % FILE_COLORS.length]
              const groups = groupRowsByStatus(file.rows)
              
              return (
                <div key={file.fileIndex} className="flex items-center gap-2">
                  <span className="text-xs w-16 text-muted-foreground">File {idx + 1}</span>
                  <div className="flex-1 h-4 bg-muted rounded overflow-hidden flex">
                    {groups.map((group, gIdx) => (
                      <div
                        key={gIdx}
                        className="h-full"
                        style={{
                          width: `${(group.count / file.totalRows) * 100}%`,
                          backgroundColor: group.status === 'kept' ? color.hex : '#ef4444',
                          opacity: group.status === 'kept' ? 1 : 0.6
                        }}
                        title={`${group.status}: rows ${group.startRow}-${group.endRow} (${group.count} rows)`}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm bg-blue-500" /> Kept
            </span>
            <span className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm bg-destructive/60" /> Excluded
            </span>
          </div>
        </div>

        {/* Merged File Block Visualization */}
        <MergedFileVisualization analysis={analysis} />
      </div>
    </ScrollArea>
  )
}

// Merged File Visualization Component
function MergedFileVisualization({ analysis }: { analysis: DiffAnalysis }) {
  const blocks = generateMergedFileBlocks(analysis)
  const totalMergedRows = analysis.mergedFile.totalRows
  
  // Debug: log block structure
  console.log('Generated blocks:', blocks.map(b => ({
    file: b.sourceFileIndex + 1,
    mergedRows: `${b.mergedStartRow}-${b.mergedEndRow}`,
    originalRows: `${b.originalStartRow}-${b.originalEndRow}`,
    count: b.count
  })))
  
  if (blocks.length === 0) {
    return null
  }
  
  return (
    <div>
      <h3 className="text-sm font-medium mb-3">Merged File - Source Blocks</h3>
      <p className="text-xs text-muted-foreground mb-3">
        Shows which original file each block of rows came from in the merged output
      </p>
      
      {/* Visual bars - one per file */}
      <div className="space-y-3 mb-3">
        {analysis.originalFiles.map((file, fileIdx) => {
          const color = FILE_COLORS[fileIdx % FILE_COLORS.length]
          return (
            <div key={file.fileIndex} className="flex items-center gap-2">
              <span className="text-xs w-16 text-muted-foreground">File {fileIdx + 1}</span>
              <div className="flex-1 h-6 bg-muted rounded overflow-hidden flex">
                {blocks.map((block, blockIdx) => {
                  const blockWidthPercent = (block.count / totalMergedRows) * 100
                  
                  if (block.sourceFileIndex === fileIdx) {
                    // This block belongs to this file - show it colored
                    return (
                      <div
                        key={blockIdx}
                        className="h-full relative group cursor-pointer"
                        style={{
                          width: `${blockWidthPercent}%`,
                          backgroundColor: color.hex,
                          minWidth: blockWidthPercent > 0.5 ? undefined : '2px'
                        }}
                        title={`File ${fileIdx + 1}: merged rows ${block.mergedStartRow}-${block.mergedEndRow} (${block.count} rows)`}
                      >
                        {blockWidthPercent > 5 && (
                          <span className="absolute inset-0 flex items-center justify-center text-[9px] text-white font-medium">
                            {block.count}
                          </span>
                        )}
                      </div>
                    )
                  } else {
                    // This block belongs to another file - show it as empty space
                    return (
                      <div
                        key={blockIdx}
                        className="h-full"
                        style={{
                          width: `${blockWidthPercent}%`,
                          backgroundColor: 'transparent'
                        }}
                      />
                    )
                  }
                })}
              </div>
            </div>
          )
        })}
      </div>
      
      {/* Legend */}
      <div className="flex gap-4 text-xs text-muted-foreground mb-4">
        {analysis.originalFiles.map((file, idx) => {
          const color = FILE_COLORS[idx % FILE_COLORS.length]
          return (
            <span key={idx} className="flex items-center gap-1">
              <div 
                className="w-3 h-3 rounded-sm" 
                style={{ backgroundColor: color.hex }}
              /> 
              File {idx + 1}
            </span>
          )
        })}
      </div>
      
      {/* Block details table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-muted/50 px-3 py-2 border-b">
          <span className="text-xs font-medium">Block Details ({blocks.length} blocks)</span>
        </div>
        <div className="max-h-48 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 sticky top-0">
              <tr className="border-b">
                <th className="px-3 py-1.5 text-left font-medium">Source</th>
                <th className="px-3 py-1.5 text-left font-medium">Merged Rows</th>
                <th className="px-3 py-1.5 text-left font-medium">Original Rows</th>
                <th className="px-3 py-1.5 text-left font-medium">Count</th>
                <th className="px-3 py-1.5 text-left font-medium">Start Timestamp</th>
                <th className="px-3 py-1.5 text-left font-medium">End Timestamp</th>
                <th className="px-3 py-1.5 text-left font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((block, idx) => {
                const color = FILE_COLORS[block.sourceFileIndex % FILE_COLORS.length]
                const sourceFile = analysis.originalFiles[block.sourceFileIndex]
                const blockRows = sourceFile?.rows.filter(r => r.originalRowIndex >= block.originalStartRow && r.originalRowIndex <= block.originalEndRow) || []
                const startTimestamp = blockRows.length > 0 ? blockRows[0]?.originalTimestamp : '-'
                const endTimestamp = blockRows.length > 0 ? blockRows[blockRows.length - 1]?.originalTimestamp : '-'
                
                return (
                  <tr key={idx} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <div 
                          className="w-2 h-2 rounded-sm" 
                          style={{ backgroundColor: color.hex }}
                        />
                        <span>File {block.sourceFileIndex + 1}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">
                      {block.mergedStartRow === block.mergedEndRow 
                        ? block.mergedStartRow 
                        : `${block.mergedStartRow}-${block.mergedEndRow}`}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">
                      {block.originalStartRow === block.originalEndRow 
                        ? block.originalStartRow 
                        : `${block.originalStartRow}-${block.originalEndRow}`}
                    </td>
                    <td className="px-3 py-1.5">{block.count}</td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground text-[10px]">
                      {startTimestamp}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground text-[10px]">
                      {endTimestamp}
                    </td>
                    <td className="px-3 py-1.5">
                      {block.hasTimestampMods && (
                        <span className="text-amber-600 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Timestamp changes
                        </span>
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
  )
}

function StatCard({ label, value, className, percent }: { 
  label: string; 
  value: number; 
  className?: string;
  percent?: number;
}) {
  return (
    <div className={cn("p-4 rounded-lg border", className)}>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        {label}
        {percent !== undefined && (
          <span className="opacity-70">({percent}%)</span>
        )}
      </div>
    </div>
  )
}

// Table View - shows all rows from all files with pagination
const ROWS_PER_PAGE = 100

function TableView({ analysis }: { analysis: DiffAnalysis }) {
  const [filterStatus, setFilterStatus] = useState<'all' | 'kept' | 'excluded'>('all')
  const [filterFile, setFilterFile] = useState<number | 'all'>('all')
  const [currentPage, setCurrentPage] = useState(1)
  
  // Flatten all rows from all files
  const allRows = analysis.originalFiles.flatMap(file => file.rows)
  
  // Apply filters
  const filteredRows = allRows.filter(row => {
    if (filterStatus !== 'all' && row.status !== filterStatus) return false
    if (filterFile !== 'all' && row.sourceFileIndex !== filterFile) return false
    return true
  })
  
  // Pagination
  const totalPages = Math.ceil(filteredRows.length / ROWS_PER_PAGE)
  const startIdx = (currentPage - 1) * ROWS_PER_PAGE
  const endIdx = startIdx + ROWS_PER_PAGE
  const paginatedRows = filteredRows.slice(startIdx, endIdx)
  
  // Reset to page 1 when filters change
  const handleFilterChange = (newStatus: typeof filterStatus) => {
    setFilterStatus(newStatus)
    setCurrentPage(1)
  }
  
  const handleFileChange = (newFile: typeof filterFile) => {
    setFilterFile(newFile)
    setCurrentPage(1)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filters */}
      <div className="px-4 py-2 border-b flex items-center gap-4 bg-muted/30 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Status:</span>
          <div className="flex gap-1">
            {(['all', 'kept', 'excluded'] as const).map(status => (
              <Button
                key={status}
                variant={filterStatus === status ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleFilterChange(status)}
              >
                {status === 'all' ? 'All' : status === 'kept' ? 'Kept' : 'Excluded'}
              </Button>
            ))}
          </div>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">File:</span>
          <div className="flex gap-1">
            <Button
              variant={filterFile === 'all' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => handleFileChange('all')}
            >
              All
            </Button>
            {analysis.originalFiles.map((file, idx) => (
              <Button
                key={file.fileIndex}
                variant={filterFile === file.fileIndex ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleFileChange(file.fileIndex)}
              >
                File {idx + 1}
              </Button>
            ))}
          </div>
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          Showing {startIdx + 1}-{Math.min(endIdx, filteredRows.length)} of {filteredRows.length} rows
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="overflow-y-auto max-h-[calc(100vh-400px)]">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-muted/50 sticky top-0 z-10">
            <tr className="border-b">
              <th className="px-3 py-2 text-left font-medium w-16">Status</th>
              <th colSpan={2} className="px-3 py-2 text-left font-medium border-r">Original File & Row</th>
              <th colSpan={2} className="px-3 py-2 text-left font-medium border-r">Merged File & Row</th>
              <th colSpan={2} className="px-3 py-2 text-left font-medium border-r">Subject</th>
              <th colSpan={2} className="px-3 py-2 text-left font-medium border-r">Timestamp</th>
              <th colSpan={2} className="px-3 py-2 text-left font-medium">Behavior</th>
            </tr>
            <tr className="border-b bg-muted/25 text-xs text-muted-foreground">
              <th className="px-3 py-1 text-left w-16"></th>
              <th className="px-3 py-1 text-left font-normal">File</th>
              <th className="px-3 py-1 text-left font-normal border-r">Row</th>
              <th className="px-3 py-1 text-left font-normal">File</th>
              <th className="px-3 py-1 text-left font-normal border-r">Row</th>
              <th className="px-3 py-1 text-left font-normal">Original</th>
              <th className="px-3 py-1 text-left font-normal border-r">Current</th>
              <th className="px-3 py-1 text-left font-normal">Original</th>
              <th className="px-3 py-1 text-left font-normal border-r">Current</th>
              <th className="px-3 py-1 text-left font-normal">Original</th>
              <th className="px-3 py-1 text-left font-normal">Current</th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((row) => {
              const color = FILE_COLORS[row.sourceFileIndex % FILE_COLORS.length]
              const origFile = analysis.originalFiles[row.sourceFileIndex]
              // Calculate merged row number by counting kept rows before this one
              const mergedRowNum = analysis.originalFiles
                .flatMap(f => f.rows)
                .filter((r, idx, arr) => {
                  const currentIdx = arr.indexOf(row)
                  return idx < currentIdx && r.status === 'kept'
                }).length + (row.status === 'kept' ? 1 : 0)
              
              return (
                <tr 
                  key={`${row.sourceFileIndex}-${row.originalRowIndex}`}
                  className={cn(
                    "border-b",
                    row.status === 'excluded' && "bg-destructive/5",
                    row.status === 'kept' && "bg-green-500/5"
                  )}
                >
                  <td className="px-3 py-1.5">
                    {row.status === 'kept' ? (
                      <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-700 border-green-500/30">
                        Kept
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">
                        Excluded
                      </Badge>
                    )}
                  </td>
                  
                  {/* Original File & Row */}
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1">
                      <div 
                        className="w-2 h-2 rounded-sm"
                        style={{ backgroundColor: color.hex }}
                      />
                      <span className="text-xs">{origFile?.fileName || `File ${row.sourceFileIndex + 1}`}</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground border-r">
                    {row.originalRowIndex}
                  </td>
                  
                  {/* Merged File & Row */}
                  <td className="px-3 py-1.5">
                    <span className="text-xs">{analysis.mergedFile?.fileName || 'Merged'}</span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground border-r">
                    {row.status === 'kept' ? mergedRowNum : '-'}
                  </td>
                  
                  {/* Subject (Original | Current) */}
                  <td className="px-3 py-1.5 truncate max-w-[180px]" title={row.subject}>
                    <span className="text-muted-foreground">{row.subject}</span>
                  </td>
                  <td className="px-3 py-1.5 truncate max-w-[180px] border-r" title={row.subject}>
                    <span>{row.subject}</span>
                  </td>
                  
                  {/* Timestamp (Original | Current) */}
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">
                    {row.originalTimestamp}
                  </td>
                  <td className="px-3 py-1.5 font-mono border-r">
                    {row.timestampModified ? (
                      <span className="text-green-600">{row.newTimestamp}</span>
                    ) : (
                      <span className="text-muted-foreground">{row.originalTimestamp}</span>
                    )}
                  </td>
                  
                  {/* Behavior (Original | Current) */}
                  <td className="px-3 py-1.5 truncate max-w-[180px]" title={row.behavior}>
                    <span className="text-muted-foreground">{row.behavior}</span>
                  </td>
                  <td className="px-3 py-1.5 truncate max-w-[180px]" title={row.behavior}>
                    <span>{row.behavior}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
          </table>
        </div>
      </div>
      
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-4 py-2 border-t bg-muted/30 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs bg-transparent"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
            >
              First
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs bg-transparent"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ArrowLeft className="w-3 h-3" />
            </Button>
          </div>
          
          <div className="flex items-center gap-1">
            {/* Show page numbers */}
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number
              if (totalPages <= 5) {
                pageNum = i + 1
              } else if (currentPage <= 3) {
                pageNum = i + 1
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i
              } else {
                pageNum = currentPage - 2 + i
              }
              return (
                <Button
                  key={pageNum}
                  variant={currentPage === pageNum ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 w-7 text-xs p-0"
                  onClick={() => setCurrentPage(pageNum)}
                >
                  {pageNum}
                </Button>
              )
            })}
            {totalPages > 5 && currentPage < totalPages - 2 && (
              <>
                <span className="text-xs text-muted-foreground px-1">...</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 text-xs p-0"
                  onClick={() => setCurrentPage(totalPages)}
                >
                  {totalPages}
                </Button>
              </>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs bg-transparent"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <ArrowRight className="w-3 h-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs bg-transparent"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              Last
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// Log View - shows grouped ranges
function LogView({ analysis, onReverseMerge }: { analysis: DiffAnalysis; onReverseMerge: (idx: number) => void }) {
  const [expandedTimestamps, setExpandedTimestamps] = useState<number | null>(null)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-muted/30 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Merge Log for {analysis.displayDate}</h4>
        </div>
        <div className="flex gap-4 text-xs mt-1">
          <span className="text-green-600">
            <span className="font-medium">{analysis.totalKept}</span> rows kept
          </span>
          <span className="text-destructive">
            <span className="font-medium">{analysis.totalExcluded}</span> rows excluded
          </span>
          <span className="text-amber-600">
            <span className="font-medium">{analysis.totalTimestampModifications}</span> timestamps modified
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="space-y-4 p-4">
          {analysis.originalFiles.map((file, fileIdx) => {
            const color = FILE_COLORS[fileIdx % FILE_COLORS.length]
            const groups = groupRowsByStatus(file.rows)
            const timestampRows = file.rows.filter(r => r.timestampModified)
            
            return (
              <div key={file.fileIndex} className="border rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-muted/30 border-b flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 rounded-sm"
                      style={{ backgroundColor: color.hex }}
                    />
                    <span className="font-medium text-sm">File {fileIdx + 1}: {file.fileName}</span>
                    <span className="text-xs text-muted-foreground">
                      ({file.keptRows} kept, {file.excludedRows} excluded)
                    </span>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-7 text-xs"
                    onClick={() => onReverseMerge(file.fileIndex)}
                  >
                    <RotateCcw className="w-3 h-3 mr-1" />
                    Reverse Merge
                  </Button>
                </div>
                
                <div className="divide-y max-h-64 overflow-y-auto">
                  {groups.map((group, idx) => (
                    <div 
                      key={idx}
                      className={cn(
                        "px-3 py-2 text-xs flex items-center gap-3",
                        group.status === 'kept' ? "bg-green-500/5" : "bg-destructive/5"
                      )}
                    >
                      {group.status === 'kept' ? (
                        <Eye className="w-3 h-3 text-green-600 flex-shrink-0" />
                      ) : (
                        <EyeOff className="w-3 h-3 text-destructive flex-shrink-0" />
                      )}
                      
                      <span className={cn(
                        "font-medium w-16",
                        group.status === 'kept' ? "text-green-600" : "text-destructive"
                      )}>
                        {group.status === 'kept' ? 'Kept' : 'Excluded'}
                      </span>
                      
                      <span className="font-mono text-muted-foreground w-28">
                        {group.startRow === group.endRow 
                          ? `Row ${group.startRow}` 
                          : `Rows ${group.startRow}-${group.endRow}`}
                      </span>
                      
                      <span className="text-muted-foreground">
                        ({group.count} row{group.count !== 1 ? 's' : ''})
                      </span>
                      
                      {group.hasTimestampMods && (
                        <div title="Contains timestamp modifications">
                          <Clock className="w-3 h-3 text-amber-600 ml-auto" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                
                {/* Timestamp modifications section */}
                {file.timestampModifications > 0 && (
                  <div className="px-3 py-2 bg-amber-500/10 border-t">
                    <div 
                      className="flex items-center gap-2 cursor-pointer"
                      onClick={() => setExpandedTimestamps(expandedTimestamps === fileIdx ? null : fileIdx)}
                    >
                      <Clock className="w-3 h-3 text-amber-600" />
                      <span className="text-xs text-amber-700 font-medium">
                        {file.timestampModifications} timestamp modifications
                      </span>
                      <span className="text-xs text-muted-foreground">
                        (click to {expandedTimestamps === fileIdx ? 'hide' : 'show'})
                      </span>
                    </div>
                    
                    {expandedTimestamps === fileIdx && (
                      <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                        {timestampRows.map((row, i) => (
                          <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                            <span className="text-muted-foreground w-12">Row {row.originalRowIndex}:</span>
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
      </div>
    </div>
  )
}
