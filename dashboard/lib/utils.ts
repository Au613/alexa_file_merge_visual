import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Convert Excel serial date to JS Date
 */
function excelDateToJSDate(serial: number): Date {
	const utcDays = Math.floor(serial - 25569)
	const utcValue = utcDays * 86400
	const fractionalDay = serial - Math.floor(serial) + 0.0000001
	const totalSeconds = Math.floor(86400 * fractionalDay)
	return new Date((utcValue + totalSeconds) * 1000)
}

/**
 * Format a datetime value (handles both Excel serial numbers and ISO date strings)
 */
function formatDateTime(value: any): string {
	if (value == null || value === "") return ""

	// Try to convert string to number if it looks like a number
	let numValue: number | null = null
	
	if (typeof value === "number") {
		numValue = value
	} else if (typeof value === "string") {
		const parsed = parseFloat(value)
		if (!isNaN(parsed) && value.trim().match(/^\d+\.?\d*$/)) {
			numValue = parsed
		}
	}

	// If it's a number (Excel serial), convert it
	if (numValue !== null && Number.isFinite(numValue) && numValue > 0) {
		try {
			const date = excelDateToJSDate(numValue)
			const hh = String(date.getUTCHours()).padStart(2, "0")
			const min = String(date.getUTCMinutes()).padStart(2, "0")
			const sec = String(date.getUTCSeconds()).padStart(2, "0")
			return `${hh}:${min}:${sec}`
		} catch (e) {
			// If conversion fails, fall through to string return
		}
	}

	// If it's already a string date, extract just the time portion
	const timeMatch = String(value).match(/(\d{1,2}):(\d{2}):(\d{2})/)
	if (timeMatch) {
		return `${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}`
	}

	return String(value)
}

export interface FocalFollowRange {
	startRow: number
	endRow: number
	focalType: string // e.g., "DLL", "DCC"
	rowCount: number
	startTime: string // timestamp from column 1 (index 1)
	endTime: string // timestamp from column 1 (index 1)
}

/**
 * Extract focal follow ranges from a data array
 * Looks for rows where column 2 (index 2) contains data starting with "F:" and ending with "end"
 */
export function extractFocalFollowRanges(rows: any[][]): FocalFollowRange[] {
	const ranges: FocalFollowRange[] = []
	let currentStart: number | null = null
	let currentFocalType: string | null = null

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]
		const dataCol = String(row?.[2] || "").trim()

		// Check if this is a start row (F: ...)
		if (dataCol.startsWith("F:")) {
			if (currentStart !== null && currentFocalType) {
				// We found a new start before finding an end, close the previous range
				const startTime = formatDateTime(rows[currentStart]?.[1])
				const endTime = formatDateTime(rows[i - 1]?.[1])
				ranges.push({
					startRow: currentStart,
					endRow: i - 1,
					focalType: currentFocalType,
					rowCount: i - currentStart,
					startTime,
					endTime,
				})
			}
			currentStart = i
			// Extract the focal type (e.g., "DLL" from "F: DLL")
			const match = dataCol.match(/F:\s*(\S+)/)
			currentFocalType = match ? match[1] : "UNKNOWN"
		}

		// Check if this is an end row
		if (dataCol.toLowerCase().startsWith("end")) {
			if (currentStart !== null && currentFocalType) {
				const startTime = formatDateTime(rows[currentStart]?.[1])
				const endTime = formatDateTime(rows[i]?.[1])
				ranges.push({
					startRow: currentStart,
					endRow: i,
					focalType: currentFocalType,
					rowCount: i - currentStart + 1,
					startTime,
					endTime,
				})
				currentStart = null
				currentFocalType = null
			}
		}
	}

	return ranges
}

/**
 * Build a color map for focal types that appear in both merged and original data
 * Ensures the same focal type gets the same color across both datasets
 */
export function buildFocalColorMap(mergedRanges: FocalFollowRange[], originalRanges: FocalFollowRange[]): Map<string, string> {
	const colors = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316", "#06B6D4", "#84CC16"]

	const focalTypes = new Set<string>()
	mergedRanges.forEach((r) => focalTypes.add(r.focalType))
	originalRanges.forEach((r) => focalTypes.add(r.focalType))

	const colorMap = new Map<string, string>()
	let colorIdx = 0

	// Sort focal types alphabetically for consistent coloring
	const sortedTypes = Array.from(focalTypes).sort()

	for (const type of sortedTypes) {
		colorMap.set(type, colors[colorIdx % colors.length])
		colorIdx++
	}

	return colorMap
}
