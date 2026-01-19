import type { YearFolder, MonthFolder, DayFolder, ExcelFile, DataRow, FilterRule, TimeBlock, DayMergeLog, RowMergeRecord, ExcludedRowsExport } from './types'
import { FILE_1_BLOCKS, FILE_2_BLOCKS, getTimeBlockLabel, TIME_BLOCKS } from './types'

// Realistic behavior codes based on your example
const BEHAVIOR_CODES = [
  'KAW', 'W/MUD ALD', 'FF PROTOCOL ALD22', 'C HAVE MONOS', 'CL P1',
  'GRM', 'FRG', 'RST', 'TRV', 'SOC', 'PLY', 'AGG', 'VCL', 'SLP',
  'FD FRUIT', 'FD LEAF', 'FD INSECT', 'SCAN', 'GROOM SELF', 'GROOM OTHER',
  'REST ALONE', 'REST GROUP', 'TRAVEL FAST', 'TRAVEL SLOW', 'FORAGE HIGH',
  'FORAGE LOW', 'SOCIAL PLAY', 'SOCIAL GROOM', 'ALERT', 'FLEE', 'CHASE'
]

// Subject/Observer combos based on your example format
const SUBJECTS = [
  'KAW W/MUD ALD', 'MUD W/KAW ALD', 'ALD W/KAW MUD', 'KAW SOLO ALD',
  'BLU W/RED ALD', 'RED W/BLU ALD', 'GRN W/YLW ALD', 'YLW W/GRN ALD',
  'ORG W/PNK ALD', 'PNK W/ORG ALD', 'WHT W/BLK ALD', 'BLK W/WHT ALD',
  'JNR W/SNR ALD', 'SNR W/JNR ALD', 'MAL W/FEM ALD', 'FEM W/MAL ALD'
]

function generateId(): string {
  return Math.random().toString(36).substring(2, 11)
}

function generateExcelFile(dayPath: string, dayDate: string, fileNumber: 1 | 2): ExcelFile {
  // File 1: 6-8am, 10am-12pm, 2-4pm
  // File 2: 8-10am, 12-2pm, 4-6pm
  const timeBlocks: TimeBlock[] = fileNumber === 1 
    ? FILE_1_BLOCKS.map(b => ({ ...b }))
    : FILE_2_BLOCKS.map(b => ({ ...b }))
  
  // Each file has ~150-300 observations across its 3 time blocks
  const rowCount = Math.floor(Math.random() * 150) + 150
  
  return {
    id: generateId(),
    name: `behavior_${dayDate.replace(/-/g, '')}_file${fileNumber}.xlsx`,
    path: `${dayPath}/behavior_${dayDate.replace(/-/g, '')}_file${fileNumber}.xlsx`,
    dateModified: new Date(),
    size: Math.floor(Math.random() * 300000) + 50000,
    rowCount,
    columns: ['subject', 'timestamp', 'behavior'],
    timeBlocks,
    fileNumber
  }
}

function generateDayFolder(year: number, month: number, day: number): DayFolder {
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const displayDate = `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`
  const path = `/data/${year}/${String(month).padStart(2, '0')}/${dateStr}`
  
  // Always exactly 2 files per day with interleaved time blocks
  const files: ExcelFile[] = [
    generateExcelFile(path, dateStr, 1),
    generateExcelFile(path, dateStr, 2)
  ]
  
  return {
    date: dateStr,
    displayDate,
    path,
    files,
    totalRows: files.reduce((sum, f) => sum + f.rowCount, 0)
  }
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

function generateMonthFolder(year: number, month: number): MonthFolder {
  const daysInMonth = getDaysInMonth(year, month)
  const path = `/data/${year}/${String(month).padStart(2, '0')}`
  
  const days: DayFolder[] = []
  for (let day = 1; day <= daysInMonth; day++) {
    // Simulate some days without data (bad weather, weekends, etc.)
    if (Math.random() > 0.1) {
      days.push(generateDayFolder(year, month, day))
    }
  }
  
  return {
    year,
    month,
    name: `${MONTH_NAMES[month - 1]} ${year}`,
    path,
    days,
    totalFiles: days.reduce((sum, d) => sum + d.files.length, 0),
    totalRows: days.reduce((sum, d) => sum + d.totalRows, 0)
  }
}

export function generateYearData(year: number): YearFolder {
  const months: MonthFolder[] = []
  
  for (let month = 1; month <= 12; month++) {
    months.push(generateMonthFolder(year, month))
  }
  
  return {
    year,
    path: `/data/${year}`,
    months,
    totalFiles: months.reduce((sum, m) => sum + m.totalFiles, 0),
    totalRows: months.reduce((sum, m) => sum + m.totalRows, 0)
  }
}

// Generate mock row data matching the actual format:
// KAW W/MUD ALD	08/12/2023 5:11:53	KAW
export function generateMockRows(files: ExcelFile[], dayDate: string): DataRow[] {
  const rows: DataRow[] = []
  const displayDate = dayDate.split('-').slice(1).concat(dayDate.split('-')[0]).join('/')
  
  files.forEach((file, fileIndex) => {
    // Pick ONE consistent subject/observer for this entire file (all its time blocks)
    const fileSubject = SUBJECTS[fileIndex % SUBJECTS.length]
    
    // Distribute rows across the file's time blocks
    const rowsPerBlock = Math.floor(file.rowCount / file.timeBlocks.length)
    let rowCounter = 0
    
    file.timeBlocks.forEach((block) => {
      const [startHour] = block.start.split(':').map(Number)
      const [endHour] = block.end.split(':').map(Number)
      const adjustedEndHour = endHour === 0 ? 24 : endHour
      
      // Generate rows for this time block
      const blockRowCount = rowsPerBlock + (Math.random() > 0.5 ? Math.floor(Math.random() * 20) : 0)
      
      for (let i = 0; i < blockRowCount; i++) {
        // Generate time within the 2-hour block
        const hourOffset = Math.random() * (adjustedEndHour - startHour)
        const hour = Math.floor(startHour + hourOffset)
        const minute = Math.floor(Math.random() * 60)
        const second = Math.floor(Math.random() * 60)
        
        const timeStr = `${hour}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
        const fullTimestamp = `${displayDate} ${timeStr}`
        
        const rowId = `${file.id}-${rowCounter}`
        rows.push({
          subject: fileSubject, // Consistent subject for entire file
          timestamp: fullTimestamp,
          date: displayDate,
          time: timeStr,
          behavior: BEHAVIOR_CODES[Math.floor(Math.random() * BEHAVIOR_CODES.length)],
          _sourceFileId: file.id,
          _sourceFileName: file.name,
          _sourceFileIndex: fileIndex,
          _originalRowIndex: rowCounter++,
          _timeRange: getTimeBlockLabel(block.start, block.end),
          _excluded: false,
          _rowId: rowId
        })
      }
    })
  })
  
  // Sort by timestamp (time portion)
  return rows.sort((a, b) => {
    const timeA = a.time.split(':').map(Number)
    const timeB = b.time.split(':').map(Number)
    
    for (let i = 0; i < 3; i++) {
      if (timeA[i] !== timeB[i]) return timeA[i] - timeB[i]
    }
    return 0
  })
}

// Apply filter rules to data
export function applyFilterRules(rows: DataRow[], rules: FilterRule[]): DataRow[] {
  const enabledRules = rules.filter(r => r.enabled)
  if (enabledRules.length === 0) return rows
  
  return rows.filter(row => {
    return enabledRules.every(rule => {
      const value = row[rule.column as keyof DataRow]
      const ruleValue = rule.value
      
      switch (rule.operator) {
        case 'equals':
          return value === ruleValue
        case 'not_equals':
          return value !== ruleValue
        case 'contains':
          return String(value).toLowerCase().includes(String(ruleValue).toLowerCase())
        case 'not_contains':
          return !String(value).toLowerCase().includes(String(ruleValue).toLowerCase())
        case 'greater_than':
          return Number(value) > Number(ruleValue)
        case 'less_than':
          return Number(value) < Number(ruleValue)
        case 'between':
          if (Array.isArray(ruleValue)) {
            return Number(value) >= ruleValue[0] && Number(value) <= ruleValue[1]
          }
          return true
        case 'is_empty':
          return value === null || value === undefined || value === ''
        case 'is_not_empty':
          return value !== null && value !== undefined && value !== ''
        case 'starts_with':
          return String(value).toLowerCase().startsWith(String(ruleValue).toLowerCase())
        case 'ends_with':
          return String(value).toLowerCase().endsWith(String(ruleValue).toLowerCase())
        case 'regex':
          try {
            return new RegExp(String(ruleValue)).test(String(value))
          } catch {
            return true
          }
        case 'time_after': {
          const rowTime = String(row.time)
          return rowTime >= String(ruleValue)
        }
        case 'time_before': {
          const rowTime = String(row.time)
          return rowTime <= String(ruleValue)
        }
        default:
          return true
      }
    })
  })
}

// Get unique behavior codes from data
export function getUniqueBehaviors(rows: DataRow[]): string[] {
  const behaviors = new Set(rows.map(r => r.behavior))
  return Array.from(behaviors).sort()
}

// Get unique subjects from data
export function getUniqueSubjects(rows: DataRow[]): string[] {
  const subjects = new Set(rows.map(r => r.subject))
  return Array.from(subjects).sort()
}

// Generate mock merge log tracking every row's merge status
export function generateMockMergeLog(files: ExcelFile[], rows: DataRow[], dayDate: string): DayMergeLog {
  const displayDate = dayDate.split('-').slice(1).join('/') + '/' + dayDate.split('-')[0]
  
  const fileEntries: DayMergeLog['files'] = files.map((file, fileIndex) => {
    // Get all rows for this file
    const fileRows = rows.filter(r => r._sourceFileIndex === fileIndex)
    
    // Create row-level records
    const rowRecords: RowMergeRecord[] = fileRows.map(row => {
      // Simulate: ~90% kept, ~10% excluded (random small gaps)
      // Exclude rows randomly, but cluster exclusions to simulate gaps
      const isExcluded = row._excluded
      
      // Occasionally modify timestamp (about 5% of kept rows)
      const hasTimestampMod = !isExcluded && Math.random() < 0.05
      let newTimestamp: string | undefined
      
      if (hasTimestampMod) {
        // Simulate a clock sync adjustment (shift by a few minutes)
        const timeParts = row.time.split(':').map(Number)
        const minuteOffset = Math.floor(Math.random() * 10) - 5
        const newMin = Math.max(0, Math.min(59, timeParts[1] + minuteOffset))
        newTimestamp = `${row.date} ${timeParts[0]}:${String(newMin).padStart(2, '0')}:${String(timeParts[2]).padStart(2, '0')}`
      }
      
      return {
        rowIndex: row._originalRowIndex,
        rowId: row._rowId,
        action: isExcluded ? 'excluded' : 'kept',
        fileIndex,
        fileName: row._sourceFileName,
        timeBlock: row._timeRange,
        subject: row.subject,
        originalTimestamp: row.timestamp,
        newTimestamp,
        behavior: row.behavior
      } as RowMergeRecord
    })
    
    const keptRows = rowRecords.filter(r => r.action === 'kept').length
    const excludedRows = rowRecords.filter(r => r.action === 'excluded').length
    const timestampMods = rowRecords.filter(r => r.newTimestamp).length
    
    return {
      fileIndex,
      fileName: file.name,
      totalRows: fileRows.length,
      keptRows,
      excludedRows,
      timestampModifications: timestampMods,
      rows: rowRecords
    }
  })
  
  return {
    date: dayDate,
    displayDate,
    mergedAt: new Date(),
    files: fileEntries,
    totalKept: fileEntries.reduce((sum, f) => sum + f.keptRows, 0),
    totalExcluded: fileEntries.reduce((sum, f) => sum + f.excludedRows, 0),
    totalTimestampModifications: fileEntries.reduce((sum, f) => sum + f.timestampModifications, 0)
  }
}

// Generate excluded rows export for reverse merge capability
export function generateExcludedRowsExport(mergeLog: DayMergeLog): ExcludedRowsExport {
  return {
    date: mergeLog.date,
    displayDate: mergeLog.displayDate,
    exportedAt: new Date(),
    files: mergeLog.files.map(file => ({
      fileIndex: file.fileIndex,
      fileName: file.fileName,
      excludedRows: file.rows
        .filter(r => r.action === 'excluded')
        .map(r => ({
          rowIndex: r.rowIndex,
          subject: r.subject,
          timestamp: r.originalTimestamp,
          behavior: r.behavior,
          timeBlock: r.timeBlock
        }))
    })),
    totalExcluded: mergeLog.totalExcluded
  }
}

// Export merge log as JSON
export function exportMergeLogAsJSON(mergeLog: DayMergeLog): string {
  return JSON.stringify(mergeLog, null, 2)
}

// Export merge log as CSV
export function exportMergeLogAsCSV(mergeLog: DayMergeLog): string {
  const headers = ['File Index', 'File Name', 'Row Index', 'Action', 'Time Block', 'Subject', 'Original Timestamp', 'New Timestamp', 'Behavior']
  const rows: string[][] = []
  
  mergeLog.files.forEach(file => {
    file.rows.forEach(row => {
      rows.push([
        String(row.fileIndex),
        row.fileName,
        String(row.rowIndex),
        row.action,
        row.timeBlock,
        row.subject,
        row.originalTimestamp,
        row.newTimestamp || '',
        row.behavior
      ])
    })
  })
  
  return [headers.join(','), ...rows.map(r => r.map(cell => `"${cell}"`).join(','))].join('\n')
}

// Export excluded rows as CSV
export function exportExcludedRowsAsCSV(excludedExport: ExcludedRowsExport): string {
  const headers = ['File Index', 'File Name', 'Row Index', 'Subject', 'Timestamp', 'Behavior', 'Time Block']
  const rows: string[][] = []
  
  excludedExport.files.forEach(file => {
    file.excludedRows.forEach(row => {
      rows.push([
        String(file.fileIndex),
        file.fileName,
        String(row.rowIndex),
        row.subject,
        row.timestamp,
        row.behavior,
        row.timeBlock
      ])
    })
  })
  
  return [headers.join(','), ...rows.map(r => r.map(cell => `"${cell}"`).join(','))].join('\n')
}

// Reverse merge: reconstruct original file data from merged data + excluded rows
export function reconstructOriginalFile(
  mergedRows: DataRow[], 
  excludedExport: ExcludedRowsExport, 
  fileIndex: number
): { subject: string; timestamp: string; behavior: string }[] {
  // Get kept rows for this file
  const keptRows = mergedRows
    .filter(r => r._sourceFileIndex === fileIndex && !r._excluded)
    .map(r => ({
      rowIndex: r._originalRowIndex,
      subject: r.subject,
      timestamp: r.timestamp,
      behavior: r.behavior
    }))
  
  // Get excluded rows for this file
  const fileExcluded = excludedExport.files.find(f => f.fileIndex === fileIndex)
  const excludedRows = fileExcluded?.excludedRows.map(r => ({
    rowIndex: r.rowIndex,
    subject: r.subject,
    timestamp: r.timestamp,
    behavior: r.behavior
  })) || []
  
  // Combine and sort by original row index
  const allRows = [...keptRows, ...excludedRows].sort((a, b) => a.rowIndex - b.rowIndex)
  
  // Return just the data columns (without row index)
  return allRows.map(r => ({
    subject: r.subject,
    timestamp: r.timestamp,
    behavior: r.behavior
  }))
}
