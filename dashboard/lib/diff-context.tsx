'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { UploadedFile, DiffAnalysis, ExcludedRowsExport } from './types'
import { 
  analyzeFileDiff, 
  exportDiffAsJSON, 
  exportDiffAsCSV, 
  exportExcludedRowsAsCSV,
  generateExcludedRowsExport,
  reconstructOriginalFile
} from './diff-analysis'

interface DiffContextType {
  // Files state
  originalFiles: UploadedFile[]
  mergedFile: UploadedFile | null
  
  // Analysis result
  diffAnalysis: DiffAnalysis | null
  excludedRowsExport: ExcludedRowsExport | null
  
  // UI state
  isAnalyzing: boolean
  hasAnalyzed: boolean
  
  // Actions
  setFiles: (originalFiles: UploadedFile[], mergedFile: UploadedFile) => void
  runAnalysis: (originalFiles?: UploadedFile[], mergedFile?: UploadedFile) => void
  clearAll: () => void
  
  // Export actions
  exportAsJSON: () => void
  exportAsCSV: () => void
  exportExcludedAsCSV: () => void
  downloadReconstructedFile: (fileIndex: number) => void
}

const DiffContext = createContext<DiffContextType | undefined>(undefined)

export function DiffProvider({ children }: { children: ReactNode }) {
  const [originalFiles, setOriginalFiles] = useState<UploadedFile[]>([])
  const [mergedFile, setMergedFile] = useState<UploadedFile | null>(null)
  const [diffAnalysis, setDiffAnalysis] = useState<DiffAnalysis | null>(null)
  const [excludedRowsExport, setExcludedRowsExport] = useState<ExcludedRowsExport | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [hasAnalyzed, setHasAnalyzed] = useState(false)

  const setFiles = useCallback((origFiles: UploadedFile[], merged: UploadedFile) => {
    setOriginalFiles(origFiles)
    setMergedFile(merged)
    setDiffAnalysis(null)
    setExcludedRowsExport(null)
    setHasAnalyzed(false)
  }, [])

  const runAnalysis = useCallback((origFiles?: UploadedFile[], merged?: UploadedFile) => {
    // Use passed files or fall back to state
    const filesToUse = origFiles || originalFiles
    const mergedToUse = merged || mergedFile
    
    if (filesToUse.length === 0 || !mergedToUse) {
      return
    }
    
    setIsAnalyzing(true)
    
    // Run analysis (could be async for large files)
    setTimeout(() => {
      const analysis = analyzeFileDiff(filesToUse, mergedToUse)
      setDiffAnalysis(analysis)
      
      const excluded = generateExcludedRowsExport(analysis)
      setExcludedRowsExport(excluded)
      
      setIsAnalyzing(false)
      setHasAnalyzed(true)
    }, 100)
  }, [originalFiles, mergedFile])

  const clearAll = useCallback(() => {
    setOriginalFiles([])
    setMergedFile(null)
    setDiffAnalysis(null)
    setExcludedRowsExport(null)
    setHasAnalyzed(false)
  }, [])

  const exportAsJSON = useCallback(() => {
    if (!diffAnalysis) return
    
    const json = exportDiffAsJSON(diffAnalysis)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `merge_analysis_${diffAnalysis.date}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [diffAnalysis])

  const exportAsCSV = useCallback(() => {
    if (!diffAnalysis) return
    
    const csv = exportDiffAsCSV(diffAnalysis)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `merge_analysis_${diffAnalysis.date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [diffAnalysis])

  const exportExcludedAsCSV = useCallback(() => {
    if (!diffAnalysis) return
    
    const csv = exportExcludedRowsAsCSV(diffAnalysis)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `excluded_rows_${diffAnalysis.date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [diffAnalysis])

  const downloadReconstructedFile = useCallback((fileIndex: number) => {
    if (!diffAnalysis) return
    
    const rows = reconstructOriginalFile(diffAnalysis, fileIndex)
    const fileName = diffAnalysis.originalFiles[fileIndex]?.fileName || `file_${fileIndex + 1}`
    
    // Create CSV
    const headers = ['Row', 'Subject', 'Timestamp', 'Behavior']
    const csv = [
      headers.join(','),
      ...rows.map(r => [
        String(r.rowIndex),
        `"${r.subject.replace(/"/g, '""')}"`,
        `"${r.timestamp}"`,
        `"${r.behavior.replace(/"/g, '""')}"`
      ].join(','))
    ].join('\n')
    
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reconstructed_${fileName.replace(/\.xlsx?$/, '')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [diffAnalysis])

  return (
    <DiffContext.Provider value={{
      originalFiles,
      mergedFile,
      diffAnalysis,
      excludedRowsExport,
      isAnalyzing,
      hasAnalyzed,
      setFiles,
      runAnalysis,
      clearAll,
      exportAsJSON,
      exportAsCSV,
      exportExcludedAsCSV,
      downloadReconstructedFile
    }}>
      {children}
    </DiffContext.Provider>
  )
}

export function useDiff() {
  const context = useContext(DiffContext)
  if (context === undefined) {
    throw new Error('useDiff must be used within a DiffProvider')
  }
  return context
}
