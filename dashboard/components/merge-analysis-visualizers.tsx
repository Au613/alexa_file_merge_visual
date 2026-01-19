'use client'

import { createContext, useContext, ReactNode } from 'react'
import { DataVisualizer as OriginalDataVisualizer } from './data-visualizer'
import { DiffVisualizer as OriginalDiffVisualizer } from './diff-visualizer'
import type { DataRow, DiffAnalysis } from '@/lib/types'

// Re-create the contexts here for the visualizers to use
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

const LocalDataContext = createContext<DataContextType | undefined>(undefined)

interface LocalDiffContextType {
  diffAnalysis: DiffAnalysis | null
  originalFiles: any[]
  mergedFile: any
  rowToBlockMapping: Map<string, string>
  exportAsJSON: () => void
  exportAsCSV: () => void
  exportExcludedAsCSV: () => void
  downloadReconstructedFile: () => void
}

const LocalDiffContext = createContext<LocalDiffContextType | undefined>(undefined)

interface VisualizerContextProviderProps {
  children: ReactNode
  dataRows: DataRow[]
  diffAnalysis: DiffAnalysis | null
  rowToBlockMapping: Map<string, string>
}

export function VisualizerContextProvider({
  children,
  dataRows,
  diffAnalysis,
  rowToBlockMapping,
}: VisualizerContextProviderProps) {
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

  const diffContextValue: LocalDiffContextType = {
    diffAnalysis,
    originalFiles: diffAnalysis?.originalFiles ?? [],
    mergedFile: null,
    rowToBlockMapping,
    exportAsJSON: () => {},
    exportAsCSV: () => {},
    exportExcludedAsCSV: () => {},
    downloadReconstructedFile: () => {},
  }

  return (
    <LocalDataContext.Provider value={dataContextValue}>
      <LocalDiffContext.Provider value={diffContextValue}>
        {children}
      </LocalDiffContext.Provider>
    </LocalDataContext.Provider>
  )
}

interface DataVisualizerProps {
  className?: string
}

export function DataVisualizerWrapper({ className }: DataVisualizerProps) {
  return <OriginalDataVisualizer className={className} />
}

interface DiffVisualizerProps {
  onBack: () => void
}

export function DiffVisualizerWrapper({ onBack }: DiffVisualizerProps) {
  return <OriginalDiffVisualizer onBack={onBack} />
}
