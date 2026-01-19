export interface TimeBlock {
  start: string // e.g., "06:00"
  end: string   // e.g., "08:00"
  label: string // e.g., "6AM - 8AM"
}

export interface ExcelFile {
  id: string
  name: string
  path: string
  dateModified: Date
  size: number
  rowCount: number
  columns: string[]
  // Each file contains multiple 2-hour blocks (interleaved pattern)
  timeBlocks: TimeBlock[]
  fileNumber: 1 | 2 // File 1 or File 2
}

export interface DayFolder {
  date: string // YYYY-MM-DD format
  displayDate: string // e.g., "08/12/2023"
  path: string
  files: ExcelFile[]
  totalRows: number
}

export interface MonthFolder {
  year: number
  month: number // 1-12
  name: string // e.g., "August 2023"
  path: string
  days: DayFolder[]
  totalFiles: number
  totalRows: number
}

export interface YearFolder {
  year: number
  path: string
  months: MonthFolder[]
  totalFiles: number
  totalRows: number
}

// Filter rule types
export type RuleOperator = 
  | 'equals' 
  | 'not_equals' 
  | 'contains' 
  | 'not_contains' 
  | 'greater_than' 
  | 'less_than' 
  | 'between' 
  | 'is_empty' 
  | 'is_not_empty'
  | 'starts_with'
  | 'ends_with'
  | 'regex'
  | 'time_after'
  | 'time_before'

export interface FilterRule {
  id: string
  name: string
  column: string
  operator: RuleOperator
  value: string | number | [number, number] | [string, string]
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export interface RuleGroup {
  id: string
  name: string
  rules: FilterRule[]
  logic: 'AND' | 'OR'
  enabled: boolean
}

// Data row matching the actual Excel format
// Column 1: Subject/Observer (e.g., "KAW W/MUD ALD")
// Column 2: Timestamp (e.g., "08/12/2023 5:11:53")
// Column 3: Behavior code (e.g., "KAW", "W/MUD ALD", "FF PROTOCOL ALD22")
export interface DataRow {
  subject: string          // Column 1: Subject/Observer info
  timestamp: string        // Column 2: Full timestamp (date + time)
  date: string            // Extracted date portion
  time: string            // Extracted time portion
  behavior: string        // Column 3: Behavior/Event code
  _sourceFileId: string
  _sourceFileName: string
  _sourceFileIndex: number
  _originalRowIndex: number
  _timeRange: string      // The 2-hour block this row belongs to
  _excluded: boolean      // Whether this row is excluded from the merged output
  _rowId: string          // Unique ID for this row
}

// Block types for grouping consecutive rows by subject and time proximity
export interface DataBlock {
  id: string
  subject: string
  startTimestamp: string  // First row's timestamp
  endTimestamp: string    // Last row's timestamp
  rows: DataRow[]
  sourceFileName: string
  sourceFileIndex: number
}

export interface BlockComparison {
  originalBlock: DataBlock
  mergedBlock: DataBlock | null
  matchedRows: { original: DataRow; merged: DataRow }[]
  excludedRows: DataRow[]
  addedRows: DataRow[]
  rowCountDifference: number
}

// Uploaded file representation (raw Excel data)
export interface UploadedFile {
  id: string
  name: string
  uploadedAt: Date
  rows: {
    rowIndex: number
    subject: string      // Column 1
    timestamp: string    // Column 2
    behavior: string     // Column 3
  }[]
}

// Row-level diff record showing what happened to each original row
export interface RowDiffRecord {
  originalRowIndex: number
  sourceFileName: string
  sourceFileIndex: number
  subject: string
  originalTimestamp: string
  behavior: string
  // Diff result
  status: 'kept' | 'excluded'
  // If kept, where does it appear in merged file?
  mergedRowIndex?: number
  // If timestamp was modified, what's the new value?
  newTimestamp?: string
  timestampModified: boolean
}

// Full diff analysis for a day
export interface DiffAnalysis {
  date: string
  displayDate: string
  analyzedAt: Date
  originalFiles: {
    fileIndex: number
    fileName: string
    totalRows: number
    keptRows: number
    excludedRows: number
    timestampModifications: number
    rows: RowDiffRecord[]
  }[]
  mergedFile: {
    fileName: string
    totalRows: number
  }
  totalOriginalRows: number
  totalKept: number
  totalExcluded: number
  totalTimestampModifications: number
}

// For reverse merge / export
export interface ExcludedRowsExport {
  date: string
  displayDate: string
  exportedAt: Date
  files: {
    fileIndex: number
    fileName: string
    excludedRows: {
      rowIndex: number
      subject: string
      timestamp: string
      behavior: string
    }[]
  }[]
  totalExcluded: number
}

// Merged dataset
export interface MergedDataset {
  id: string
  name: string
  createdAt: Date
  sourceDate: string // Date or date range
  files: ExcelFile[]
  rows: DataRow[]
  appliedRules: FilterRule[]
  totalOriginalRows: number
  totalFilteredRows: number
}

// Selection state
export interface SelectionState {
  level: 'year' | 'month' | 'day'
  year?: number
  month?: number
  day?: string
  selectedFiles: string[]
}

// Rainbow colors for file segments (12 colors for up to 12 2-hour blocks per day)
export const RAINBOW_COLORS = [
  { name: 'Red', class: 'bg-rainbow-1', hex: '#ef4444' },
  { name: 'Orange', class: 'bg-rainbow-2', hex: '#f97316' },
  { name: 'Amber', class: 'bg-rainbow-3', hex: '#f59e0b' },
  { name: 'Yellow', class: 'bg-rainbow-4', hex: '#eab308' },
  { name: 'Lime', class: 'bg-rainbow-5', hex: '#84cc16' },
  { name: 'Green', class: 'bg-rainbow-6', hex: '#22c55e' },
  { name: 'Emerald', class: 'bg-rainbow-7', hex: '#10b981' },
  { name: 'Cyan', class: 'bg-rainbow-8', hex: '#06b6d4' },
  { name: 'Sky', class: 'bg-rainbow-9', hex: '#0ea5e9' },
  { name: 'Blue', class: 'bg-rainbow-10', hex: '#3b82f6' },
  { name: 'Indigo', class: 'bg-rainbow-11', hex: '#6366f1' },
  { name: 'Purple', class: 'bg-rainbow-12', hex: '#a855f7' },
] as const

export function getRainbowColor(index: number): typeof RAINBOW_COLORS[number] {
  return RAINBOW_COLORS[index % RAINBOW_COLORS.length]
}

// Time block labels for 2-hour chunks (6am to 6pm observation window)
export const TIME_BLOCKS = [
  { start: '06:00', end: '08:00', label: '6AM - 8AM' },
  { start: '08:00', end: '10:00', label: '8AM - 10AM' },
  { start: '10:00', end: '12:00', label: '10AM - 12PM' },
  { start: '12:00', end: '14:00', label: '12PM - 2PM' },
  { start: '14:00', end: '16:00', label: '2PM - 4PM' },
  { start: '16:00', end: '18:00', label: '4PM - 6PM' },
] as const

// File 1 covers: 6-8am, 10am-12pm, 2-4pm (blocks 0, 2, 4)
// File 2 covers: 8-10am, 12-2pm, 4-6pm (blocks 1, 3, 5)
export const FILE_1_BLOCKS = [TIME_BLOCKS[0], TIME_BLOCKS[2], TIME_BLOCKS[4]] as const
export const FILE_2_BLOCKS = [TIME_BLOCKS[1], TIME_BLOCKS[3], TIME_BLOCKS[5]] as const

export function getTimeBlockLabel(start: string, end: string): string {
  const block = TIME_BLOCKS.find(b => b.start === start && b.end === end)
  return block?.label || `${start} - ${end}`
}

// Get color for a specific time block by its label (e.g., "6AM - 8AM")
export function getTimeBlockColor(timeRangeLabel: string): typeof RAINBOW_COLORS[number] {
  const index = TIME_BLOCKS.findIndex(b => b.label === timeRangeLabel)
  return RAINBOW_COLORS[index >= 0 ? index : 0]
}

// Utility function to format dates
export function formatDate(date: string | Date): string {
  const d = new Date(date)
  return d.toLocaleDateString('en-US', { 
    weekday: 'short', 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  })
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// Parse timestamp from format "MM/DD/YYYY H:MM:SS" to extract date and time
export function parseTimestamp(timestamp: string): { date: string; time: string } {
  const parts = timestamp.split(' ')
  return {
    date: parts[0] || '',
    time: parts[1] || ''
  }
}

// Format time for display (convert 24h to 12h format)
export function formatTime(time: string): string {
  const [hours, minutes, seconds] = time.split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 || 12
  return `${displayHours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} ${period}`
}
