import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import {
  checkConsecutiveNoSecondTimestamps,
  checkPointSampleIntervals,
  checkFandENDLineBalance,
} from "@/lib/validators"

type Partition = {
  startIndex: number
  endIndex: number
  startDateTime: string
  endDateTime: string
  sourceFile: string
  dateKey: string
}

type CommentRow = {
  index: number
  sourceFile: string
  datetime: string
  author: string
  data: string
  dateKey: string
}

type Row = {
  author: string
  datetime: string
  data: string
  sourceFile: string
  originalRowIndex: number
  dateKey: string
}

type MergedRow = {
  author: string
  datetime: string
  data: string
  sourceFile: string
  originalRowNumber: number // 1-based data row index for frontend matching
}

function excelDateToJSDate(serial: number): Date {
  const utcDays = Math.floor(serial - 25569)
  const utcValue = utcDays * 86400
  const fractionalDay = serial - Math.floor(serial) + 0.0000001
  const totalSeconds = Math.floor(86400 * fractionalDay)
  return new Date((utcValue + totalSeconds) * 1000)
}

function formatIsoDate(isoDate: string | Date): string {
  const date = typeof isoDate === "string" ? new Date(isoDate) : isoDate
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(date.getUTCDate()).padStart(2, "0")
  const yyyy = date.getUTCFullYear()
  const hh = date.getUTCHours()
  const min = String(date.getUTCMinutes()).padStart(2, "0")
  const sec = String(date.getUTCSeconds()).padStart(2, "0")
  return `${mm}/${dd}/${yyyy} ${hh}:${min}:${sec}`
}

function parseExcelFile(buffer: Buffer): any[][] {
  const workbook = XLSX.read(buffer, { type: "buffer" })
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  return XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null }) as any[][]
}

function extractDateKey(fileName: string): string | null {
  const match = fileName.match(/^(\d{4}\.\d{2}\.\d{2})/)
  return match ? match[1] : null
}

/** Mirrors readXlsToJson(): row[0]=author, row[1]=excel serial, row[2]=data */
function sheetToRows(sheet: any[][], sourceFile: string): Row[] {
  return sheet.map((row, idx) => {
    const author = String(row?.[0] ?? "")
    const rawDate = row?.[1]
    const datetime =
      typeof rawDate === "number" ? formatIsoDate(excelDateToJSDate(rawDate)) : String(rawDate ?? "")
    const data = String(row?.[2] ?? "")
    const dateKey = extractDateKey(sourceFile) ?? "unknown"
    return {
      author,
      datetime,
      data,
      sourceFile,
      originalRowIndex: idx,
      dateKey,
    }
  })
}

/** === Partition logic copied from readExcel.js semantics === */

function helper_findPartitions_from_F_to_END(rows: Row[]): Array<{ startIndex: number; endIndex: number }> {
  const starts = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.data && r.data.startsWith("F:"))
  const ends = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.data && String(r.data).toLowerCase().startsWith("end"))

  let prev_end: number | null = null
  const partitions: Array<{ startIndex: number; endIndex: number }> = []

  let endPtr = 0
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]
    if (prev_end !== null && start.i < prev_end) continue

    while (endPtr < ends.length) {
      const end = ends[endPtr]
      if (end.i < start.i) {
        endPtr++
        continue
      }

      partitions.push({ startIndex: start.i, endIndex: end.i })
      prev_end = end.i
      endPtr++
      break
    }
  }
  return partitions
}

function helper_comments_afterStartAndBeforeFirstPartition(
  focal: Array<{ startIndex: number; endIndex: number }>,
  rows: Row[],
  sourceFile: string
): CommentRow[] {
  if (focal.length === 0) return []
  const first = focal[0]
  const newStartIndex = 5
  const newEndIndex = first.startIndex - 1
  return rows
    .slice(newStartIndex, newEndIndex)
    .map((r, offset) => ({
      index: newStartIndex + offset,
      sourceFile,
      datetime: r.datetime,
      author: r.author,
      data: r.data,
      dateKey: r.dateKey,
    }))
    .filter((c) => c.data?.startsWith("C")) // NOTE: matches readExcel.js (startsWith("C"), not "C:")
}

function helper_getCommentsAfterEnd_partitions(
  focal: Array<{ startIndex: number; endIndex: number }>,
  rows: Row[],
  sourceFile: string
): CommentRow[] {
  if (focal.length === 0) {
    return rows
      .map((r, idx) =>
        r.data?.startsWith("C")
          ? { index: idx, sourceFile, datetime: r.datetime, author: r.author, data: r.data, dateKey: r.dateKey }
          : null
      )
      .filter((x): x is CommentRow => x !== null)
  }

  const lastEnd = focal[focal.length - 1].endIndex + 1
  if (rows.length <= lastEnd) return []

  const out: CommentRow[] = []
  for (let i = lastEnd; i < rows.length; i++) {
    const r = rows[i]
    if (!r || !r.data) continue
    if (r.data.startsWith("C")) {
      out.push({ index: i, sourceFile, datetime: r.datetime, author: r.author, data: r.data, dateKey: r.dateKey })
    }
  }
  return out
}

function helper_findGaps(focal: Array<{ startIndex: number; endIndex: number }>) {
  const gaps: Array<{ previousPartitionEndIndex: number; nextPartitionStartIndex: number }> = []
  for (let i = 0; i < focal.length - 1; i++) {
    const currentEnd = focal[i].endIndex
    const nextStart = focal[i + 1].startIndex
    if (nextStart > currentEnd + 1) {
      gaps.push({ previousPartitionEndIndex: currentEnd, nextPartitionStartIndex: nextStart })
    }
  }
  return gaps
}

function helper_findGapComments(
  focal: Array<{ startIndex: number; endIndex: number }>,
  rows: Row[],
  sourceFile: string
): { gapPartitions: CommentRow[]; notIncluded: CommentRow[] } {
  const gaps = helper_findGaps(focal)
  const gapPartitions: CommentRow[] = []
  const notIncluded: CommentRow[] = []

  gaps.forEach((gap) => {
    const slice = rows.slice(gap.previousPartitionEndIndex + 1, gap.nextPartitionStartIndex)
    for (let i = 0; i < slice.length; i++) {
      const actualIndex = gap.previousPartitionEndIndex + 1 + i
      const r = slice[i]
      const entry = {
        index: actualIndex,
        sourceFile,
        datetime: r.datetime,
        author: r.author,
        data: r.data,
        dateKey: r.dateKey,
      }
      if (r.data?.startsWith("C")) gapPartitions.push(entry)
      else notIncluded.push(entry)
    }
  })

  return { gapPartitions, notIncluded }
}

function getFilePartitions(rows: Row[], sourceFile: string): {
  startPartition: Partition
  focalPartitions: Partition[]
  all_nonFFComments: CommentRow[]
} {
  const focalRaw = helper_findPartitions_from_F_to_END(rows)

  const startPartition: Partition = {
    startIndex: 0,
    endIndex: 4,
    startDateTime: rows[0]?.datetime ?? "",
    endDateTime: rows[4]?.datetime ?? "",
    sourceFile,
    dateKey: rows[0]?.dateKey ?? extractDateKey(sourceFile) ?? "unknown",
  }

  const focalPartitions: Partition[] = focalRaw.map((p) => ({
    startIndex: p.startIndex,
    endIndex: p.endIndex,
    startDateTime: rows[p.startIndex]?.datetime ?? "",
    endDateTime: rows[p.endIndex]?.datetime ?? "",
    sourceFile,
    dateKey: rows[0]?.dateKey ?? extractDateKey(sourceFile) ?? "unknown",
  }))

  const initialComments = helper_comments_afterStartAndBeforeFirstPartition(focalRaw, rows, sourceFile)
  const afterComments = helper_getCommentsAfterEnd_partitions(focalRaw, rows, sourceFile)
  const { gapPartitions } = helper_findGapComments(focalRaw, rows, sourceFile)

  const all_nonFFComments = [...initialComments, ...afterComments, ...gapPartitions]
  return { startPartition, focalPartitions, all_nonFFComments }
}

function sortByStartDateTimePartitions(arr: Partition[]) {
  return [...arr].sort((a, b) => new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime())
}

function getTimeDiff(dateString1: string, dateString2: string) {
  const d1 = new Date(dateString1)
  const d2 = new Date(dateString2)
  return d2.getTime() - d1.getTime()
}

function helper_adjustPartitionArrayTimes(arr: Partition[]): Partition[] {
  let prev: Partition | null = null
  const out: Partition[] = []

  for (const p of arr) {
    if (!prev) {
      out.push(p)
      prev = p
      continue
    }
    const fiveMinutes = 310000
    const prevEnd = new Date(prev.endDateTime)
    const curStart = new Date(p.startDateTime)
    const timeDiff = getTimeDiff(prev.endDateTime, p.startDateTime)
    const timeAdjustment = 1000
    const totalAdjustment = -timeDiff + timeAdjustment

    if (timeDiff > fiveMinutes) {
      out.push(p)
    } else {
      const newStart = formatIsoDate(new Date(curStart.getTime() + totalAdjustment))
      const newEnd = formatIsoDate(new Date(new Date(p.endDateTime).getTime() + totalAdjustment))
      out.push({ ...p, startDateTime: newStart, endDateTime: newEnd })
    }
    prev = p
  }
  return out
}

function sortByDateTimeRows(data: any[][]) {
  return [...data].sort((a, b) => new Date(a[1]).getTime() - new Date(b[1]).getTime())
}

/** === Same as readExcel.js === */
function splitByKeys(mainArray: Array<Record<number, any>>, dividerKeys: Array<Record<number, any>>) {
  const sortedDividers = dividerKeys.map((obj) => Object.keys(obj)[0]).sort((a, b) => Number(a) - Number(b))
  const sortedMain = [...mainArray].sort((a, b) => Number(Object.keys(a)[0]) - Number(Object.keys(b)[0]))

  const result: Array<Array<Record<number, any>>> = []
  let currentGroup: Array<Record<number, any>> = []
  let dividerIndex = 0

  for (const item of sortedMain) {
    const key = Object.keys(item)[0]
    while (dividerIndex < sortedDividers.length && Number(key) >= Number(sortedDividers[dividerIndex])) {
      result.push(currentGroup)
      currentGroup = []
      dividerIndex++
    }
    currentGroup.push(item)
  }

  if (currentGroup.length > 0) result.push(currentGroup)
  return result
}

function makeOneContinuousFocalFollow(data: any[][]) {
  const dataCol = 2
  const F_starts: Array<Record<number, any>> = []
  const ends: Array<Record<number, any>> = []
  const losts: Array<Record<number, any>> = []

  data.forEach((row, index) => {
    if (!row || !row[dataCol] || String(row[dataCol]).trim() === "") return
    const v = String(row[dataCol])
    if (v.startsWith("F:")) F_starts.push({ [index]: row })
    else if (v.toLowerCase().startsWith("end")) ends.push({ [index]: row })
    else if (v.toLowerCase().startsWith("c lost focal")) losts.push({ [index]: row })
  })

  const startSplits = splitByKeys(F_starts, losts)
  const endSplits = splitByKeys(ends, losts)

  const removeStarts = startSplits.map((g) => g.slice(1).map((obj) => Object.keys(obj)[0]))
  const removeEnds = endSplits.map((g) => g.slice(0, -1).map((obj) => Object.keys(obj)[0]))
  const removeRowIndexes = [...removeStarts.flat(), ...removeEnds.flat()].map((el) => parseInt(el, 10))

  return data.filter((_, idx) => !removeRowIndexes.includes(idx))
}

function makeOneContinuousFocalFollow_keepMeta(data: any[][]) {
  // data row shape: [author, datetime, data, sourceFile, originalRowNumber]
  const dataCol = 2
  const F_starts: Array<Record<number, any>> = []
  const ends: Array<Record<number, any>> = []
  const losts: Array<Record<number, any>> = []

  data.forEach((row, index) => {
    if (!row || !row[dataCol] || String(row[dataCol]).trim() === "") return
    const v = String(row[dataCol])
    if (v.startsWith("F:")) F_starts.push({ [index]: row })
    else if (v.toLowerCase().startsWith("end")) ends.push({ [index]: row })
    else if (v.toLowerCase().startsWith("c lost focal")) losts.push({ [index]: row })
  })

  const startSplits = splitByKeys(F_starts, losts)
  const endSplits = splitByKeys(ends, losts)

  const removeStarts = startSplits.map((g) => g.slice(1).map((obj) => Object.keys(obj)[0]))
  const removeEnds = endSplits.map((g) => g.slice(0, -1).map((obj) => Object.keys(obj)[0]))
  const removeRowIndexes = [...removeStarts.flat(), ...removeEnds.flat()].map((el) => parseInt(el, 10))

  return data.filter((_, idx) => !removeRowIndexes.includes(idx))
}

function buildXlsBuffer(data: any[][]): Buffer {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet(data)
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1")
  return XLSX.write(workbook, { type: "buffer", bookType: "xls" }) as Buffer
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const files = formData.getAll("files") as File[]

    if (!files?.length) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 })
    }

    // 1) Parse each file -> rows
    const perFile: Array<{ file: File; rows: Row[]; sheet: any[][] }> = []
    for (const file of files) {
      const ab = await file.arrayBuffer()
      const sheet = parseExcelFile(Buffer.from(ab))
      const rows = sheetToRows(sheet, file.name)
      perFile.push({ file, rows, sheet })
    }

    // 2) Group files by dateKey (like groupFilesByDate)
    const byDate = new Map<string, Array<{ file: File; rows: Row[]; sheet: any[][] }>>()
    for (const item of perFile) {
      const dateKey = extractDateKey(item.file.name)
      if (!dateKey) continue // matches readExcel behavior: only files with prefix are grouped
      if (!byDate.has(dateKey)) byDate.set(dateKey, [])
      byDate.get(dateKey)!.push(item)
    }

    const results: Array<{
      date: string
      standardFileName: string
      standardBase64: string
      withMetadataFileName: string
      withMetadataBase64: string
      stats: { files: number; rows: number }
      validations?: Array<{
        check: string
        passed: boolean
        issues: string[]
        warnings: string[]
      }>
    }> = []

    // 3) For each date, replicate master() -> partitionsToFile() -> writeFile_helper()
    for (const [date, items] of byDate.entries()) {
      // gather partitions + comments from all files for that date
      const allFocal: Partition[] = []
      const allStart: Partition[] = []
      const allComments: CommentRow[] = []

      // Cache raw sheet rows by file like readExcel.js does (fileData_json)
      const sheetByFile = new Map<string, any[][]>()

      for (const it of items) {
        sheetByFile.set(it.file.name, it.sheet)

        const { startPartition, focalPartitions, all_nonFFComments } = getFilePartitions(it.rows, it.file.name)
        allStart.push(startPartition)
        allFocal.push(...focalPartitions)
        allComments.push(...all_nonFFComments)
      }

      // sort partitions + adjust time
      const sortedFocal = sortByStartDateTimePartitions(allFocal)
      const adjustedFocal = helper_adjustPartitionArrayTimes(sortedFocal)

      // NOTE: readExcel uses only the FIRST startPartition for the date
      const datePartitionArray: Partition[] = [allStart[0], ...adjustedFocal]

      // === Build merged rows WITH provenance (source file + original row #) ===
      let mergedRows: MergedRow[] = []

      // 1) Partition rows (startPartition + focal partitions)
      for (const p of datePartitionArray) {
        const sheet = sheetByFile.get(p.sourceFile)
        if (!sheet) continue

        for (let rowIdx = p.startIndex; rowIdx <= p.endIndex; rowIdx++) {
          const r = sheet[rowIdx] ?? []
          const author = String(r?.[0] ?? "")
          const rawDate = r?.[1]
          const datetime =
            typeof rawDate === "number" ? formatIsoDate(excelDateToJSDate(rawDate)) : String(rawDate ?? "")
          const data = String(r?.[2] ?? "")

          // Sheet row 0 is header, so rowIdx 1..N are actual data rows.
          // We store originalRowNumber = rowIdx to match frontend's rowIdx loop.
          mergedRows.push({
            author,
            datetime,
            data,
            sourceFile: p.sourceFile,
            originalRowNumber: rowIdx + 1,
          })
        }
      }

      // 2) Extra comments (initial/gaps/after) — keep their original index too
      for (const c of allComments) {
        mergedRows.push({
          author: c.author,
          datetime: c.datetime,
          data: c.data,
          sourceFile: c.sourceFile,
          originalRowNumber: c.index + 1,
        })
      }

      // 3) Sort by datetime (same as readExcel)
      mergedRows.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())

      // 4) makeOneContinuousFocalFollow BUT preserve metadata
      // Convert to AoA for the existing functions
      let aoaWithMeta: any[][] = mergedRows.map((r) => [r.author, r.datetime, r.data, r.sourceFile, r.originalRowNumber])

      aoaWithMeta = makeOneContinuousFocalFollow_keepMeta(aoaWithMeta)

      // Rebuild objects after transforms
      mergedRows = aoaWithMeta.map((r) => ({
        author: String(r?.[0] ?? ""),
        datetime: String(r?.[1] ?? ""),
        data: String(r?.[2] ?? ""),
        sourceFile: String(r?.[3] ?? ""),
        originalRowNumber: Number(r?.[4] ?? 0),
      }))

      // 5) Build standard + metadata outputs
      const standardData: any[][] = mergedRows.map((r) => [r.author, r.datetime, r.data])

      const metadataData: any[][] = mergedRows.map((r) => [r.author, r.datetime, r.data, r.sourceFile, r.originalRowNumber])

      const standardBuf = buildXlsBuffer(standardData)
      const metaBuf = buildXlsBuffer(metadataData)

      // Run validation checks
      const metadataAoA: any[][] = mergedRows.map((r) => [r.author, r.datetime, r.data, r.sourceFile, r.originalRowNumber])
      
      const perFileForValidation = items.map((it) => ({
        fileName: it.file.name,
        rows: it.sheet,
      }))

      // Build dropped rows for round-trip integrity check
      // A row is "dropped" if it's not in the merged output
      const mergedSet = new Set<string>()
      for (const row of metadataAoA) {
        const sourceFile = String(row[3] || "")
        const originalRowNum = Number(row[4] || 0)
        // originalRowNumber is 1-based, so subtract 1 to match 0-based row indices
        mergedSet.add(`${sourceFile}|${originalRowNum - 1}`)
      }

      const droppedRowsAoA: any[][] = []
      for (const perFile of perFileForValidation) {
        for (let rowIdx = 0; rowIdx < perFile.rows.length; rowIdx++) {
          const key = `${perFile.fileName}|${rowIdx}`
          if (!mergedSet.has(key)) {
            const row = perFile.rows[rowIdx]
            // Build dropped row format: [author, datetime, data, sourceFile, originalRowNumber]
            const author = String(row?.[0] ?? "")
            const rawDate = row?.[1]
            const datetime = typeof rawDate === "number" ? formatIsoDate(excelDateToJSDate(rawDate)) : String(rawDate ?? "")
            const data = String(row?.[2] ?? "")
            droppedRowsAoA.push([author, datetime, data, perFile.fileName, rowIdx])
          }
        }
      }

      const beforeValidations = [
        checkFandENDLineBalance(perFileForValidation),
      ]

      const afterValidations = [
        checkConsecutiveNoSecondTimestamps(metadataAoA),
        checkPointSampleIntervals(metadataAoA),
      ]

      const allValidations = [...beforeValidations, ...afterValidations]

      results.push({
        date,
        standardFileName: `${date}.xls`,
        standardBase64: standardBuf.toString("base64"),
        withMetadataFileName: `${date}_with_metadata.xls`,
        withMetadataBase64: metaBuf.toString("base64"),
        stats: { files: items.length, rows: mergedRows.length },
        validations: allValidations,
      })
    }

    return NextResponse.json({
      mode: "per-day readExcel-equivalent",
      dates: results.map((r) => r.date).sort(),
      results,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to merge files" },
      { status: 500 }
    )
  }
}
