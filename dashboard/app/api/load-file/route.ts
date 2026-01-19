import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { extname } from 'path'
import * as XLSX from 'xlsx'

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

export async function POST(request: NextRequest) {
  try {
    const { filePath } = await request.json()

    if (!filePath || typeof filePath !== 'string') {
      return NextResponse.json(
        { error: 'Invalid file path' },
        { status: 400 }
      )
    }

    // Security: Only allow files from the expected directories
    const allowedPaths = [
      'C:\\Users\\austi\\Documents\\sideProjects\\Alexa-D\\dashboard\\Merge Queue',
      'C:\\Users\\austi\\Documents\\sideProjects\\Alexa-D\\dashboard\\Merged Files'
    ]

    const isAllowed = allowedPaths.some(allowed => filePath.startsWith(allowed))
    if (!isAllowed) {
      return NextResponse.json(
        { error: 'Access denied to this file path' },
        { status: 403 }
      )
    }

    // Read the file
    const fileBuffer = readFileSync(filePath)
    
    // Parse Excel file
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' })
    const worksheet = workbook.Sheets[workbook.SheetNames[0]]
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][]

    // Convert to expected format - matching parseExcelFile logic
    const rows = jsonData.map((row: unknown[], index: number) => ({
      rowIndex: index + 1, // 1-indexed
      subject: String(row?.[0] || ''),
      timestamp: formatTimestamp(row?.[1]),
      behavior: String(row?.[2] || '')
    })).filter(row => row.subject || row.timestamp || row.behavior) // Filter empty rows

    const result = {
      id: `file-${Date.now()}`,
      name: filePath.split('\\').pop() || filePath,
      uploadedAt: new Date(),
      rows
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error loading file:', error)
    return NextResponse.json(
      { error: 'Failed to load file' },
      { status: 500 }
    )
  }
}
