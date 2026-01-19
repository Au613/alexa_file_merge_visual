import type { UploadedFile, RowDiffRecord, DiffAnalysis, ExcludedRowsExport } from './types'
import * as XLSX from 'xlsx'

/**
 * Parse an Excel file and extract rows
 */
export function parseExcelFile(file: File): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    
    reader.onload = (e) => {
      try {
        const data = e.target?.result
        const workbook = XLSX.read(data, { type: 'binary' })
        const sheetName = workbook.SheetNames[0]
        const sheet = workbook.Sheets[sheetName]
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][]
        
        const rows = jsonData.map((row, index) => ({
          rowIndex: index + 1, // 1-indexed
          subject: String(row[0] || ''),
          timestamp: formatTimestamp(row[1]),
          behavior: String(row[2] || '')
        })).filter(row => row.subject || row.timestamp || row.behavior) // Filter empty rows
        
        resolve({
          id: Math.random().toString(36).substring(2, 11),
          name: file.name,
          uploadedAt: new Date(),
          rows
        })
      } catch (error) {
        reject(error)
      }
    }
    
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsBinaryString(file)
  })
}

/**
 * Format timestamp from Excel serial number or string
 */
function formatTimestamp(value: unknown): string {
  if (typeof value === 'number') {
    // Excel serial number
    const utcDays = Math.floor(value - 25569)
    const utcValue = utcDays * 86400
    const fractionalDay = value - Math.floor(value) + 0.0000001
    const totalSeconds = Math.floor(86400 * fractionalDay)
    const date = new Date((utcValue + totalSeconds) * 1000)
    
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(date.getUTCDate()).padStart(2, '0')
    const yyyy = date.getUTCFullYear()
    const hh = date.getUTCHours()
    const min = String(date.getUTCMinutes()).padStart(2, '0')
    const sec = String(date.getUTCSeconds()).padStart(2, '0')
    
    return `${mm}/${dd}/${yyyy} ${hh}:${min}:${sec}`
  }
  return String(value || '')
}

/**
 * Normalize timestamp for comparison (handle minor formatting differences)
 */
function normalizeTimestamp(ts: string): string {
  // Remove extra spaces, standardize format
  return ts.trim().replace(/\s+/g, ' ')
}

/**
 * Compare two timestamps and check if they're essentially the same
 */
function timestampsMatch(ts1: string, ts2: string): boolean {
  return normalizeTimestamp(ts1) === normalizeTimestamp(ts2)
}

/**
 * Create a hash key for a row to help with matching
 * Uses subject + behavior (columns 1 and 3)
 */
function createRowKey(subject: string, behavior: string): string {
  return `${subject.trim()}||${behavior.trim()}`
}

/**
 * Analyze the diff between original files and merged file
 */
export function analyzeFileDiff(
  originalFiles: UploadedFile[],
  mergedFile: UploadedFile
): DiffAnalysis {
  // Extract date from first file or merged file name
  const dateMatch = mergedFile.name.match(/(\d{4})\.(\d{2})\.(\d{2})/) || 
                    mergedFile.name.match(/(\d{4})-(\d{2})-(\d{2})/)
  const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : 'Unknown'
  const displayDate = dateMatch ? `${dateMatch[2]}/${dateMatch[3]}/${dateMatch[1]}` : 'Unknown'
  
  console.log("[v0] Starting diff analysis")
  console.log("[v0] Merged file:", mergedFile.name, "with", mergedFile.rows.length, "rows")
  console.log("[v0] Original files:", originalFiles.map(f => `${f.name} (${f.rows.length} rows)`))
  
  // Log sample rows from merged file
  if (mergedFile.rows.length > 0) {
    console.log("[v0] Merged file sample row 1:", mergedFile.rows[0])
    if (mergedFile.rows.length > 1) {
      console.log("[v0] Merged file sample row 2:", mergedFile.rows[1])
    }
  }
  
  // Log sample rows from original files
  originalFiles.forEach((f, i) => {
    if (f.rows.length > 0) {
      console.log(`[v0] Original file ${i + 1} sample row 1:`, f.rows[0])
    }
  })
  
  // Build lookup map for merged file rows
  // Key: subject + behavior (columns 1 and 3)
  // Value: array of { mergedRowIndex, timestamp, subject, behavior }
  const mergedRowsMap = new Map<string, { mergedRowIndex: number; timestamp: string; subject: string; behavior: string }[]>()
  
  mergedFile.rows.forEach((row, idx) => {
    const key = createRowKey(row.subject, row.behavior)
    if (!mergedRowsMap.has(key)) {
      mergedRowsMap.set(key, [])
    }
    mergedRowsMap.get(key)!.push({
      mergedRowIndex: idx + 1,
      timestamp: row.timestamp,
      subject: row.subject,
      behavior: row.behavior
    })
  })
  
  console.log("[v0] Built merged rows map with", mergedRowsMap.size, "unique subject+behavior keys")
  
  // Track which merged rows have been matched to avoid double-counting
  const matchedMergedRows = new Set<number>()
  
  // Analyze each original file
  const fileAnalyses = originalFiles.map((origFile, fileIndex) => {
    const rowDiffs: RowDiffRecord[] = []
    let keptCount = 0
    let excludedCount = 0
    let timestampModCount = 0
    
    console.log(`[v0] Analyzing file ${fileIndex + 1}: ${origFile.name}`)
    
    origFile.rows.forEach((origRow, rowIdx) => {
      const key = createRowKey(origRow.subject, origRow.behavior)
      const possibleMatches = mergedRowsMap.get(key) || []
      
      // Find a match that hasn't been used yet
      let match: { mergedRowIndex: number; timestamp: string; subject: string; behavior: string } | undefined
      
      for (const candidate of possibleMatches) {
        if (!matchedMergedRows.has(candidate.mergedRowIndex)) {
          match = candidate
          matchedMergedRows.add(candidate.mergedRowIndex)
          break
        }
      }
      
      // Log first few rows with side-by-side comparison
      if (rowIdx < 5) {
        if (match) {
          console.log(`[v0] MATCH | Original[File${fileIndex + 1}, Row${origRow.rowIndex}]: subject="${origRow.subject}", behavior="${origRow.behavior}", ts="${origRow.timestamp}" | Merged[Row${match.mergedRowIndex}]: subject="${match.subject}", behavior="${match.behavior}", ts="${match.timestamp}"`)
        } else {
          console.log(`[v0] NO MATCH | Original[File${fileIndex + 1}, Row${origRow.rowIndex}]: subject="${origRow.subject}", behavior="${origRow.behavior}", ts="${origRow.timestamp}" | Key="${key}" not found in merged file`)
        }
      }
      
      if (match) {
        // Row was kept
        const timestampModified = !timestampsMatch(origRow.timestamp, match.timestamp)
        
        rowDiffs.push({
          originalRowIndex: origRow.rowIndex,
          sourceFileName: origFile.name,
          sourceFileIndex: fileIndex,
          subject: origRow.subject,
          originalTimestamp: origRow.timestamp,
          behavior: origRow.behavior,
          status: 'kept',
          mergedRowIndex: match.mergedRowIndex,
          newTimestamp: timestampModified ? match.timestamp : undefined,
          timestampModified
        })
        
        keptCount++
        if (timestampModified) timestampModCount++
      } else {
        // Row was excluded
        rowDiffs.push({
          originalRowIndex: origRow.rowIndex,
          sourceFileName: origFile.name,
          sourceFileIndex: fileIndex,
          subject: origRow.subject,
          originalTimestamp: origRow.timestamp,
          behavior: origRow.behavior,
          status: 'excluded',
          timestampModified: false
        })
        
        excludedCount++
      }
    })
    
    console.log(`[v0] File ${fileIndex + 1} results: ${keptCount} kept, ${excludedCount} excluded, ${timestampModCount} timestamp mods`)
    
    return {
      fileIndex,
      fileName: origFile.name,
      totalRows: origFile.rows.length,
      keptRows: keptCount,
      excludedRows: excludedCount,
      timestampModifications: timestampModCount,
      rows: rowDiffs
    }
  })
  
  return {
    date,
    displayDate,
    analyzedAt: new Date(),
    originalFiles: fileAnalyses,
    mergedFile: {
      fileName: mergedFile.name,
      totalRows: mergedFile.rows.length
    },
    totalOriginalRows: fileAnalyses.reduce((sum, f) => sum + f.totalRows, 0),
    totalKept: fileAnalyses.reduce((sum, f) => sum + f.keptRows, 0),
    totalExcluded: fileAnalyses.reduce((sum, f) => sum + f.excludedRows, 0),
    totalTimestampModifications: fileAnalyses.reduce((sum, f) => sum + f.timestampModifications, 0)
  }
}

/**
 * Export diff analysis as JSON
 */
export function exportDiffAsJSON(analysis: DiffAnalysis): string {
  return JSON.stringify(analysis, null, 2)
}

/**
 * Export diff analysis as CSV
 */
export function exportDiffAsCSV(analysis: DiffAnalysis): string {
  const headers = [
    'Source File',
    'Original Row',
    'Status',
    'Merged Row',
    'Subject',
    'Original Timestamp',
    'New Timestamp',
    'Timestamp Changed',
    'Behavior'
  ]
  
  const rows: string[][] = []
  
  analysis.originalFiles.forEach(file => {
    file.rows.forEach(row => {
      rows.push([
        row.sourceFileName,
        String(row.originalRowIndex),
        row.status,
        row.mergedRowIndex ? String(row.mergedRowIndex) : '',
        row.subject,
        row.originalTimestamp,
        row.newTimestamp || '',
        row.timestampModified ? 'Yes' : 'No',
        row.behavior
      ])
    })
  })
  
  return [
    headers.join(','),
    ...rows.map(r => r.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
  ].join('\n')
}

/**
 * Export excluded rows as CSV
 */
export function exportExcludedRowsAsCSV(analysis: DiffAnalysis): string {
  const headers = ['Source File', 'Original Row', 'Subject', 'Timestamp', 'Behavior']
  
  const rows: string[][] = []
  
  analysis.originalFiles.forEach(file => {
    file.rows
      .filter(row => row.status === 'excluded')
      .forEach(row => {
        rows.push([
          row.sourceFileName,
          String(row.originalRowIndex),
          row.subject,
          row.originalTimestamp,
          row.behavior
        ])
      })
  })
  
  return [
    headers.join(','),
    ...rows.map(r => r.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
  ].join('\n')
}

/**
 * Generate excluded rows export object
 */
export function generateExcludedRowsExport(analysis: DiffAnalysis): ExcludedRowsExport {
  return {
    date: analysis.date,
    displayDate: analysis.displayDate,
    exportedAt: new Date(),
    files: analysis.originalFiles.map(file => ({
      fileIndex: file.fileIndex,
      fileName: file.fileName,
      excludedRows: file.rows
        .filter(r => r.status === 'excluded')
        .map(r => ({
          rowIndex: r.originalRowIndex,
          subject: r.subject,
          timestamp: r.originalTimestamp,
          behavior: r.behavior
        }))
    })),
    totalExcluded: analysis.totalExcluded
  }
}

/**
 * Reconstruct original file by combining kept rows with excluded rows
 */
export function reconstructOriginalFile(
  analysis: DiffAnalysis,
  fileIndex: number
): { rowIndex: number; subject: string; timestamp: string; behavior: string }[] {
  const file = analysis.originalFiles.find(f => f.fileIndex === fileIndex)
  if (!file) return []
  
  return file.rows
    .map(row => ({
      rowIndex: row.originalRowIndex,
      subject: row.subject,
      timestamp: row.originalTimestamp,
      behavior: row.behavior
    }))
    .sort((a, b) => a.rowIndex - b.rowIndex)
}

/**
 * Group consecutive rows by status for compact display
 */
export function groupRowsByStatus(rows: RowDiffRecord[]): {
  status: 'kept' | 'excluded'
  startRow: number
  endRow: number
  count: number
  hasTimestampMods: boolean
  rows: RowDiffRecord[]
}[] {
  if (rows.length === 0) return []
  
  const groups: ReturnType<typeof groupRowsByStatus> = []
  let currentGroup: typeof groups[0] | null = null
  
  // Sort by original row index first
  const sortedRows = [...rows].sort((a, b) => a.originalRowIndex - b.originalRowIndex)
  
  sortedRows.forEach(row => {
    if (!currentGroup || 
        currentGroup.status !== row.status ||
        row.originalRowIndex !== currentGroup.endRow + 1) {
      // Start new group
      if (currentGroup) groups.push(currentGroup)
      currentGroup = {
        status: row.status,
        startRow: row.originalRowIndex,
        endRow: row.originalRowIndex,
        count: 1,
        hasTimestampMods: row.timestampModified,
        rows: [row]
      }
    } else {
      // Extend current group
      currentGroup.endRow = row.originalRowIndex
      currentGroup.count++
      if (row.timestampModified) currentGroup.hasTimestampMods = true
      currentGroup.rows.push(row)
    }
  })
  
  if (currentGroup) groups.push(currentGroup)
  return groups
}

/**
 * Generate merged file visualization showing which blocks came from which original files
 * Returns blocks in the order they appear in the merged file
 */
export interface MergedFileBlock {
  sourceFileIndex: number
  sourceFileName: string
  mergedStartRow: number
  mergedEndRow: number
  originalStartRow: number
  originalEndRow: number
  count: number
  hasTimestampMods: boolean
}

export function generateMergedFileBlocks(analysis: DiffAnalysis): MergedFileBlock[] {
  // Get all kept rows with their merged row index
  const keptRowsWithMergedIndex: {
    sourceFileIndex: number
    sourceFileName: string
    mergedRowIndex: number
    originalRowIndex: number
    timestampModified: boolean
  }[] = []
  
  analysis.originalFiles.forEach(file => {
    file.rows.forEach(row => {
      if (row.status === 'kept' && row.mergedRowIndex !== undefined) {
        keptRowsWithMergedIndex.push({
          sourceFileIndex: row.sourceFileIndex,
          sourceFileName: row.sourceFileName,
          mergedRowIndex: row.mergedRowIndex,
          originalRowIndex: row.originalRowIndex,
          timestampModified: row.timestampModified
        })
      }
    })
  })
  
  // Sort by merged row index
  keptRowsWithMergedIndex.sort((a, b) => a.mergedRowIndex - b.mergedRowIndex)
  
  if (keptRowsWithMergedIndex.length === 0) return []
  
  // Group consecutive rows from the same file
  const blocks: MergedFileBlock[] = []
  let currentBlock: MergedFileBlock | null = null
  
  keptRowsWithMergedIndex.forEach(row => {
    if (!currentBlock ||
        currentBlock.sourceFileIndex !== row.sourceFileIndex ||
        row.mergedRowIndex !== currentBlock.mergedEndRow + 1) {
      // Start new block
      if (currentBlock) blocks.push(currentBlock)
      currentBlock = {
        sourceFileIndex: row.sourceFileIndex,
        sourceFileName: row.sourceFileName,
        mergedStartRow: row.mergedRowIndex,
        mergedEndRow: row.mergedRowIndex,
        originalStartRow: row.originalRowIndex,
        originalEndRow: row.originalRowIndex,
        count: 1,
        hasTimestampMods: row.timestampModified
      }
    } else {
      // Extend current block
      currentBlock.mergedEndRow = row.mergedRowIndex
      currentBlock.originalEndRow = row.originalRowIndex
      currentBlock.count++
      if (row.timestampModified) currentBlock.hasTimestampMods = true
    }
  })
  
  if (currentBlock) blocks.push(currentBlock)
  return blocks
}
