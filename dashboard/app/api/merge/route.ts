import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

interface CachedMergeData {
  standard: any[][]
  withMetadata: any[][]
  mergeMap: Array<{ fileIndex: number; rowsFromFile: number[] }>
}

interface RowWithMetadata {
  author: string
  datetime: string
  data: string
  sourceFile: string
  originalRowIndex: number
}

let cachedMergedFiles: CachedMergeData | null = null

function excelDateToJSDate(serial: number): Date {
  const utcDays = Math.floor(serial - 25569)
  const utcValue = utcDays * 86400
  const fractionalDay = serial - Math.floor(serial) + 0.0000001
  const totalSeconds = Math.floor(86400 * fractionalDay)
  return new Date((utcValue + totalSeconds) * 1000)
}

function formatIsoDate(isoDate: string | Date): string {
  const date = typeof isoDate === 'string' ? new Date(isoDate) : isoDate
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const yyyy = date.getUTCFullYear()
  const hh = date.getUTCHours()
  const min = String(date.getUTCMinutes()).padStart(2, '0')
  const sec = String(date.getUTCSeconds()).padStart(2, '0')
  return `${mm}/${dd}/${yyyy} ${hh}:${min}:${sec}`
}

function findFocalFollowSections(data: any[][]): Array<{ startIndex: number; endIndex: number }> {
  const sections: Array<{ startIndex: number; endIndex: number }> = []
  
  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    if (row[2] && String(row[2]).startsWith('F:')) {
      // Found focal follow start
      for (let j = i + 1; j < data.length; j++) {
        if (data[j][2] && String(data[j][2]).toLowerCase().startsWith('end')) {
          sections.push({ startIndex: i, endIndex: j })
          i = j
          break
        }
      }
    }
  }
  
  return sections
}

function extractComments(data: RowWithMetadata[]): RowWithMetadata[] {
  return data.filter(row => row.data.startsWith('C:'))
}

function removeRowsByIndices(data: RowWithMetadata[], indices: Set<number>): RowWithMetadata[] {
  return data.filter((_, idx) => !indices.has(idx))
}

function findLostFocal(data: RowWithMetadata[]): Set<number> {
  const lostIndices = new Set<number>()
  for (let i = 0; i < data.length; i++) {
    if (String(data[i].data).toLowerCase().includes('lost focal')) {
      lostIndices.add(i)
    }
  }
  return lostIndices
}

function sortByDateTime(data: RowWithMetadata[]): RowWithMetadata[] {
  return [...data].sort((a, b) => {
    try {
      const dateA = new Date(a.datetime)
      const dateB = new Date(b.datetime)
      return dateA.getTime() - dateB.getTime()
    } catch {
      return 0
    }
  })
}

function parseExcelFile(buffer: Buffer): any[][] {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  return XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][]
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const files = formData.getAll('files') as File[]

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }

    // Parse all files and format data, tracking source file and original row
    interface RowWithMetadata {
      author: string
      datetime: string
      data: string
      sourceFile: string
      originalRowIndex: number
    }

    let allData: RowWithMetadata[] = []
    const mergeMap: Array<{ fileIndex: number; rowsFromFile: number[] }> = files.map((_, idx) => ({
      fileIndex: idx,
      rowsFromFile: []
    }))

    let mergeCounter = 0

    for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
      const file = files[fileIdx]
      const buffer = await file.arrayBuffer()
      const rows = parseExcelFile(Buffer.from(buffer))

      // Format rows (convert Excel dates to readable format)
      const formattedRows = rows.slice(1).map((row, idx) => {
        const date = typeof row[1] === 'number' 
          ? formatIsoDate(excelDateToJSDate(row[1]))
          : String(row[1] || '')
        return {
          author: String(row[0] || ''),
          datetime: date,
          data: String(row[2] || ''),
          sourceFile: file.name,
          originalRowIndex: idx + 1 // +1 because header is row 0
        }
      })

      // Add to combined data and track merge order
      for (let rowIdx = 0; rowIdx < formattedRows.length; rowIdx++) {
        allData.push(formattedRows[rowIdx])
        mergeMap[fileIdx].rowsFromFile.push(mergeCounter)
        mergeCounter++
      }
    }

    // Apply focal follow merging logic
    const focalSections = findFocalFollowSections(allData.map(r => [r.author, r.datetime, r.data]))
    const commentsIndices = new Set<number>()
    const lostFocalIndices = new Set<number>()

    // Find comment and lost focal rows
    for (let i = 0; i < allData.length; i++) {
      const row = allData[i]
      if (row.data.startsWith('C:')) {
        commentsIndices.add(i)
      } else if (row.data.toLowerCase().includes('lost focal')) {
        lostFocalIndices.add(i)
      }
    }

    // Remove lost focal entries
    const filteredData = allData.filter((_, idx) => !lostFocalIndices.has(idx))

    // Recalculate merge map after removing lost focal entries
    const newMergeMap: Array<{ fileIndex: number; rowsFromFile: number[] }> = files.map((_, idx) => ({
      fileIndex: idx,
      rowsFromFile: []
    }))

    let newMergeCounter = 0
    for (let i = 0; i < filteredData.length; i++) {
      const row = filteredData[i]
      // Find which file this row came from
      for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
        if (row.sourceFile === files[fileIdx].name) {
          newMergeMap[fileIdx].rowsFromFile.push(newMergeCounter)
          break
        }
      }
      newMergeCounter++
    }

    // Sort by datetime
    filteredData.sort((a, b) => {
      try {
        const dateA = new Date(a.datetime)
        const dateB = new Date(b.datetime)
        return dateA.getTime() - dateB.getTime()
      } catch {
        return 0
      }
    })

    // Create standard and metadata versions
    const mergedStandard = filteredData.map(row => [row.author, row.datetime, row.data])
    const mergedWithMetadata = filteredData.map(row => [row.author, row.datetime, row.data, row.sourceFile, row.originalRowIndex])

    // Add headers
    const standardWithHeader = [['Author', 'DateTime', 'Data'], ...mergedStandard]
    const metadataWithHeader = [
      ['Author', 'DateTime', 'Data', 'Source File', 'Original Row #'],
      ...mergedWithMetadata
    ]

    // Cache results
    cachedMergedFiles = {
      standard: standardWithHeader,
      withMetadata: metadataWithHeader,
      mergeMap: newMergeMap
    }

    return NextResponse.json({
      standard: 'merged_file.xls',
      withMetadata: 'merged_file_with_metadata.xls',
      stats: {
        totalFiles: files.length,
        totalRows: mergedStandard.length
      },
      mergeMap: newMergeMap
    })
  } catch (error) {
    console.error('Merge error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to merge files' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const version = request.nextUrl.searchParams.get('version') as 'standard' | 'withMetadata'

    if (!version || !cachedMergedFiles) {
      return NextResponse.json({ error: 'No merged file available' }, { status: 400 })
    }

    const data = cachedMergedFiles[version]
    const fileName = version === 'standard' ? 'merged_file.xls' : 'merged_file_with_metadata.xls'

    // Create workbook
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet(data)
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1')

    // Write to buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xls' })

    // Return as file download
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.ms-excel',
        'Content-Disposition': `attachment; filename="${fileName}"`
      }
    })
  } catch (error) {
    console.error('Download error:', error)
    return NextResponse.json(
      { error: 'Failed to download file' },
      { status: 500 }
    )
  }
}
