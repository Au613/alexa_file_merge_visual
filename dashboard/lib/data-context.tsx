'use client'

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import type { 
  YearFolder, 
  MonthFolder, 
  DayFolder, 
  ExcelFile, 
  FilterRule, 
  SelectionState,
  DataRow,
  ExcludedRowsExport
} from './types'
import { 
  generateYearData, 
  generateMockRows, 
  applyFilterRules, 
  generateMockMergeLog,
  generateExcludedRowsExport,
  exportMergeLogAsJSON,
  exportMergeLogAsCSV,
  exportExcludedRowsAsCSV,
  reconstructOriginalFile
} from './mock-data'

interface DataContextType {
  // Data state
  yearData: YearFolder | null
  selectedMonth: MonthFolder | null
  selectedDay: DayFolder | null
  selectedFiles: ExcelFile[]
  
  // Filter rules
  filterRules: FilterRule[]
  
  // Processed data
  mergedData: DataRow[]
  filteredData: DataRow[]
  excludedData: DataRow[]
  
  // Merge log
  excludedRowsExport: ExcludedRowsExport | null
  
  // Selection state
  selection: SelectionState
  
  // Loading states
  isLoading: boolean
  
  // Actions
  loadYear: (year: number) => void
  selectMonth: (month: MonthFolder | null) => void
  selectDay: (day: DayFolder | null) => void
  toggleFileSelection: (file: ExcelFile) => void
  selectAllFiles: () => void
  clearFileSelection: () => void
  
  // Rule actions
  addRule: (rule: Omit<FilterRule, 'id' | 'createdAt' | 'updatedAt'>) => void
  updateRule: (id: string, updates: Partial<FilterRule>) => void
  deleteRule: (id: string) => void
  toggleRule: (id: string) => void
  
  // Data actions
  mergeSelectedFiles: () => void
  mergeDay: (day: DayFolder) => void
  applyFilters: () => void
  clearFilters: () => void
  
  // Row exclusion actions
  toggleRowExclusion: (rowId: string) => void
  excludeRowRange: (startRowId: string, endRowId: string) => void
  includeRowRange: (startRowId: string, endRowId: string) => void
  excludeTimeBlock: (fileIndex: number, timeBlock: string) => void
  includeTimeBlock: (fileIndex: number, timeBlock: string) => void
  clearExclusions: () => void
  
  // Export actions
  exportLogAsJSON: () => void
  exportLogAsCSV: () => void
  exportExcludedAsCSV: () => void
  reverseMerge: (fileIndex: number) => { subject: string; timestamp: string; behavior: string }[]
}

const DataContext = createContext<DataContextType | undefined>(undefined)

export function DataProvider({ children }: { children: ReactNode }) {
  const [yearData, setYearData] = useState<YearFolder | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<MonthFolder | null>(null)
  const [selectedDay, setSelectedDay] = useState<DayFolder | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<ExcelFile[]>([])
  const [filterRules, setFilterRules] = useState<FilterRule[]>([])
  const [mergedData, setMergedData] = useState<DataRow[]>([])
  const [filteredData, setFilteredData] = useState<DataRow[]>([])
  const [excludedRowsExport, setExcludedRowsExport] = useState<ExcludedRowsExport | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [selection, setSelection] = useState<SelectionState>({
    level: 'year',
    selectedFiles: []
  })

  const loadYear = useCallback((year: number) => {
    setIsLoading(true)
    // Simulate loading delay
    setTimeout(() => {
      const data = generateYearData(year)
      setYearData(data)
      setSelectedMonth(null)
      setSelectedDay(null)
      setSelectedFiles([])
      setMergedData([])
      setFilteredData([])
      setSelection({ level: 'year', year, selectedFiles: [] })
      setIsLoading(false)
    }, 300)
  }, [])

  const selectMonth = useCallback((month: MonthFolder | null) => {
    setSelectedMonth(month)
    setSelectedDay(null)
    setSelectedFiles([])
    setMergedData([])
    setFilteredData([])
    if (month) {
      setSelection({ 
        level: 'month', 
        year: month.year, 
        month: month.month,
        selectedFiles: [] 
      })
    }
  }, [])

  const selectDay = useCallback((day: DayFolder | null) => {
    setSelectedDay(day)
    if (day) {
      setSelectedFiles(day.files)
      setSelection({ 
        level: 'day', 
        day: day.date,
        selectedFiles: day.files.map(f => f.id) 
      })
      // Auto-merge when selecting a day
      const rows = generateMockRows(day.files, day.date)
      setMergedData(rows)
      setFilteredData(applyFilterRules(rows, filterRules))
      // Generate mock merge log (row-level tracking)
      const mockLog = generateMockMergeLog(day.files, rows, day.date)
      setDayMergeLog(mockLog)
      // Generate excluded rows export
      const excluded = generateExcludedRowsExport(mockLog)
      setExcludedRowsExport(excluded)
    } else {
      setSelectedFiles([])
      setMergedData([])
      setFilteredData([])
      setDayMergeLog(null)
      setExcludedRowsExport(null)
    }
  }, [filterRules])

  const toggleFileSelection = useCallback((file: ExcelFile) => {
    setSelectedFiles(prev => {
      const isSelected = prev.some(f => f.id === file.id)
      if (isSelected) {
        return prev.filter(f => f.id !== file.id)
      }
      return [...prev, file]
    })
  }, [])

  const selectAllFiles = useCallback(() => {
    if (selectedDay) {
      setSelectedFiles(selectedDay.files)
    }
  }, [selectedDay])

  const clearFileSelection = useCallback(() => {
    setSelectedFiles([])
  }, [])

  const addRule = useCallback((rule: Omit<FilterRule, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newRule: FilterRule = {
      ...rule,
      id: Math.random().toString(36).substring(2, 11),
      createdAt: new Date(),
      updatedAt: new Date()
    }
    setFilterRules(prev => [...prev, newRule])
  }, [])

  const updateRule = useCallback((id: string, updates: Partial<FilterRule>) => {
    setFilterRules(prev => prev.map(rule => 
      rule.id === id 
        ? { ...rule, ...updates, updatedAt: new Date() }
        : rule
    ))
  }, [])

  const deleteRule = useCallback((id: string) => {
    setFilterRules(prev => prev.filter(rule => rule.id !== id))
  }, [])

  const toggleRule = useCallback((id: string) => {
    setFilterRules(prev => prev.map(rule => 
      rule.id === id 
        ? { ...rule, enabled: !rule.enabled, updatedAt: new Date() }
        : rule
    ))
  }, [])

  const mergeSelectedFiles = useCallback(() => {
    if (selectedFiles.length === 0 || !selectedDay) return
    const rows = generateMockRows(selectedFiles, selectedDay.date)
    setMergedData(rows)
    setFilteredData(applyFilterRules(rows, filterRules))
  }, [selectedFiles, selectedDay, filterRules])

  const mergeDay = useCallback((day: DayFolder) => {
    setSelectedDay(day)
    setSelectedFiles(day.files)
    const rows = generateMockRows(day.files, day.date)
    setMergedData(rows)
    setFilteredData(applyFilterRules(rows, filterRules))
    // Generate mock merge log (row-level tracking)
    const mockLog = generateMockMergeLog(day.files, rows, day.date)
    setDayMergeLog(mockLog)
    const excluded = generateExcludedRowsExport(mockLog)
    setExcludedRowsExport(excluded)
  }, [filterRules])

  const applyFilters = useCallback(() => {
    setFilteredData(applyFilterRules(mergedData, filterRules))
  }, [mergedData, filterRules])

  const clearFilters = useCallback(() => {
    setFilterRules([])
    setFilteredData(mergedData)
  }, [mergedData])

  // Helper to regenerate merge log after exclusion changes
  const regenerateMergeLog = useCallback((rows: DataRow[]) => {
    if (!selectedDay) return
    const mockLog = generateMockMergeLog(selectedDay.files, rows, selectedDay.date)
    setDayMergeLog(mockLog)
    const excluded = generateExcludedRowsExport(mockLog)
    setExcludedRowsExport(excluded)
  }, [selectedDay])

  const toggleRowExclusion = useCallback((rowId: string) => {
    setMergedData(prev => {
      const updated = prev.map(row => 
        row._rowId === rowId ? { ...row, _excluded: !row._excluded } : row
      )
      setFilteredData(applyFilterRules(updated, filterRules))
      regenerateMergeLog(updated)
      return updated
    })
  }, [filterRules, regenerateMergeLog])

  const excludeRowRange = useCallback((startRowId: string, endRowId: string) => {
    setMergedData(prev => {
      const startIdx = prev.findIndex(r => r._rowId === startRowId)
      const endIdx = prev.findIndex(r => r._rowId === endRowId)
      if (startIdx === -1 || endIdx === -1) return prev
      
      const [minIdx, maxIdx] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)]
      const updated = prev.map((row, idx) => 
        idx >= minIdx && idx <= maxIdx ? { ...row, _excluded: true } : row
      )
      setFilteredData(applyFilterRules(updated, filterRules))
      regenerateMergeLog(updated)
      return updated
    })
  }, [filterRules, regenerateMergeLog])

  const includeRowRange = useCallback((startRowId: string, endRowId: string) => {
    setMergedData(prev => {
      const startIdx = prev.findIndex(r => r._rowId === startRowId)
      const endIdx = prev.findIndex(r => r._rowId === endRowId)
      if (startIdx === -1 || endIdx === -1) return prev
      
      const [minIdx, maxIdx] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)]
      const updated = prev.map((row, idx) => 
        idx >= minIdx && idx <= maxIdx ? { ...row, _excluded: false } : row
      )
      setFilteredData(applyFilterRules(updated, filterRules))
      regenerateMergeLog(updated)
      return updated
    })
  }, [filterRules, regenerateMergeLog])

  const excludeTimeBlock = useCallback((fileIndex: number, timeBlock: string) => {
    setMergedData(prev => {
      const affectedRows = prev.filter(r => r._sourceFileIndex === fileIndex && r._timeRange === timeBlock)
      if (affectedRows.length === 0) return prev
      
      const updated = prev.map(row => 
        row._sourceFileIndex === fileIndex && row._timeRange === timeBlock 
          ? { ...row, _excluded: true } 
          : row
      )
      setFilteredData(applyFilterRules(updated, filterRules))
      regenerateMergeLog(updated)
      return updated
    })
  }, [filterRules, regenerateMergeLog])

  const includeTimeBlock = useCallback((fileIndex: number, timeBlock: string) => {
    setMergedData(prev => {
      const affectedRows = prev.filter(r => r._sourceFileIndex === fileIndex && r._timeRange === timeBlock)
      if (affectedRows.length === 0) return prev
      
      const updated = prev.map(row => 
        row._sourceFileIndex === fileIndex && row._timeRange === timeBlock 
          ? { ...row, _excluded: false } 
          : row
      )
      setFilteredData(applyFilterRules(updated, filterRules))
      regenerateMergeLog(updated)
      return updated
    })
  }, [filterRules, regenerateMergeLog])

  const clearExclusions = useCallback(() => {
    setMergedData(prev => {
      const updated = prev.map(row => ({ ...row, _excluded: false }))
      setFilteredData(applyFilterRules(updated, filterRules))
      regenerateMergeLog(updated)
      return updated
    })
  }, [filterRules, regenerateMergeLog])

  // Export functions
  const exportLogAsJSON = useCallback(() => {
    if (!dayMergeLog) return
    const json = exportMergeLogAsJSON(dayMergeLog)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `merge_log_${dayMergeLog.date}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [dayMergeLog])

  const exportLogAsCSV = useCallback(() => {
    if (!dayMergeLog) return
    const csv = exportMergeLogAsCSV(dayMergeLog)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `merge_log_${dayMergeLog.date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [dayMergeLog])

  const exportExcludedAsCSV = useCallback(() => {
    if (!excludedRowsExport) return
    const csv = exportExcludedRowsAsCSV(excludedRowsExport)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `excluded_rows_${excludedRowsExport.date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [excludedRowsExport])

  const reverseMerge = useCallback((fileIndex: number) => {
    if (!excludedRowsExport) return []
    return reconstructOriginalFile(mergedData, excludedRowsExport, fileIndex)
  }, [mergedData, excludedRowsExport])

  // Compute excluded data
  const excludedData = useMemo(() => {
    return mergedData.filter(row => row._excluded)
  }, [mergedData])

  return (
    <DataContext.Provider value={{
      yearData,
      selectedMonth,
      selectedDay,
      selectedFiles,
      filterRules,
      mergedData,
      filteredData,
      selection,
      isLoading,
      loadYear,
      selectMonth,
      selectDay,
      toggleFileSelection,
      selectAllFiles,
      clearFileSelection,
      addRule,
      updateRule,
      deleteRule,
      toggleRule,
      mergeSelectedFiles,
      mergeDay,
      applyFilters,
      clearFilters,
      excludedData,
      excludedRowsExport,
      toggleRowExclusion,
      excludeRowRange,
      includeRowRange,
      excludeTimeBlock,
      includeTimeBlock,
      clearExclusions,
      exportLogAsJSON,
      exportLogAsCSV,
      exportExcludedAsCSV,
      reverseMerge
    }}>
      {children}
    </DataContext.Provider>
  )
}

export function useData() {
  const context = useContext(DataContext)
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider')
  }
  return context
}
