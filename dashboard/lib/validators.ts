/**
 * Validation checks for merged data
 * 
 * Check 1: No 3+ consecutive lines with timestamps having no seconds (xx:xx:00)
 * Check 2: Point samples not too close - for X/Y lines, intervals should be 2-3 min (no < 2 or > 3)
 * Check 3: Equivalent #of F: lines and END lines in source files
 */

interface ValidationResult {
  check: string
  passed: boolean
  issues: string[]
  warnings: string[]
}

/**
 * Check 1: Detect 3+ consecutive lines with timestamps having no seconds (xx:xx:00)
 */
export function checkConsecutiveNoSecondTimestamps(mergedRows: any[][]): ValidationResult {
  const issues: string[] = []
  const warnings: string[] = []
  let consecutiveCount = 0
  let startRowIndex = -1

  for (let i = 0; i < mergedRows.length; i++) {
    const row = mergedRows[i]
    const datetime = String(row[1] || "")

    // Check if timestamp ends with :00 (no seconds, or 00 seconds)
    const hasNoSeconds = /:\d{2}:00$/.test(datetime)

    if (hasNoSeconds) {
      if (consecutiveCount === 0) {
        startRowIndex = i
      }
      consecutiveCount++
    } else {
      if (consecutiveCount >= 3) {
        issues.push(`Rows ${startRowIndex + 1}-${i}: Found ${consecutiveCount} consecutive timestamps with no seconds (xx:xx:00)`)
      }
      consecutiveCount = 0
      startRowIndex = -1
    }
  }

  // Check final sequence
  if (consecutiveCount >= 3) {
    issues.push(`Rows ${startRowIndex + 1}-${mergedRows.length}: Found ${consecutiveCount} consecutive timestamps with no seconds (xx:xx:00)`)
  }

  return {
    check: "Consecutive No-Second Timestamps",
    passed: issues.length === 0,
    issues,
    warnings,
  }
}

/**
 * Check 2: Validate point sample intervals for X/Y lines
 * Should be 2.5 min apart on average, with no intervals < 2 min or > 3 min
 */
export function checkPointSampleIntervals(mergedRows: any[][]): ValidationResult {
  const issues: string[] = []
  const warnings: string[] = []

  // Collect X and Y lines with their timestamps
  const xyLines: Array<{ rowIdx: number; data: string; datetime: Date }> = []

  for (let i = 0; i < mergedRows.length; i++) {
    const row = mergedRows[i]
    const data = String(row[2] || "")
    const datetime = String(row[1] || "")

    // Check if line starts with X or Y
    if (data.startsWith("X") || data.startsWith("Y")) {
      try {
        const dateObj = new Date(datetime)
        if (!isNaN(dateObj.getTime())) {
          xyLines.push({ rowIdx: i, data, datetime: dateObj })
        }
      } catch {
        // Skip invalid dates
      }
    }
  }

  // Check intervals between consecutive X/Y lines
  for (let i = 1; i < xyLines.length; i++) {
    const prevLine = xyLines[i - 1]
    const currLine = xyLines[i]
    const intervalMs = currLine.datetime.getTime() - prevLine.datetime.getTime()
    const intervalMin = intervalMs / 60000

    if (intervalMin < 2) {
      issues.push(
        `Rows ${prevLine.rowIdx + 1}-${currLine.rowIdx + 1}: Interval too short (${intervalMin.toFixed(2)} min). Expected 2-3 min.`
      )
    } else if (intervalMin > 3) {
      issues.push(
        `Rows ${prevLine.rowIdx + 1}-${currLine.rowIdx + 1}: Interval too long (${intervalMin.toFixed(2)} min). Expected 2-3 min.`
      )
    }
  }

  // Calculate average interval
  if (xyLines.length > 1) {
    const totalMs = xyLines[xyLines.length - 1].datetime.getTime() - xyLines[0].datetime.getTime()
    const avgIntervalMin = totalMs / (xyLines.length - 1) / 60000
    
    if (Math.abs(avgIntervalMin - 2.5) > 0.5) {
      warnings.push(
        `Average interval between X/Y lines is ${avgIntervalMin.toFixed(2)} min (expected ~2.5 min). ` +
        `Found ${xyLines.length} X/Y lines over ${(totalMs / 60000).toFixed(1)} minutes.`
      )
    }
  }

  return {
    check: "Point Sample Intervals",
    passed: issues.length === 0,
    issues,
    warnings,
  }
}

/**
 * Check 3: Validate equivalent number of F: lines and END lines per source file
 */
export function checkFandENDLineBalance(perFileData: Array<{ fileName: string; rows: any[][] }>): ValidationResult {
  const issues: string[] = []
  const warnings: string[] = []

  for (const fileData of perFileData) {
    const fCount = fileData.rows.filter((row) => {
      const data = String(row[2] || "")
      return data.startsWith("F:")
    }).length

    const endCount = fileData.rows.filter((row) => {
      const data = String(row[2] || "")
      return String(data).toLowerCase().startsWith("end")
    }).length

    if (fCount !== endCount) {
      issues.push(
        `${fileData.fileName}: Mismatch - Found ${fCount} "F:" lines but ${endCount} "END" lines. This may indicate a data issue.`
      )
    }
  }

  return {
    check: "F: and END Line Balance",
    passed: issues.length === 0,
    issues,
    warnings,
  }
}



/**
 * Run all validation checks
 */
export function runAllValidations(
  mergedRows: any[][],
  perFileData: Array<{ fileName: string; rows: any[][] }>
): ValidationResult[] {
  return [
    checkConsecutiveNoSecondTimestamps(mergedRows),
    checkPointSampleIntervals(mergedRows),
    checkFandENDLineBalance(perFileData),
  ]
}
