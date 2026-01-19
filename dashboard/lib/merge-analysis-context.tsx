'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { DataRow, DiffAnalysis } from './types'

interface MergeAnalysisContextType {
  dataRows: DataRow[]
  diffAnalysis: DiffAnalysis | null
  mergedFile: {
    rows: any[][]
  } | null
  rowToBlockMapping: Map<string, string>
  originalFiles: any[]
}

const MergeAnalysisContext = createContext<MergeAnalysisContextType | undefined>(undefined)

// Create a mock DataContext for the visualizers
interface DataContextType {
  filteredData: DataRow[]
  selectedFiles: any[]
  selectedDay: any
  mergedData: DataRow[]
  excludedData: DataRow[]
  dayMergeLog: any
  toggleRowExclusion: () => void
  clearExclusions: () => void
  exportLogAsJSON: () => void
  exportLogAsCSV: () => void
  exportExcludedAsCSV: () => void
  reverseMerge: () => any[]
}

const DataContext = createContext<DataContextType | undefined>(undefined)

export function MergeAnalysisProvider({
  children,
  dataRows,
  diffAnalysis,
  mergedFile,
}: {
  children: ReactNode
  dataRows: DataRow[]
  diffAnalysis: DiffAnalysis | null
  mergedFile: any[] | null
}) {
  const rowToBlockMapping = new Map<string, string>()
  
  // Build row to block mapping from data rows
  dataRows.forEach(row => {
    const key = `${row._sourceFileIndex}:${row._originalRowIndex}`
    rowToBlockMapping.set(key, row._timeRange)
  })

  const mergeAnalysisValue: MergeAnalysisContextType = {
    dataRows,
    diffAnalysis,
    mergedFile: mergedFile ? { rows: [[...mergedFile]] } : null,
    rowToBlockMapping,
    originalFiles: diffAnalysis?.originalFiles ?? [],
  }

  // Create mock DataContext value for the visualizers
  const dataContextValue: DataContextType = {
    filteredData: dataRows,
    selectedFiles: [],
    selectedDay: {
      date: new Date().toISOString().split('T')[0],
      displayDate: new Date().toLocaleDateString(),
    },
    mergedData: dataRows,
    excludedData: dataRows.filter(r => r._excluded),
    dayMergeLog: {
      date: new Date().toISOString().split('T')[0],
      displayDate: new Date().toLocaleDateString(),
      totalKept: dataRows.filter(r => !r._excluded).length,
      totalExcluded: dataRows.filter(r => r._excluded).length,
      totalTimestampModifications: 0,
      files: [],
    },
    toggleRowExclusion: () => {},
    clearExclusions: () => {},
    exportLogAsJSON: () => {},
    exportLogAsCSV: () => {},
    exportExcludedAsCSV: () => {},
    reverseMerge: () => [],
  }

  return (
    <DataContext.Provider value={dataContextValue}>
      <MergeAnalysisContext.Provider value={mergeAnalysisValue}>
        {children}
      </MergeAnalysisContext.Provider>
    </DataContext.Provider>
  )
}

export function useMergeAnalysis() {
  const context = useContext(MergeAnalysisContext)
  if (!context) {
    throw new Error('useMergeAnalysis must be used within MergeAnalysisProvider')
  }
  return context
}

// Export useData hook that the visualizers can use
export function useData() {
  const context = useContext(DataContext)
  if (!context) {
    throw new Error('useData must be used within MergeAnalysisProvider')
  }
  return context
}

// Stub implementations for visualizer hooks that expect useData and useDiff
export function useDiff() {
  const context = useContext(MergeAnalysisContext)
  if (!context) {
    throw new Error('useDiff must be used within MergeAnalysisProvider')
  }

  return {
    diffAnalysis: context.diffAnalysis,
    originalFiles: context.originalFiles,
    mergedFile: context.mergedFile,
    rowToBlockMapping: context.rowToBlockMapping,
    exportAsJSON: () => {},
    exportAsCSV: () => {},
    exportExcludedAsCSV: () => {},
    downloadReconstructedFile: () => {},
  }
}
