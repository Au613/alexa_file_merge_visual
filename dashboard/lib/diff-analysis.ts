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
 * Includes: subject + behavior + block-relative position for future robustness
 * Format: subject||behavior||blockRelativeIndex
 */
function createRowKey(subject: string, behavior: string, blockRelativeIndex?: number): string {
  const normalizedSubject = normalizeSubject(subject)
  const key = `${normalizedSubject}||${behavior.trim()}`
  
  // Include block-relative position if provided (more robust for complex scenarios)
  if (blockRelativeIndex !== undefined) {
    return `${key}||${blockRelativeIndex}`
  }
  
  return key
}

/**
 * Parse timestamp string into a Date object for time calculations
 */
function parseTimestamp(ts: string): Date {
  // Expected format: "MM/DD/YYYY HH:MM:SS"
  const parts = ts.split(' ')
  if (parts.length !== 2) return new Date(0)
  
  const [date, time] = parts
  const [month, day, year] = date.split('/').map(Number)
  const [hour, min, sec] = time.split(':').map(Number)
  
  return new Date(year, month - 1, day, hour, min, sec)
}

/**
 * Calculate minutes between two timestamps
 * Returns Infinity if either timestamp fails to parse (forces new block)
 */
function minutesBetween(ts1: string, ts2: string): number {
  const date1 = parseTimestamp(ts1)
  const date2 = parseTimestamp(ts2)

  if (isNaN(date1.getTime()) || isNaN(date2.getTime())) {
    return Infinity // force new block on parse failure
  }

  return Math.abs(date2.getTime() - date1.getTime()) / (1000 * 60)
}

/**
 * Normalize subject for consistent comparison (trim, whitespace, case)
 */
function normalizeSubject(subject: string): string {
  return subject.trim().replace(/\s+/g, ' ').toUpperCase()
}

/**
 * Break rows into blocks by subject and time proximity (sequential runs only)
 * 
 * A new block starts if either:
 * - subject differs from previous row, OR
 * - time since previous row exceeds threshold
 * 
 * This creates "streaks" or "runs" that never re-enter earlier blocks,
 * even if subject matches non-adjacent rows.
 */
export function createBlocksFromRows(
  rows: Array<{ subject: string; timestamp: string; behavior: string; rowIndex: number }>,
  fileName: string,
  fileIndex: number,
  timeThresholdMinutes: number = 10
): Array<{
  id: string
  label: string
  subject: string
  startTimestamp: string
  endTimestamp: string
  rows: Array<{ subject: string; timestamp: string; behavior: string; rowIndex: number }>
  sourceFileName: string
  sourceFileIndex: number
}> {
  if (rows.length === 0) return []

  const blocks = []
  let blockIndex = 0

  let currentBlock = {
    id: `${fileName}_block_${blockIndex}`,
    subject: rows[0].subject,
    startTimestamp: rows[0].timestamp,
    endTimestamp: rows[0].timestamp,
    rows: [rows[0]],
    sourceFileName: fileName,
    sourceFileIndex: fileIndex
  }

  for (let i = 1; i < rows.length; i++) {
    const prevRow = rows[i - 1]
    const row = rows[i]

    const sameSubject =
      normalizeSubject(row.subject) === normalizeSubject(prevRow.subject)
    const withinTime =
      minutesBetween(prevRow.timestamp, row.timestamp) <= timeThresholdMinutes

    if (sameSubject && withinTime) {
      // Continue current block
      currentBlock.rows.push(row)
      currentBlock.endTimestamp = row.timestamp
    } else {
      // Save current block and start new one
      const blockLabel = `${normalizeSubject(currentBlock.subject).substring(0, 15)}_${blockIndex}`
      blocks.push({
        id: currentBlock.id,
        label: blockLabel,
        subject: currentBlock.subject,
        startTimestamp: currentBlock.startTimestamp,
        endTimestamp: currentBlock.endTimestamp,
        rows: currentBlock.rows,
        sourceFileName: currentBlock.sourceFileName,
        sourceFileIndex: currentBlock.sourceFileIndex
      })

      blockIndex++
      currentBlock = {
        id: `${fileName}_block_${blockIndex}`,
        subject: row.subject,
        startTimestamp: row.timestamp,
        endTimestamp: row.timestamp,
        rows: [row],
        sourceFileName: fileName,
        sourceFileIndex: fileIndex
      }
    }
  }

  // Push final block
  const blockLabel = `${normalizeSubject(currentBlock.subject).substring(0, 15)}_${blockIndex}`
  blocks.push({
    id: currentBlock.id,
    label: blockLabel,
    subject: currentBlock.subject,
    startTimestamp: currentBlock.startTimestamp,
    endTimestamp: currentBlock.endTimestamp,
    rows: currentBlock.rows,
    sourceFileName: currentBlock.sourceFileName,
    sourceFileIndex: currentBlock.sourceFileIndex
  })

  return blocks
}

/**
 * Create a mapping from row index to block label for all files
 */
export function createRowToBlockMapping(
  originalFiles: UploadedFile[],
  timeThresholdMinutes: number = 10
): Map<string, string> {
  const mapping = new Map<string, string>()

  originalFiles.forEach((file, fileIndex) => {
    const blocks = createBlocksFromRows(
      file.rows,
      file.name,
      fileIndex,
      timeThresholdMinutes
    )

    blocks.forEach(block => {
      block.rows.forEach(row => {
        const key = `${fileIndex}:${row.rowIndex}`
        mapping.set(key, block.label)
      })
    })
  })

  return mapping
}

/**
 * Compare two blocks - checks which rows match between original and merged blocks
 * Uses block-relative position for more robust matching
 */
export function compareBlocks(
  originalBlock: {
    subject: string
    rows: Array<{ subject: string; timestamp: string; behavior: string; rowIndex: number }>
    sourceFileName: string
  },
  mergedBlock: {
    subject: string
    rows: Array<{ subject: string; timestamp: string; behavior: string; rowIndex: number }>
  } | null
): {
  matchedRows: Array<{ original: any; merged: any }>
  excludedRows: Array<any>
  addedRows: Array<any>
  rowCountOriginal: number
  rowCountMerged: number
} {
  const result = {
    matchedRows: [] as Array<{ original: any; merged: any }>,
    excludedRows: [] as Array<any>,
    addedRows: [] as Array<any>,
    rowCountOriginal: originalBlock.rows.length,
    rowCountMerged: mergedBlock?.rows.length ?? 0
  }

  if (!mergedBlock) {
    // Entire block was excluded
    result.excludedRows = originalBlock.rows
    return result
  }

  // Create a set to track which merged rows have been matched
  const matchedMergedIndices = new Set<number>()

  // Try to match each original row to a merged row
  for (let origIdx = 0; origIdx < originalBlock.rows.length; origIdx++) {
    const origRow = originalBlock.rows[origIdx]
    
    // First try matching with block-relative position
    const origKeyWithPosition = createRowKey(origRow.subject, origRow.behavior, origIdx)
    let foundMatch = false

    for (let mergedIdx = 0; mergedIdx < mergedBlock.rows.length; mergedIdx++) {
      if (matchedMergedIndices.has(mergedIdx)) continue

      const mergedRow = mergedBlock.rows[mergedIdx]
      const mergedKeyWithPosition = createRowKey(mergedRow.subject, mergedRow.behavior, mergedIdx)

      if (origKeyWithPosition === mergedKeyWithPosition) {
        result.matchedRows.push({
          original: origRow,
          merged: mergedRow
        })
        matchedMergedIndices.add(mergedIdx)
        foundMatch = true
        break
      }
    }

    // If position-based match failed, fall back to subject+behavior only
    if (!foundMatch) {
      const origKeyWithoutPosition = createRowKey(origRow.subject, origRow.behavior)

      for (let mergedIdx = 0; mergedIdx < mergedBlock.rows.length; mergedIdx++) {
        if (matchedMergedIndices.has(mergedIdx)) continue

        const mergedRow = mergedBlock.rows[mergedIdx]
        const mergedKeyWithoutPosition = createRowKey(mergedRow.subject, mergedRow.behavior)

        if (origKeyWithoutPosition === mergedKeyWithoutPosition) {
          result.matchedRows.push({
            original: origRow,
            merged: mergedRow
          })
          matchedMergedIndices.add(mergedIdx)
          foundMatch = true
          break
        }
      }
    }

    if (!foundMatch) {
      result.excludedRows.push(origRow)
    }
  }

  // Any unmatched merged rows are additions
  for (let i = 0; i < mergedBlock.rows.length; i++) {
    if (!matchedMergedIndices.has(i)) {
      result.addedRows.push(mergedBlock.rows[i])
    }
  }

  return result
}

/**
 * Analyze the diff between original files and merged file
 * 
 * Architecture:
 * 1. Create blocks for all files (original + merged)
 * 2. Align original blocks to merged blocks via row provenance
 * 3. Compare rows only within aligned block pairs
 * 4. Rows in unaligned blocks are automatically excluded or added
 */
export function analyzeFileDiff(
  originalFiles: UploadedFile[],
  mergedFile: UploadedFile
): DiffAnalysis {
  // Extract date from merged file name
  const dateMatch = mergedFile.name.match(/(\d{4})\.(\d{2})\.(\d{2})/) || 
                    mergedFile.name.match(/(\d{4})-(\d{2})-(\d{2})/)
  const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : 'Unknown'
  const displayDate = dateMatch ? `${dateMatch[2]}/${dateMatch[3]}/${dateMatch[1]}` : 'Unknown'
  
  console.log("[analyzeFileDiff] Starting block-based diff analysis")
  console.log("[analyzeFileDiff] Merged file:", mergedFile.name, "with", mergedFile.rows.length, "rows")
  
  // STEP 1: Create blocks for all files
  const originalFileBlocks = originalFiles.map((file, fileIndex) =>
    createBlocksFromRows(file.rows, file.name, fileIndex)
  )

  const mergedBlocks = createBlocksFromRows(
    mergedFile.rows,
    mergedFile.name,
    -1 // merged file has no source index
  )

  console.log("[analyzeFileDiff] Created", originalFileBlocks.flat().length, "blocks from original files,", mergedBlocks.length, "blocks in merged file")

  // STEP 2: Annotate rows with block identity
  originalFileBlocks.forEach((fileBlocks, fileIndex) => {
    fileBlocks.forEach(block => {
      block.rows.forEach(row => {
        ;(row as any).blockId = block.id
        ;(row as any).sourceFileIndex = fileIndex
      })
    })
  })

  mergedBlocks.forEach(block => {
    block.rows.forEach(row => {
      ;(row as any).blockId = block.id
      ;(row as any).sourceFileIndex = -1
    })
  })

  // STEP 3: Build lineage map — which original blocks fed which merged blocks
  // Track both block identity AND row indices for contiguity checking
  // Build TWO lookup maps: one with position, one without
  const mergedRowLookupWithPos = new Map<string, { 
    row: any
    blockId: string
    blockRowIndex: number
  }[]>()

  const mergedRowLookupNoPos = new Map<string, { 
    row: any
    blockId: string
    blockRowIndex: number
  }[]>()

  mergedBlocks.forEach(block => {
    block.rows.forEach((row, blockRowIndex) => {
      // Build lookup WITH position
      const keyWithPos = createRowKey(row.subject, row.behavior, blockRowIndex)
      if (!mergedRowLookupWithPos.has(keyWithPos)) {
        mergedRowLookupWithPos.set(keyWithPos, [])
      }
      mergedRowLookupWithPos.get(keyWithPos)!.push({
        row: row as any,
        blockId: block.id,
        blockRowIndex: blockRowIndex
      })

      // Build lookup WITHOUT position
      const keyNoPos = createRowKey(row.subject, row.behavior)
      if (!mergedRowLookupNoPos.has(keyNoPos)) {
        mergedRowLookupNoPos.set(keyNoPos, [])
      }
      mergedRowLookupNoPos.get(keyNoPos)!.push({
        row: row as any,
        blockId: block.id,
        blockRowIndex: blockRowIndex
      })
    })
  })

  // Track which original blocks contributed to which merged blocks
  // Include row range (firstMatchedIdx, lastMatchedIdx) for contiguity checking
  interface BlockOriginInfo {
    blockId: string
    firstMatchedRowIdx: number
    lastMatchedRowIdx: number
    totalMatches: number
  }

  const mergedBlockOrigins = new Map<string, BlockOriginInfo[]>()

  // IMPORTANT: Compute lineage independently for each original block (no shared mutable state)
  // This ensures deterministic alignment regardless of file processing order
  originalFileBlocks.forEach((fileBlocks, fileIndex) => {
    fileBlocks.forEach(origBlock => {
      const origBlockRowIndices: number[] = []

      // For each row in this original block, find matching merged rows
      origBlock.rows.forEach((origRow, origBlockRowIndex) => {
        // Try positional match first
        const keyWithPosition = createRowKey(origRow.subject, origRow.behavior, origBlockRowIndex)
        let candidates = mergedRowLookupWithPos.get(keyWithPosition) || []
        
        // Fall back to position-less match if positional match not found
        if (candidates.length === 0) {
          const keyNoPos = createRowKey(origRow.subject, origRow.behavior)
          candidates = mergedRowLookupNoPos.get(keyNoPos) || []
        }

        // Take the first candidate (deterministic, position-based priority)
        if (candidates.length > 0) {
          const match = candidates[0]
          origBlockRowIndices.push(match.blockRowIndex)
        }
      })

      // If this original block matched any merged rows, record the lineage
      if (origBlockRowIndices.length > 0) {
        const firstIdx = Math.min(...origBlockRowIndices)
        const lastIdx = Math.max(...origBlockRowIndices)

        // Track which merged blocks this original block feeds into
        // Do this by checking all matched row indices and finding their block IDs
        const mergedBlocksContributed = new Set<string>()

        origBlock.rows.forEach((origRow, origBlockRowIndex) => {
          const keyWithPosition = createRowKey(origRow.subject, origRow.behavior, origBlockRowIndex)
          let candidates = mergedRowLookupWithPos.get(keyWithPosition) || []

          if (candidates.length === 0) {
            const keyNoPos = createRowKey(origRow.subject, origRow.behavior)
            candidates = mergedRowLookupNoPos.get(keyNoPos) || []
          }

          // Add all candidate merged blocks (don't mutate, just track)
          candidates.forEach(candidate => {
            mergedBlocksContributed.add(candidate.blockId)
          })
        })

        // Record this original block as an origin for each merged block it feeds
        mergedBlocksContributed.forEach(mergedBlockId => {
          if (!mergedBlockOrigins.has(mergedBlockId)) {
            mergedBlockOrigins.set(mergedBlockId, [])
          }
          const origins = mergedBlockOrigins.get(mergedBlockId)!
          // Avoid duplicates
          if (!origins.find(o => o.blockId === origBlock.id)) {
            origins.push({
              blockId: origBlock.id,
              firstMatchedRowIdx: firstIdx,
              lastMatchedRowIdx: lastIdx,
              totalMatches: origBlockRowIndices.length
            })
          }
        })
      }
    })
  })

  console.log("[analyzeFileDiff] Lineage tracking complete:", mergedBlockOrigins.size, "merged blocks have origins")

  // STEP 4: Build aligned block pairs (enforce one-to-one alignment where possible)
  interface AlignedBlockPair {
    originalBlocks: ReturnType<typeof createBlocksFromRows>
    mergedBlock: ReturnType<typeof createBlocksFromRows>[0]
  }

  const alignedBlocks: AlignedBlockPair[] = []
  const alignedMergedBlockIds = new Set<string>()
  const alignedOriginalBlockIds = new Set<string>()

  mergedBlocks.forEach(mergedBlock => {
    const origins = mergedBlockOrigins.get(mergedBlock.id)
    if (!origins || origins.length === 0) return

    // Enforce one-to-one alignment: pick the original block with best contiguity
    // "Best" = most rows in contiguous range in merged block, or fewest gaps
    let bestOrigin: BlockOriginInfo | null = null
    let bestScore = -1

    origins.forEach(origin => {
      // Score = number of matches (higher is better)
      // If tied, prefer the block that spans a tighter range (lower range = more contiguous)
      const range = origin.lastMatchedRowIdx - origin.firstMatchedRowIdx + 1
      const contiguityScore = origin.totalMatches / range

      if (origin.totalMatches > bestScore || 
          (origin.totalMatches === bestScore && bestOrigin && 
           contiguityScore > (bestOrigin.totalMatches / (bestOrigin.lastMatchedRowIdx - bestOrigin.firstMatchedRowIdx + 1)))) {
        bestScore = origin.totalMatches
        bestOrigin = origin
      }
    })

    if (bestOrigin === null) return

    // Find the original block object
    const originBlock = originalFileBlocks
      .flat()
      .find(b => b.id === (bestOrigin as BlockOriginInfo).blockId)

    if (!originBlock) return

    alignedBlocks.push({
      originalBlocks: [originBlock],
      mergedBlock
    })

    alignedMergedBlockIds.add(mergedBlock.id)
    alignedOriginalBlockIds.add((bestOrigin as BlockOriginInfo).blockId)
  })

  // Detect excluded and added blocks
  const excludedBlocks = originalFileBlocks
    .flat()
    .filter(b => !alignedOriginalBlockIds.has(b.id))

  const addedBlocks = mergedBlocks.filter(b => !alignedMergedBlockIds.has(b.id))

  console.log("[analyzeFileDiff] Aligned:", alignedBlocks.length, "block pairs, Excluded:", excludedBlocks.length, "original blocks, Added:", addedBlocks.length, "merged blocks")

  // STEP 5: Compare rows within aligned block pairs
  const rowDiffsByFile = new Map<number, RowDiffRecord[]>()
  const fileStats = new Map<number, { kept: number; excluded: number; timestampMods: number }>()

  // Initialize file stats
  originalFiles.forEach((file, idx) => {
    rowDiffsByFile.set(idx, [])
    fileStats.set(idx, { kept: 0, excluded: 0, timestampMods: 0 })
  })

  // Compare aligned blocks
  alignedBlocks.forEach(({ originalBlocks, mergedBlock }) => {
    originalBlocks.forEach(originalBlock => {
      const result = compareBlocks(originalBlock, mergedBlock)

      const fileIndex = originalBlock.sourceFileIndex
      const diffs = rowDiffsByFile.get(fileIndex) || []
      const stats = fileStats.get(fileIndex) || { kept: 0, excluded: 0, timestampMods: 0 }

      // Convert matched rows to RowDiffRecords
      result.matchedRows.forEach(({ original, merged }) => {
        const timestampModified = !timestampsMatch(original.timestamp, merged.timestamp)

        diffs.push({
          originalRowIndex: original.rowIndex,
          sourceFileName: originalBlock.sourceFileName,
          sourceFileIndex: fileIndex,
          subject: original.subject,
          originalTimestamp: original.timestamp,
          behavior: original.behavior,
          status: 'kept',
          mergedRowIndex: merged.rowIndex, // Will be adjusted below
          newTimestamp: timestampModified ? merged.timestamp : undefined,
          timestampModified
        })

        stats.kept++
        if (timestampModified) stats.timestampMods++
      })

      // Convert excluded rows
      result.excludedRows.forEach(row => {
        diffs.push({
          originalRowIndex: row.rowIndex,
          sourceFileName: originalBlock.sourceFileName,
          sourceFileIndex: fileIndex,
          subject: row.subject,
          originalTimestamp: row.timestamp,
          behavior: row.behavior,
          status: 'excluded',
          timestampModified: false
        })

        stats.excluded++
      })

      rowDiffsByFile.set(fileIndex, diffs)
      fileStats.set(fileIndex, stats)
    })
  })

  // Mark entire excluded blocks as excluded
  excludedBlocks.forEach(block => {
    const fileIndex = block.sourceFileIndex
    const diffs = rowDiffsByFile.get(fileIndex) || []

    block.rows.forEach(row => {
      diffs.push({
        originalRowIndex: row.rowIndex,
        sourceFileName: block.sourceFileName,
        sourceFileIndex: fileIndex,
        subject: row.subject,
        originalTimestamp: row.timestamp,
        behavior: row.behavior,
        status: 'excluded',
        timestampModified: false
      })
    })

    const stats = fileStats.get(fileIndex) || { kept: 0, excluded: 0, timestampMods: 0 }
    stats.excluded += block.rows.length
    fileStats.set(fileIndex, stats)
    rowDiffsByFile.set(fileIndex, diffs)
  })

  // Assign merged row indices (sequential for kept rows only)
  let mergedRowCounter = 1
  originalFiles.forEach((file, fileIdx) => {
    const diffs = rowDiffsByFile.get(fileIdx) || []
    diffs
      .filter(d => d.status === 'kept')
      .sort((a, b) => a.originalRowIndex - b.originalRowIndex)
      .forEach(diff => {
        diff.mergedRowIndex = mergedRowCounter++
      })
  })

  // Build file analyses
  const fileAnalyses = originalFiles.map((file, fileIndex) => {
    const diffs = rowDiffsByFile.get(fileIndex) || []
    const stats = fileStats.get(fileIndex) || { kept: 0, excluded: 0, timestampMods: 0 }

    return {
      fileIndex,
      fileName: file.name,
      totalRows: file.rows.length,
      keptRows: stats.kept,
      excludedRows: stats.excluded,
      timestampModifications: stats.timestampMods,
      rows: diffs
    }
  })

  const totalOriginalRows = fileAnalyses.reduce((sum, f) => sum + f.totalRows, 0)
  const totalKept = fileAnalyses.reduce((sum, f) => sum + f.keptRows, 0)
  const totalExcluded = fileAnalyses.reduce((sum, f) => sum + f.excludedRows, 0)
  const totalTimestampMods = fileAnalyses.reduce((sum, f) => sum + f.timestampModifications, 0)

  console.log("[analyzeFileDiff] Complete: kept=", totalKept, "excluded=", totalExcluded, "timestamp mods=", totalTimestampMods)

  return {
    date,
    displayDate,
    analyzedAt: new Date(),
    originalFiles: fileAnalyses,
    mergedFile: {
      fileName: mergedFile.name,
      totalRows: mergedFile.rows.length
    },
    totalOriginalRows,
    totalKept,
    totalExcluded,
    totalTimestampModifications: totalTimestampMods
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
