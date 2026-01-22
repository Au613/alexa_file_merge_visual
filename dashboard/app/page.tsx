"use client"

import {useState} from "react"
import Link from "next/link"
import {Upload, FileSpreadsheet, X, AlertCircle, CheckCircle, Download, ChevronDown, GitCompare} from "lucide-react"
import {Button} from "@/components/ui/button"
import {Card, CardContent} from "@/components/ui/card"
import {Badge} from "@/components/ui/badge"
import {Collapsible, CollapsibleTrigger, CollapsibleContent} from "@/components/ui/collapsible"
import {cn, extractFocalFollowRanges, buildFocalColorMap, FocalFollowRange} from "@/lib/utils"
import {ValidationPanel} from "@/components/ValidationPanel"
import {FocalFollowLegend} from "@/components/FocalFollowLegend"
import * as XLSX from "xlsx"

interface UploadedFile {
	id: string
	name: string
	size: number
	file: File
}

interface MergeAnalysis {
	originalFiles: Array<{
		fileIndex: number
		fileName: string
		totalRows: number
		keptRows: number
		droppedRows: number
		keptIndices: number[]
		droppedIndices: number[]
	}>
	totalOriginalRows: number
	totalMergedRows: number
	mergeMap?: Array<{fileIndex: number; rowsFromFile: number[]}>
}

interface SourceFileBlock {
	sourceFile: string
	startRowMerged: number
	endRowMerged: number
	startTimestamp: string
	endTimestamp: string
	rowCount: number
}

// Normalize source file names to strip paths and handle casing
function normalizeSourceFile(value: any): string {
	const str = String(value ?? "")
	const baseName = str.split(/[\\\/]/).pop() ?? str // strip folders
	return baseName.trim()
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

function reconstructFilesFromMerged(mergedRows: any[][], droppedRows: any[][]): Map<string, any[][]> {
	console.log(`=== RECONSTRUCT START: ${mergedRows.length} merged rows, ${droppedRows.length} dropped rows ===`)
	
	// Group by source file and sort by original row number
	const fileMap = new Map<string, Array<{rowIdx: number; data: any[]}>>()
	const seenRows = new Set<string>() // Track (sourceFile, originalRowNum) to avoid duplicates

	// Process merged rows first
	for (const row of mergedRows) {
		const sourceFile = normalizeSourceFile(row[3])
		const originalRowNum = Number(row[4] || 0) // This is 1-based from API
		const key = `${sourceFile}|${originalRowNum - 1}` // Use 0-based for tracking
		
		if (seenRows.has(key)) continue // Skip if already added
		seenRows.add(key)
		
		// Take columns 0-2 (author, datetime, data) + any extra columns beyond the metadata columns (3 and 4)
		const rowData = row.slice(0, 3).concat(row.slice(5))
		
		if (!fileMap.has(sourceFile)) {
			fileMap.set(sourceFile, [])
		}
		
		fileMap.get(sourceFile)!.push({rowIdx: originalRowNum - 1, data: rowData}) // Store 0-based index
	}

	console.log(`After merged rows: ${Array.from(fileMap.entries()).map(([name, rows]) => `${name}=${rows.length}`).join(", ")}`)
	
	// Skip droppedRows header row if present (check if row[3] is "Source File")
	const droppedDataRows = droppedRows.length > 0 && String(droppedRows[0]?.[3]) === "Source File"
		? droppedRows.slice(1)
		: droppedRows

	// Process dropped rows (skip if already in merged)
	for (const row of droppedDataRows) {
		const sourceFile = normalizeSourceFile(row[3])
		const originalRowNum = Number(row[4] || 0) // This is 0-based from frontend
		const key = `${sourceFile}|${originalRowNum}`

		if (seenRows.has(key)) continue // Skip if already added
		seenRows.add(key)

		// Take columns 0-2 (author, datetime, data) + any extra columns beyond the metadata columns (3 and 4)
		const rowData = row.slice(0, 3).concat(row.slice(5))

		if (!fileMap.has(sourceFile)) {
			fileMap.set(sourceFile, [])
		}

		fileMap.get(sourceFile)!.push({rowIdx: originalRowNum, data: rowData})
	}

	console.log(`After dropped rows: ${Array.from(fileMap.entries()).map(([name, rows]) => `${name}=${rows.length}`).join(", ")}`)

	// Convert to sorted arrays
	const reconstructedFiles = new Map<string, any[][]>()

	for (const [fileName, rows] of fileMap) {
		// Sort by original row number
		rows.sort((a, b) => a.rowIdx - b.rowIdx)

		// Extract just the data (now in original order)
		const sortedData = rows.map((r) => r.data)
		reconstructedFiles.set(fileName, sortedData)
		
		console.log(`Reconstructed ${fileName}: ${sortedData.length} rows (sample: ${sortedData.slice(0, 1).map((r) => `[${r.map((v) => JSON.stringify(v)).join(", ")}]`).join(" ")})`)
	}

	console.log(`=== RECONSTRUCT END: ${reconstructedFiles.size} files ===`)


	return reconstructedFiles
}

function normalizeDateCell(v: any): string {
	if (v == null || v === "") return ""

	// If original file stores Excel serials (numbers)
	if (typeof v === "number" && Number.isFinite(v)) {
		return formatIsoDate(excelDateToJSDate(v))
	}

	// If already a string, normalize whitespace
	return String(v).trim()
}

function normalizeCell(v: any, colIdx: number): any {
	if (v == null) return "" // undefined/null → ""

	// Column 1 is DateTime in schema [author, datetime, data] - must check before string check!
	if (colIdx === 1) return normalizeDateCell(v)

	if (typeof v === "string") return v.trim()

	// Keep other values as-is (or convert to string if you prefer)
	return v
}

function normalizeRow(row: any[], targetLen: number): any[] {
	const out = new Array(targetLen).fill("")
	for (let i = 0; i < targetLen; i++) {
		out[i] = normalizeCell(row?.[i], i)
	}
	return out
}

function isEffectivelyEmptyRow(row: any[]): boolean {
	if (!row) return true
	return row.every((cell) => {
		if (cell == null) return true
		if (typeof cell === "string") return cell.trim() === ""
		return false // numbers/booleans mean it's not empty
	})
}

function trimTrailingEmptyRows(rows: any[][]): any[][] {
	let end = rows.length
	while (end > 0 && isEffectivelyEmptyRow(rows[end - 1])) end--
	return rows.slice(0, end)
}

function compareReconstructedFiles(originalFiles: Array<{fileName: string; rows: any[][]}>, reconstructedFiles: Map<string, any[][]>): {results: Array<{fileName: string; matches: boolean; details: string}>; debugInfo: Array<{fileName: string; firstOriginal10: any[][]; firstReconstructed10: any[][]; lastOriginal10: any[][]; lastReconstructed10: any[][]; origTrimmedLength: number; reconTrimmedLength: number; misalignedRows: Array<{rowIdx: number; original: any[]; reconstructed: any[]}>}>} {
	const results: Array<{fileName: string; matches: boolean; details: string}> = []
	const debugInfo: Array<{fileName: string; firstOriginal10: any[][]; firstReconstructed10: any[][]; lastOriginal10: any[][]; lastReconstructed10: any[][]; origTrimmedLength: number; reconTrimmedLength: number; misalignedRows: Array<{rowIdx: number; original: any[]; reconstructed: any[]}>}> = []

	console.log("\n========== COMPARISON START ==========")
	console.log(`Original files: ${originalFiles.length}`)
	console.log(`Reconstructed files: ${reconstructedFiles.size}`)

	for (const original of originalFiles) {
		const reconstructed = reconstructedFiles.get(original.fileName)

		console.log(`\n--- FILE: ${original.fileName} ---`)
		console.log(`Original rows (raw): ${original.rows.length}`)

		if (!reconstructed) {
			console.log(`❌ RECONSTRUCTED FILE NOT FOUND`)
			results.push({
				fileName: original.fileName,
				matches: false,
				details: "Reconstructed file not found",
			})
			continue
		}

		console.log(`Reconstructed rows (raw): ${reconstructed.length}`)

		// Trim trailing empty rows to account for Excel's range behavior
		const origTrimmed = trimTrailingEmptyRows(original.rows)
		const reconTrimmed = trimTrailingEmptyRows(reconstructed)

		const origTrimmedCount = original.rows.length - origTrimmed.length
		const reconTrimmedCount = reconstructed.length - reconTrimmed.length

		console.log(`After trimming trailing empty rows:`)
		console.log(`  Original: ${original.rows.length} → ${origTrimmed.length} (removed ${origTrimmedCount} trailing empty rows)`)
		console.log(`  Reconstructed: ${reconstructed.length} → ${reconTrimmed.length} (removed ${reconTrimmedCount} trailing empty rows)`)

		// Collect last 10 rows for debug display
		const origLast10Start = Math.max(0, original.rows.length - 10)
		const lastOriginal10 = original.rows.slice(origLast10Start)
		
		const reconLast10Start = Math.max(0, reconstructed.length - 10)
		const lastReconstructed10 = reconstructed.slice(reconLast10Start)

		// Collect first 10 rows for debug display
		const firstOriginal10 = original.rows.slice(0, Math.min(10, original.rows.length))
		const firstReconstructed10 = reconstructed.slice(0, Math.min(10, reconstructed.length))

		console.log(`\n  === LAST 10 ORIGINAL ROWS (before trim) ===`)
		for (let i = origLast10Start; i < original.rows.length; i++) {
			console.log(`  [${i}]: ${JSON.stringify(original.rows[i])}`)
		}

		console.log(`\n  === LAST 10 RECONSTRUCTED ROWS (before trim) ===`)
		for (let i = reconLast10Start; i < reconstructed.length; i++) {
			console.log(`  [${i}]: ${JSON.stringify(reconstructed[i])}`)
		}

		console.log(`\n  === AFTER TRIMMING ===`)
		console.log(`  Original trimmed length: ${origTrimmed.length}`)
		console.log(`  Reconstructed trimmed length: ${reconTrimmed.length}`)
		if (origTrimmed.length > 0) {
			console.log(`  Last original row:`, JSON.stringify(origTrimmed[origTrimmed.length - 1]))
		}
		if (reconTrimmed.length > 0) {
			console.log(`  Last reconstructed row:`, JSON.stringify(reconTrimmed[reconTrimmed.length - 1]))
		}

		// Compare row counts after trimming
		if (origTrimmed.length !== reconTrimmed.length) {
			console.log(`❌ ROW COUNT MISMATCH: ${origTrimmed.length} vs ${reconTrimmed.length} (difference: ${Math.abs(origTrimmed.length - reconTrimmed.length)} rows)`)
			results.push({
				fileName: original.fileName,
				matches: false,
				details: `Row count: ${origTrimmed.length} vs ${reconTrimmed.length} (difference: ${Math.abs(origTrimmed.length - reconTrimmed.length)} rows)`,
			})
			debugInfo.push({
				fileName: original.fileName,
				firstOriginal10,
				firstReconstructed10,
				lastOriginal10,
				lastReconstructed10,
				origTrimmedLength: origTrimmed.length,
				reconTrimmedLength: reconTrimmed.length,
				misalignedRows: [],
			})
			continue
		}

		console.log(`✅ Row counts match (${origTrimmed.length} rows)`)

		// Line-by-line comparison with normalization
		let allMatch = true
		let mismatchCount = 0
		const misalignedRows: Array<{rowIdx: number; original: any[]; reconstructed: any[]}> = []

		for (let i = 0; i < origTrimmed.length; i++) {
			const origRow = origTrimmed[i] ?? []
			const reconRow = reconTrimmed[i] ?? []

			// Decide a stable width to compare (handles trailing blanks)
			const width = Math.max(origRow.length, reconRow.length, 3)

			const origNorm = normalizeRow(origRow, width)
			const reconNorm = normalizeRow(reconRow, width)

			const match = JSON.stringify(origNorm) === JSON.stringify(reconNorm)

			if (!match) {
				if (mismatchCount < 5) {
					// Show first 5 mismatches with type info
					console.log(`❌ Row ${i + 1} MISMATCH:`)
					console.log(`   Original(raw): ${JSON.stringify(origRow)}`)
					console.log(`   Recon(raw):    ${JSON.stringify(reconRow)}`)
					console.log(`   Original(norm): ${JSON.stringify(origNorm)}`)
					console.log(`   Recon(norm):    ${JSON.stringify(reconNorm)}`)
					console.log(`   DateTime types:`, {
						orig: typeof origRow?.[1],
						recon: typeof reconRow?.[1],
						origVal: origRow?.[1],
						reconVal: reconRow?.[1],
					})
				}
				mismatchCount++
				allMatch = false
				misalignedRows.push({rowIdx: i, original: origRow, reconstructed: reconRow})
			}
		}

		if (allMatch) {
			console.log(`✅ ALL ROWS MATCH (${origTrimmed.length} rows)`)
			results.push({
				fileName: original.fileName,
				matches: true,
				details: `All ${origTrimmed.length} rows match`,
			})
		} else {
			console.log(`❌ ${mismatchCount} ROWS MISMATCH (out of ${origTrimmed.length})`)
			console.log(`🔍 MISALIGNED ROWS DEBUG:`, JSON.stringify(misalignedRows, null, 2))
			results.push({
				fileName: original.fileName,
				matches: false,
				details: `${mismatchCount} rows mismatch`,
			})
		}

		debugInfo.push({
			fileName: original.fileName,
			firstOriginal10,
			firstReconstructed10,
			lastOriginal10,
			lastReconstructed10,
			origTrimmedLength: origTrimmed.length,
			reconTrimmedLength: reconTrimmed.length,
			misalignedRows,
		})
	}

	console.log("\n========== COMPARISON END ==========\n")
	return {results, debugInfo}
}

function SourceFileVisualizer({blocks, mergedRowCount, mergedRows, selectedSourceFile, onSelectSourceFile}: {blocks: SourceFileBlock[]; mergedRowCount: number; mergedRows: any[][]; selectedSourceFile: string | null; onSelectSourceFile: (sourceFile: string | null) => void}) {
	// Get unique colors for each source file
	const colorMap = new Map<string, string>()
	const colors = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316"]

	blocks.forEach((block, idx) => {
		if (!colorMap.has(block.sourceFile)) {
			colorMap.set(block.sourceFile, colors[colorMap.size % colors.length])
		}
	})

	// Get rows for selected source file with merged index
	const selectedRowsWithIndex = selectedSourceFile ? mergedRows.map((row, idx) => ({row, mergedIdx: idx})).filter(({row}) => String(row[3]) === selectedSourceFile) : []

	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-sm font-semibold mb-3">Source File Distribution</h3>
				<div className="flex gap-0.5 h-12 bg-muted rounded-lg overflow-hidden">
					{blocks.map((block, idx) => {
						const percentage = (block.rowCount / mergedRowCount) * 100
						const color = colorMap.get(block.sourceFile) || "#ccc"
						const isSelected = selectedSourceFile === block.sourceFile
						return (
							<div
								key={idx}
								className="h-full hover:opacity-75 cursor-pointer transition-opacity relative group"
								style={{
									width: `${percentage}%`,
									backgroundColor: color,
									minWidth: "2px",
									opacity: isSelected ? 1 : 0.8,
									border: isSelected ? "2px solid black" : "none",
									boxSizing: "border-box",
								}}
								title={`${block.sourceFile}: Rows ${block.startRowMerged + 1}-${block.endRowMerged + 1}`}
								onClick={() => onSelectSourceFile(isSelected ? null : block.sourceFile)}
							>
								{/* Tooltip */}
								<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block bg-slate-900 text-white text-xs rounded py-2 px-3 whitespace-nowrap z-10">
									<div className="font-semibold">{block.sourceFile}</div>
									<div>
										Rows {block.startRowMerged + 1}-{block.endRowMerged + 1}
									</div>
									<div className="mt-1 pt-1 border-t border-slate-600">
										<div>Start: {block.startTimestamp}</div>
										<div>End: {block.endTimestamp}</div>
									</div>
								</div>
							</div>
						)
					})}
				</div>
			</div>

			{/* Legend */}
			<div className="space-y-2">
				<h4 className="text-xs font-semibold text-muted-foreground">Source Files</h4>
				<div className="space-y-1">
					{Array.from(new Set(blocks.map((b) => b.sourceFile))).map((file) => {
						const color = colorMap.get(file) || "#ccc"
						const totalRows = blocks.filter((b) => b.sourceFile === file).reduce((sum, b) => sum + b.rowCount, 0)
						const isSelected = selectedSourceFile === file
						return (
							<div key={file} className={cn("flex items-center gap-2 text-xs p-2 rounded cursor-pointer transition-colors", isSelected && "bg-blue-100")} onClick={() => onSelectSourceFile(isSelected ? null : file)}>
								<div className="w-3 h-3 rounded flex-shrink-0" style={{backgroundColor: color}} />
								<span className="text-muted-foreground truncate">{file}</span>
								<span className="ml-auto text-xs font-medium">{totalRows} rows</span>
							</div>
						)
					})}
				</div>
			</div>

			{/* Data Table for Selected Source File */}
			{selectedSourceFile && selectedRowsWithIndex.length > 0 && (
				<div className="mt-6 border-t pt-6">
					<h3 className="text-sm font-semibold mb-3">Rows from {selectedSourceFile}</h3>
					<div className="overflow-x-auto border rounded-lg">
						<table className="w-full text-xs">
							<thead className="bg-muted border-b">
								<tr>
									<th className="px-3 py-2 text-left font-semibold">Merged Row #</th>
									<th className="px-3 py-2 text-left font-semibold">Original Row #</th>
									<th className="px-3 py-2 text-left font-semibold">Author</th>
									<th className="px-3 py-2 text-left font-semibold">DateTime</th>
									<th className="px-3 py-2 text-left font-semibold">Data</th>
								</tr>
							</thead>
							<tbody>
								{selectedRowsWithIndex.map(({row, mergedIdx}, idx) => (
									<tr key={idx} className={cn("border-b hover:bg-muted/50", idx % 2 === 0 && "bg-muted/20")}>
										<td className="px-3 py-2 text-muted-foreground font-mono">{mergedIdx + 1}</td>
										<td className="px-3 py-2 text-muted-foreground font-mono">{Number(row[4])}</td>
										<td className="px-3 py-2 truncate">{String(row[0] || "")}</td>
										<td className="px-3 py-2 truncate">{String(row[1] || "")}</td>
										<td className="px-3 py-2 truncate">{String(row[2] || "")}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</div>
	)
}

interface MergeResult {
	date: string
	metadata: {standard: string; metadata: string}
	mergedRows: any[][]
	sourceFileBlocks: SourceFileBlock[]
	droppedRows: any[][]
	analysis: MergeAnalysis
	mergedFocalRanges: FocalFollowRange[]
	originalFileFocalRanges: Map<string, FocalFollowRange[]>
	focalColorMap: Map<string, string>
	validations?: Array<{
		check: string
		passed: boolean
		issues: string[]
		warnings: string[]
		pointSampleIntervals?: Array<{
			row1: number
			row2: number
			time1: string
			time2: string
			data1: string
			data2: string
			intervalMin: number
			status: 'pass' | 'fail'
		}>
	}>
}

export default function Home() {
	const [files, setFiles] = useState<UploadedFile[]>([])
	const [error, setError] = useState<string | null>(null)
	const [success, setSuccess] = useState(false)
	const [dragOver, setDragOver] = useState(false)
	const [allResults, setAllResults] = useState<MergeResult[]>([])
	const [isProcessing, setIsProcessing] = useState(false)
	const [selectedSourceFile, setSelectedSourceFile] = useState<string | null>(null)
	const [originalFileData, setOriginalFileData] = useState<Array<{fileName: string; rows: any[][]}>>([])
	const [reconstructionByDate, setReconstructionByDate] = useState<Record<
		string,
		{
			comparison: Array<{fileName: string; matches: boolean; details: string}>
			debugInfo: Array<{
				fileName: string
				firstOriginal10: any[][]
				firstReconstructed10: any[][]
				lastOriginal10: any[][]
				lastReconstructed10: any[][]
				origTrimmedLength: number
				reconTrimmedLength: number
				misalignedRows: Array<{rowIdx: number; original: any[]; reconstructed: any[]}>
			}>
		}
	>>({})
	const [comparisonViewFile, setComparisonViewFile] = useState<string | null>(null)
	const [pointSampleFilter, setPointSampleFilter] = useState<'all' | 'passed' | 'failed'>('all')
	const [fixedIntervals, setFixedIntervals] = useState<Set<string>>(new Set())

	const toggleIntervalFixed = (intervalKey: string) => {
		const newSet = new Set(fixedIntervals)
		if (newSet.has(intervalKey)) {
			newSet.delete(intervalKey)
		} else {
			newSet.add(intervalKey)
		}
		setFixedIntervals(newSet)
	}

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault()
		setDragOver(false)
		const newFiles = Array.from(e.dataTransfer.files)
		handleFiles(newFiles)
	}

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault()
		setDragOver(true)
	}

	const handleDragLeave = () => {
		setDragOver(false)
	}

	const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newFiles = Array.from(e.target.files || [])
		handleFiles(newFiles)
	}

	const handleFiles = (newFiles: File[]) => {
		const excelFiles = newFiles.filter((f) => f.name.endsWith(".xls") || f.name.endsWith(".xlsx"))

		if (excelFiles.length === 0) {
			setError("Please upload Excel files (.xls or .xlsx)")
			return
		}

		const uploadedFiles = excelFiles.map((f) => ({
			id: Math.random().toString(36).substring(2),
			name: f.name,
			size: f.size,
			file: f,
		}))

		setFiles((prev) => [...prev, ...uploadedFiles])
		setError(null)
	}

	const removeFile = (id: string) => {
		setFiles((prev) => prev.filter((f) => f.id !== id))
	}

	const downloadFile = async (date: string, version: "standard" | "withMetadata") => {
		try {
			const result = allResults.find((r) => r.date === date)
			if (!result) {
				setError("Result not found for date")
				return
			}

			const base64Data = version === "standard" ? result.metadata.standard : result.metadata.metadata

			// Decode base64 to binary
			const binaryString = atob(base64Data)
			const bytes = new Uint8Array(binaryString.length)
			for (let i = 0; i < binaryString.length; i++) {
				bytes[i] = binaryString.charCodeAt(i)
			}

			// Create blob and download
			const blob = new Blob([bytes], {type: "application/vnd.ms-excel"})
			const url = window.URL.createObjectURL(blob)
			const a = document.createElement("a")
			a.href = url
			a.download = version === "standard" ? `${date}-merged.xls` : `${date}-merged-with-metadata.xls`
			document.body.appendChild(a)
			a.click()
			window.URL.revokeObjectURL(url)
			document.body.removeChild(a)
		} catch (err) {
			setError("Failed to download file")
		}
	}

	const downloadDroppedRows = (date: string) => {
		try {
			const result = allResults.find((r) => r.date === date)
			if (!result || !result.droppedRows || result.droppedRows.length === 0) {
				setError("No dropped rows to download")
				return
			}

			// Create a new workbook with the dropped rows
			const worksheet = XLSX.utils.aoa_to_sheet(result.droppedRows)
			const workbook = XLSX.utils.book_new()
			XLSX.utils.book_append_sheet(workbook, worksheet, "Dropped Rows")

			// Download the file
			XLSX.writeFile(workbook, `${date}-dropped-rows.xls`)
		} catch (err) {
			setError("Failed to download dropped rows file")
		}
	}

	const runReconstructionComparison = (result: MergeResult) => {
		try {
			const date = result.date

			// Only use originals for this specific date (normalize for matching)
			const originalsForDate = originalFileData.filter((f) => normalizeSourceFile(f.fileName).startsWith(date))

			// Reconstruct files from merged + dropped rows
			const reconstructedFiles = reconstructFilesFromMerged(result.mergedRows, result.droppedRows)

			// Only keep reconstructed files that match this date's originals (normalize for matching)
			for (const key of Array.from(reconstructedFiles.keys())) {
				if (!normalizeSourceFile(key).startsWith(date)) {
					reconstructedFiles.delete(key)
				}
			}

			if (reconstructedFiles.size === 0) {
				setError("No files to reconstruct")
				return
			}

			// Compare reconstructed files with originals for this date only
			const {results: comparisonResults, debugInfo} = compareReconstructedFiles(originalsForDate, reconstructedFiles)

			setReconstructionByDate((prev) => ({
				...prev,
				[date]: {comparison: comparisonResults, debugInfo},
			}))

			const allMatch = comparisonResults.length > 0 && comparisonResults.every((r) => r.matches)
			if (allMatch) {
				setSuccess(true)
				setError(null)
			} else {
				const failedFiles = comparisonResults
					.filter((r) => !r.matches)
					.map((r) => `${r.fileName}: ${r.details}`)
					.join("; ")
				setError(`Reconstruction verification failed: ${failedFiles}`)
			}

			// Optionally pick the first file for viewing
			if (debugInfo.length > 0) {
				setComparisonViewFile(debugInfo[0].fileName)
			}
		} catch (err) {
			console.error(err)
			setError("Failed to run reconstruction comparison")
		}
	}

	const downloadReconstructedFilesOnly = (date: string) => {
		try {
			const result = allResults.find((r) => r.date === date)
			if (!result) {
				setError("Result not found for date")
				return
			}

			// Reconstruct files from merged + dropped rows
			const reconstructedFiles = reconstructFilesFromMerged(result.mergedRows, result.droppedRows)

			if (reconstructedFiles.size === 0) {
				setError("No files to reconstruct")
				return
			}

			// Get original filenames to filter valid reconstructed files
			const originalFileNames = new Set(files.map((f) => f.name))

			// Download each reconstructed file (only those matching original filenames)
			for (const [fileName, fileData] of reconstructedFiles) {
				// Only download if the filename matches one of the original uploaded files
				if (!originalFileNames.has(fileName)) {
					continue
				}

				const worksheet = XLSX.utils.aoa_to_sheet(fileData)
				const workbook = XLSX.utils.book_new()
				XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1")

				// Create a reconstructed version name
				const reconstructedName = fileName.replace(/\.xls[x]?$/, "") + "-reconstructed.xls"
				XLSX.writeFile(workbook, reconstructedName)

				// Small delay between downloads
				setTimeout(() => {}, 100)
			}

			setSuccess(true)
		} catch (err) {
			console.error("Error during reconstruction download:", err)
			setError("Failed to download reconstructed files")
		}
	}

	const downloadAllFiles = async () => {
		try {
			if (allResults.length === 0) {
				setError("No results to download")
				return
			}

			for (const result of allResults) {
				const binaryStringStandard = atob(result.metadata.standard)
				const bytesStandard = new Uint8Array(binaryStringStandard.length)
				for (let i = 0; i < binaryStringStandard.length; i++) {
					bytesStandard[i] = binaryStringStandard.charCodeAt(i)
				}

				const blobStandard = new Blob([bytesStandard], {type: "application/vnd.ms-excel"})
				const urlStandard = window.URL.createObjectURL(blobStandard)
				const aStandard = document.createElement("a")
				aStandard.href = urlStandard
				aStandard.download = `${result.date}-merged.xls`
				document.body.appendChild(aStandard)
				aStandard.click()
				window.URL.revokeObjectURL(urlStandard)
				document.body.removeChild(aStandard)

				// Small delay between downloads
				await new Promise((resolve) => setTimeout(resolve, 100))
			}
		} catch (err) {
			setError("Failed to download all files")
		}
	}

	const parseExcelFile = (buffer: Buffer): any[][] => {
		const workbook = XLSX.read(buffer, {type: "buffer"})
		const sheetName = workbook.SheetNames[0]
		const worksheet = workbook.Sheets[sheetName]
		return XLSX.utils.sheet_to_json(worksheet, {header: 1}) as any[][]
	}

	const handleMergeAndAnalyze = async () => {
		if (files.length === 0) {
			setError("Please upload at least one file")
			return
		}

		setIsProcessing(true)
		setError(null)
		setSuccess(false)

		try {
			// Step 1: Parse original files
			const originalData: Array<{
				fileName: string
				rows: any[][]
			}> = []

			for (const file of files) {
				const buffer = await file.file.arrayBuffer()
				const rows = parseExcelFile(Buffer.from(buffer))
				originalData.push({fileName: file.name, rows})
			}

			// Store original file data for reconstruction comparison
			setOriginalFileData(originalData)

			// Step 2: Send to merge API (new per-date structure)
			const formData = new FormData()
			files.forEach((f) => {
				formData.append("files", f.file)
			})

			const mergeResponse = await fetch("/api/merge", {
				method: "POST",
				body: formData,
			})

			if (!mergeResponse.ok) {
				throw new Error("Failed to merge files")
			}

			const mergeData = await mergeResponse.json()

			// Step 3: Process ALL results (one per date)
			if (!mergeData.results || mergeData.results.length === 0) {
				throw new Error("No merge results returned")
			}

			const results: MergeResult[] = []

			for (const dateResult of mergeData.results) {
				// Decode the metadata buffer from base64
				const metaBufBase64 = dateResult.withMetadataBase64
				const binaryString = atob(metaBufBase64)
				const bytes = new Uint8Array(binaryString.length)
				for (let i = 0; i < binaryString.length; i++) {
					bytes[i] = binaryString.charCodeAt(i)
				}
				const mergedBuffer = bytes.buffer as ArrayBuffer
				const mergedRows = parseExcelFile(Buffer.from(mergedBuffer))

				// Filter originals to only those for this specific date (normalize filenames for matching)
				const dateOriginalData = originalData.filter((f) => normalizeSourceFile(f.fileName).startsWith(dateResult.date))

				// Build source map from merged file
				// Note: originalRowNumber (row[4]) is 1-based from API, so subtract 1 to get 0-based index
				const sourceMap = new Map<string, Set<number>>()

				for (let i = 0; i < mergedRows.length; i++) {
					const row = mergedRows[i]
					if (row.length >= 5) {
						const sourceFile = normalizeSourceFile(row[3])
						const originalRowNum = Number(row[4]) // This is 1-based from API
						const key = `${sourceFile}|${originalRowNum - 1}` // Convert to 0-based for matching
						const set = sourceMap.get(key)
						if (set) set.add(i)
						else sourceMap.set(key, new Set([i]))
					}
				}

				// Analyze only the original files for this date
				const analysisResults = dateOriginalData.map((data, fileIdx) => {
					const normFile = normalizeSourceFile(data.fileName)
					const keptIndices: number[] = []
					const droppedIndices: number[] = []

					for (let rowIdx = 0; rowIdx < data.rows.length; rowIdx++) {
						const key = `${normFile}|${rowIdx}`
						if (sourceMap.has(key)) {
							keptIndices.push(rowIdx)
						} else {
							droppedIndices.push(rowIdx)
						}
					}

					return {
						fileIndex: fileIdx,
						fileName: data.fileName,
						totalRows: data.rows.length,
						keptRows: keptIndices.length,
						droppedRows: droppedIndices.length,
						keptIndices,
						droppedIndices,
					}
				})

				const totalOriginalRows = analysisResults.reduce((sum, f) => sum + f.totalRows, 0)
				const totalMergedRows = mergedRows.length

				const mergeAnalysis: MergeAnalysis = {
					originalFiles: analysisResults,
					totalOriginalRows,
					totalMergedRows,
					mergeMap: undefined,
				}

				// Build source file blocks visualization data
				const blocks: SourceFileBlock[] = []
				let currentFile: string | null = null
				let blockStart = 0
				let blockStartTimestamp = ""

				for (let i = 0; i < mergedRows.length; i++) {
					const row = mergedRows[i]
					const sourceFile = normalizeSourceFile(row[3])
					const timestamp = String(row[1] || "")

					if (sourceFile !== currentFile && currentFile !== null) {
						blocks.push({
							sourceFile: currentFile,
							startRowMerged: blockStart,
							endRowMerged: i - 1,
							startTimestamp: blockStartTimestamp,
							endTimestamp: String(mergedRows[i - 1][1] || ""),
							rowCount: i - blockStart,
						})
						blockStart = i
						blockStartTimestamp = timestamp
					}

					if (currentFile === null) {
						currentFile = sourceFile
						blockStartTimestamp = timestamp
					} else {
						currentFile = sourceFile
					}
				}

				if (currentFile !== null) {
					blocks.push({
						sourceFile: currentFile,
						startRowMerged: blockStart,
						endRowMerged: mergedRows.length - 1,
						startTimestamp: blockStartTimestamp,
						endTimestamp: String(mergedRows[mergedRows.length - 1][1] || ""),
						rowCount: mergedRows.length - blockStart,
					})
				}

				// Build dropped rows data for export
				const droppedRows: any[][] = [["Row Data (Author)", "DateTime", "Data", "Source File", "Original Row Number"]]

				analysisResults.forEach((fileAnalysis) => {
					const originalFile = dateOriginalData[fileAnalysis.fileIndex]
					if (!originalFile) return

					fileAnalysis.droppedIndices.forEach((rowIdx) => {
						const row = originalFile.rows[rowIdx]
						if (row) {
							const rawDate = row[1]
							const datetime = typeof rawDate === "number" ? formatIsoDate(excelDateToJSDate(rawDate)) : String(rawDate || "")

							droppedRows.push([String(row[0] || ""), datetime, String(row[2] || ""), fileAnalysis.fileName, rowIdx])
						}
					})
				})

				// Extract focal follow ranges
				const mergedFocalRanges = extractFocalFollowRanges(mergedRows)

				// Extract focal ranges from original files (only those for this specific date)
				const originalFileFocalRanges = new Map<string, FocalFollowRange[]>()
				dateOriginalData.forEach((data) => {
					const ranges = extractFocalFollowRanges(data.rows)
					originalFileFocalRanges.set(data.fileName, ranges)
				})

				// Build color map for consistent coloring across merged and original
				const allOriginalRanges = Array.from(originalFileFocalRanges.values()).flat()
				const focalColorMap = buildFocalColorMap(mergedFocalRanges, allOriginalRanges)

				// Add this date's result
				results.push({
					date: dateResult.date,
					metadata: {
						standard: dateResult.standardBase64,
						metadata: dateResult.withMetadataBase64,
					},
					mergedRows,
					sourceFileBlocks: blocks,
					droppedRows,
					analysis: mergeAnalysis,
					mergedFocalRanges,
					originalFileFocalRanges,
					focalColorMap,
					validations: dateResult.validations || [],
				})
			}

			setAllResults(results)
			setSuccess(true)

			// Automatically run reconstruction comparison for each date
			for (const result of results) {
				runReconstructionComparison(result)
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to process files")
		} finally {
			setIsProcessing(false)
		}
	}

	return (
		<div className="flex flex-col min-h-screen gap-6">
			{/* Navigation Bar */}
			<div className="border-b  backdrop-blur-sm sticky top-0 z-50">
				<div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
					<div>
						<h1 className="text-xl font-bold">Monkey Data Manager</h1>
					</div>
					<div className="flex gap-2">
						<Button variant="default" asChild>
							<Link href="/" className="flex items-center gap-2">
								<FileSpreadsheet className="w-4 h-4" />
								Merge
							</Link>
						</Button>
						<Button variant="outline" asChild className="hover:opacity-70 hover:text-inherit">
							<Link href="/compare" className="flex items-center gap-2">
								<GitCompare className="w-4 h-4" />
								Compare
							</Link>
						</Button>
					</div>
				</div>
			</div>

			<div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
				<div className="text-center mb-4">
					<h2 className="text-2xl font-semibold mb-2">Merge & Analysis</h2>
					<p className="text-muted-foreground">Upload original files, merge them, and analyze which rows were kept vs dropped.</p>
				</div>

			{error && (
				<div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive border border-destructive/20">
					<AlertCircle className="w-4 h-4 flex-shrink-0" />
					<span className="text-sm">{error}</span>
					<button onClick={() => setError(null)} className="ml-auto p-1 hover:bg-destructive/20 rounded">
						<X className="w-4 h-4" />
					</button>
				</div>
			)}

			{success && (
				<div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 text-green-700 border border-green-500/20">
					<CheckCircle className="w-4 h-4 flex-shrink-0" />
					<span className="text-sm">Merge complete and analysis finished! Check the results below.</span>
					<button onClick={() => setSuccess(false)} className="ml-auto p-1 hover:bg-green-500/20 rounded">
						<X className="w-4 h-4" />
					</button>
				</div>
			)}

			{/* File Upload - Collapsible */}
			<Collapsible defaultOpen={true}>
				<CollapsibleTrigger className="w-full">
					<div className="flex items-center gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer transition-colors">
						<ChevronDown className="w-5 h-5 transition-transform" />
						<FileSpreadsheet className="w-5 h-5 text-blue-500" />
						<div className="text-left">
							<p className="font-semibold">Original Files to Merge</p>
							<p className="text-sm text-muted-foreground">Upload the source Excel files that will be merged and analyzed</p>
						</div>
						{files.length > 0 && <Badge variant="secondary" className="ml-auto">{files.length} files</Badge>}
					</div>
				</CollapsibleTrigger>
				<CollapsibleContent className="mt-2">
					<Card>
						<CardContent className="pt-6">
							<div className={cn("border-2 border-dashed rounded-lg p-6 text-center transition-colors", dragOver && "border-blue-500 bg-blue-500/10", !dragOver && "border-muted-foreground/25 hover:border-muted-foreground/50")} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
								<Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
								<p className="text-sm text-muted-foreground mb-2">Drag and drop Excel files here, or</p>
								<label>
									<input type="file" multiple accept=".xls,.xlsx" className="hidden" onChange={handleFileInput} disabled={isProcessing} />
									<Button variant="outline" size="sm" asChild disabled={isProcessing}>
										<span>Browse Files</span>
									</Button>
								</label>
							</div>

							{files.length > 0 && (
								<div className="mt-4 space-y-2">
									<p className="text-sm font-medium">Selected Files ({files.length})</p>
									{files.map((file) => (
										<div key={file.id} className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm">
											<div className="flex items-center gap-2 min-w-0">
												<FileSpreadsheet className="w-4 h-4 text-blue-500 flex-shrink-0" />
												<span className="truncate">{file.name}</span>
												<Badge variant="secondary" className="text-[10px]">
													{(file.size / 1024).toFixed(1)} KB
												</Badge>
											</div>
											<button onClick={() => removeFile(file.id)} className="p-1 hover:bg-muted rounded flex-shrink-0">
												<X className="w-4 h-4" />
											</button>
										</div>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</CollapsibleContent>
			</Collapsible>

			{/* Merge & Analyze Button */}
			<div className="flex gap-2">
				<Button onClick={handleMergeAndAnalyze} disabled={files.length === 0 || isProcessing} className="flex-1" size="lg">
					{isProcessing ? "Processing..." : "Merge & Analyze"}
				</Button>
				<Button
					variant="outline"
					onClick={() => {
						setFiles([])
						setSuccess(false)
						setAllResults([])
					}}
					disabled={isProcessing}
				>
					Clear
				</Button>
			</div>

			{/* Results by Date - Accordion */}
			{allResults.length > 0 && (
				<div className="space-y-3">
					<div className="flex items-center justify-between">
						<h2 className="text-lg font-semibold">Merge Results</h2>
						{allResults.length > 1 && (
							<Button onClick={downloadAllFiles} variant="outline" size="sm" className="cursor-grab hover:text-inherit">
								<Download className="w-4 h-4 mr-2" />
								Download All
							</Button>
						)}
					</div>
					{allResults.map((result) => (
						<Collapsible key={result.date} defaultOpen={allResults.length === 1}>
							<CollapsibleTrigger className="w-full">
								<div className="flex items-center justify-between w-full p-4 rounded-lg border border-slate-200 cursor-pointer transition-colors">
									<div className="flex items-center gap-4">
										<ChevronDown className="w-5 h-5 transition-transform" />
										<div className="text-left">
											<p className="font-semibold">{result.date}</p>
											<p className="text-sm text-muted-foreground">{new Set(result.mergedRows.map((row) => String(row[3]))).size} files merged</p>
										</div>
									</div>
									<Badge variant="secondary">{result.mergedRows.length} rows</Badge>
								</div>
							</CollapsibleTrigger>
							<CollapsibleContent className="mt-2">
								<Card>
									<CardContent className="pt-6 space-y-4">
										{/* Validation Results - Collapsible */}
										{result.validations && result.validations.length > 0 && (
											<Collapsible defaultOpen={!result.validations.every((v) => v.passed)}>
												<CollapsibleTrigger className="w-full">
													<div className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 cursor-pointer transition-colors">
														<ChevronDown className="w-4 h-4 transition-transform" />
														<span className="font-semibold text-sm">Data Quality Checks</span>
														<Badge variant="secondary" className="ml-auto text-xs">
															{result.validations.filter((v) => v.passed).length}/{result.validations.length} passed
														</Badge>
													</div>
												</CollapsibleTrigger>
												<CollapsibleContent className="mt-2 ml-2 space-y-4">
													<ValidationPanel validations={result.validations} title="Data Quality Checks" defaultOpen={!result.validations.every((v) => v.passed)} />
													
													{/* Point Sample Intervals Table */}
													{result.validations.find((v) => v.check === "Point Sample Intervals")?.pointSampleIntervals && (
														(() => {
															const pointSampleValidation = result.validations.find((v) => v.check === "Point Sample Intervals")
															const intervals = pointSampleValidation?.pointSampleIntervals || []
															const filtered = intervals.filter((interval: any) => {
																if (pointSampleFilter === 'all') return true
																if (pointSampleFilter === 'passed') return interval.status === 'pass'
																if (pointSampleFilter === 'failed') return interval.status === 'fail'
																return true
															})

															return (
																<div className="border rounded-lg p-3">
																	<div className="flex items-center justify-between mb-3">
																		<h4 className="font-semibold text-sm">Point Sample Intervals</h4>
																		<div className="flex gap-2">
																			<Button
																				variant={pointSampleFilter === 'all' ? 'default' : 'outline'}
																				size="sm"
																				onClick={() => setPointSampleFilter('all')}
																				className="text-xs h-7"
																			>
																				All ({intervals.length})
																			</Button>
																			<Button
																				variant={pointSampleFilter === 'passed' ? 'default' : 'outline'}
																				size="sm"
																				onClick={() => setPointSampleFilter('passed')}
																				className="text-xs h-7 bg-green-600 hover:bg-green-700 text-white"
																			>
																				Passed ({intervals.filter((i: any) => i.status === 'pass').length})
																			</Button>
																			<Button
																				variant={pointSampleFilter === 'failed' ? 'default' : 'outline'}
																				size="sm"
																				onClick={() => setPointSampleFilter('failed')}
																				className="text-xs h-7 bg-red-600 hover:bg-red-700 text-white"
																			>
																				Failed ({intervals.filter((i: any) => i.status === 'fail').length})
																			</Button>
																		</div>
																	</div>

																	<div className="overflow-x-auto border rounded-lg max-h-96">
																		<table className="w-full text-xs">
																			<thead className="border-b sticky top-0 bg-slate-900 text-white">
																				<tr>
																					<th className="px-3 py-2 text-left font-semibold min-w-12">Row 1</th>
																					<th className="px-3 py-2 text-left font-semibold min-w-24">Time 1</th>
																					<th className="px-3 py-2 text-left font-semibold min-w-24">Y Data 1</th>
																					<th className="px-3 py-2 text-left font-semibold min-w-12">Row 2</th>
																					<th className="px-3 py-2 text-left font-semibold min-w-24">Time 2</th>
																					<th className="px-3 py-2 text-left font-semibold min-w-24">Y Data 2</th>
																					<th className="px-3 py-2 text-left font-semibold min-w-20">Duration (min)</th>
																					<th className="px-3 py-2 text-left font-semibold min-w-28">Valid (2-3 min)</th>
																				</tr>
																			</thead>
																			<tbody>
																				{filtered.map((interval: any, idx: number) => {
																					const data1 = interval.data1 || String(result.mergedRows[interval.row1 - 1]?.[2] || '')
																					const data2 = interval.data2 || String(result.mergedRows[interval.row2 - 1]?.[2] || '')
																					const intervalKey = `${interval.row1}-${interval.row2}`
																					const isFixed = fixedIntervals.has(intervalKey)
																					
																					return (
																					<tr
																						key={idx}
																						className={cn(
																							"border-b hover:bg-slate-100 transition-colors",
																							idx % 2 === 0 && "bg-white",
																							interval.status === 'pass' ? 'bg-green-50' : isFixed ? 'bg-yellow-50' : 'bg-red-100'
																						)}
																					>
																						<td className={cn("px-3 py-2 font-mono", interval.status === 'fail' && 'text-red-900', interval.status === 'pass' && 'text-muted-foreground')}>{interval.row1}</td>
																						<td className={cn("px-3 py-2 truncate", interval.status === 'fail' && 'text-red-900', interval.status === 'pass' && 'text-muted-foreground')}>{interval.time1}</td>
																						<td className={cn("px-3 py-2 truncate", interval.status === 'fail' && 'text-red-900', interval.status === 'pass' && 'text-gray-700')}>{data1}</td>
																						<td className={cn("px-3 py-2 font-mono", interval.status === 'fail' && 'text-red-900', interval.status === 'pass' && 'text-muted-foreground')}>{interval.row2}</td>
																						<td className={cn("px-3 py-2 truncate", interval.status === 'fail' && 'text-red-900', interval.status === 'pass' && 'text-muted-foreground')}>{interval.time2}</td>
																						<td className={cn("px-3 py-2 truncate", interval.status === 'fail' && 'text-red-900', interval.status === 'pass' && 'text-gray-700')}>{data2}</td>
																						<td className={cn("px-3 py-2 font-mono font-semibold", interval.status === 'fail' && 'text-red-900', interval.status === 'pass' && 'text-muted-foreground')}>{interval.intervalMin}</td>
																						<td className="px-3 py-2">
																							<div className="flex items-center gap-2">
																								{interval.status === 'pass' ? (
																									<Badge className="bg-green-600 text-white">✓ Pass</Badge>
																								) : (
																									<Badge className={isFixed ? "bg-yellow-600 text-white" : "bg-red-600 text-white"}>
																										{isFixed ? "✓ Fixed" : "✗ Fail"}
																									</Badge>
																								)}
																								{pointSampleFilter === 'failed' && interval.status === 'fail' && (
																									<input
																										type="checkbox"
																										checked={isFixed}
																										onChange={() => toggleIntervalFixed(intervalKey)}
																										className="w-4 h-4 cursor-pointer"
																									/>
																								)}
																							</div>
																						</td>
																					</tr>
																					)
																				})}
																			</tbody>
																		</table>
																	</div>

																	{filtered.length === 0 && (
																		<div className="text-center py-4 text-sm text-muted-foreground">
																			No intervals found for selected filter
																		</div>
																	)}
																</div>
															)
														})()
													)}
												</CollapsibleContent>
											</Collapsible>
										)}

										{/* Visualization */}
										{result.sourceFileBlocks.length > 0 && result.mergedRows.length > 0 && (
											<div className="space-y-2">
												<div className="p-3 rounded-lg border border-slate-200">
													<div className="flex items-center gap-2 mb-3">
														<span className="font-semibold text-sm">Source File Distribution</span>
														<Badge variant="secondary" className="text-xs">
															{new Set(result.sourceFileBlocks.map((b) => b.sourceFile)).size} files
														</Badge>
													</div>
													<SourceFileVisualizer
														blocks={result.sourceFileBlocks}
														mergedRowCount={result.analysis.totalMergedRows}
														mergedRows={result.mergedRows}
														selectedSourceFile={selectedSourceFile}
														onSelectSourceFile={setSelectedSourceFile}
													/>
												</div>
											</div>
										)}

										{/* Focal Follow Ranges Legends */}
										{(result.mergedFocalRanges.length > 0 || Array.from(result.originalFileFocalRanges.values()).some((r) => r.length > 0)) && (
											<div className="space-y-3">
												<h3 className="text-sm font-semibold">Focal Follow Ranges</h3>
												
												{/* Merged File Legend - Full Width */}
												<div>
													<FocalFollowLegend
														title="Merged File"
														ranges={result.mergedFocalRanges}
														colorMap={result.focalColorMap}
													/>
												</div>

												{/* Original Files Legends - Grid */}
												{Array.from(result.originalFileFocalRanges.entries()).length > 0 && (
													<div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
														{Array.from(result.originalFileFocalRanges.entries()).map(([fileName, ranges]) => (
															<FocalFollowLegend
																key={fileName}
																title={`Original: ${fileName}`}
																ranges={ranges}
																colorMap={result.focalColorMap}
															/>
														))}
													</div>
												)}
											</div>
										)}

										{/* Debug Info - Collapsible */}
										{(() => {
											const recon = reconstructionByDate[result.date]
											const reconstructionComparison = recon?.comparison
											const reconstructionDebugInfo = recon?.debugInfo
											return reconstructionDebugInfo && reconstructionDebugInfo.length > 0 && (
												<Collapsible defaultOpen={!reconstructionComparison?.every((r: any) => r.matches)}>
													<CollapsibleTrigger className="w-full">
														<div className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 cursor-pointer transition-colors">
															<ChevronDown className="w-4 h-4 transition-transform" />
															<span className="font-semibold text-sm">Reconstruction Debug Info</span>
															<Badge variant="secondary" className="ml-auto text-xs">
																{reconstructionDebugInfo.length} files
															</Badge>
														</div>
													</CollapsibleTrigger>
													<CollapsibleContent className="mt-2 ml-2">
														<div className="space-y-4">
															{reconstructionDebugInfo.map((debug: any) => (
																<div key={debug.fileName} className=" p-3 rounded-lg border border-slate-200">
																	<p className="font-semibold text-sm mb-3">{debug.fileName}</p>
																	
																	<div className="grid grid-cols-2 gap-4 text-xs mb-3">
																		<div>
																			<p className="font-semibold text-gray-700 mb-1">After Trim:</p>
																			<p className="text-gray-600">Original: <span className="font-mono font-bold">{debug.origTrimmedLength}</span> rows</p>
																			<p className="text-gray-600">Reconstructed: <span className="font-mono font-bold">{debug.reconTrimmedLength}</span> rows</p>
																			<p className="text-red-600 font-semibold mt-1">Difference: <span className="font-mono">{Math.abs(debug.origTrimmedLength - debug.reconTrimmedLength)}</span> rows</p>
																		</div>
																		<div>
																			<p className="font-semibold text-gray-700 mb-1">Before Trim:</p>
																			<p className="text-gray-600">Original: <span className="font-mono font-bold">{debug.lastOriginal10.length}</span> rows</p>
																			<p className="text-gray-600">Reconstructed: <span className="font-mono font-bold">{debug.lastReconstructed10.length}</span> rows</p>
																		</div>
																	</div>

																	<div className="space-y-3">
																		{debug.misalignedRows && debug.misalignedRows.length > 0 ? (
																			<div className="space-y-3">
																			{(() => {
																				const commentMisalignments: typeof debug.misalignedRows = []
																				const realMisalignments: typeof debug.misalignedRows = []

																				debug.misalignedRows.forEach((mismatch: any) => {
																					// Check if only difference is 4th column
																					const origHas4th = mismatch.original.length > 3
																					const reconHas4th = mismatch.reconstructed.length > 3
																					
																					if (origHas4th && !reconHas4th && mismatch.original.length === 4 && mismatch.reconstructed.length === 3) {
																						// Check if first 3 columns match
																						const first3Match = mismatch.original.slice(0, 3).every((val: any, i: number) => {
																							const origVal = formatIsoDate(excelDateToJSDate(typeof val === 'number' ? val : parseInt(String(val))))
																							const reconVal = String(mismatch.reconstructed[i])
																							return origVal === reconVal || val === mismatch.reconstructed[i]
																						})
																						
																						if (first3Match) {
																							commentMisalignments.push(mismatch)
																							return
																						}
																					}
																					
																					realMisalignments.push(mismatch)
																				})

																				return (
																					<>
																						{commentMisalignments.length > 0 && (
																							<Collapsible defaultOpen={true}>
																								<CollapsibleTrigger className="w-full">
																									<div className="flex items-center gap-2 p-2 rounded border border-yellow-300 cursor-pointer bg-yellow-50">
																										<ChevronDown className="w-3 h-3 transition-transform" />
																										<span className="text-xs font-semibold text-yellow-900">⚠️ Column Mismatch - Extra Columns ({commentMisalignments.length})</span>
																									</div>
																								</CollapsibleTrigger>
																								<CollapsibleContent className="mt-2">
																									<div className="p-2 rounded border border-yellow-300 space-y-2 max-h-96 overflow-y-auto bg-yellow-50">
																										<div className="text-xs text-yellow-900 mb-2 p-2 rounded bg-yellow-100">
																											<p className="font-semibold mb-1">ℹ️ These rows match on the first 3 columns but the original has extra comment columns (4th column) that are not in the reconstructed file.</p>
																										</div>
																										{commentMisalignments.map((mismatch: any, idx: number) => {
																											const formatDisplayValue = (val: any): any => {
																												if (typeof val === 'number' && val > 1000 && val < 50000) {
																													return formatIsoDate(excelDateToJSDate(val))
																												}
																												return val
																											}

																											return (
																												<div key={idx} className="border border-yellow-400 rounded p-2 bg-white">
																													<div className="font-semibold text-xs text-yellow-900 mb-2">Row {mismatch.rowIdx}</div>
																													<div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
																														<div>
																															<div className="font-semibold text-gray-700 mb-1">Original File:</div>
																															<div className="text-gray-700 bg-orange-50 p-2 rounded break-all border-l-4 border-orange-400">
																																[ {mismatch.original.slice(0, 3).map((v: any, i: number) => (
																																	<span key={i}>{i > 0 ? ', ' : ''}{JSON.stringify(formatDisplayValue(v))}</span>
																																))}<span className="bg-orange-200 px-1 rounded"> {JSON.stringify(mismatch.original[3])} </span>]
																															</div>
																														</div>
																														<div>
																															<div className="font-semibold text-gray-700 mb-1">Reconstructed File:</div>
																															<div className="text-gray-700 bg-blue-50 p-2 rounded break-all border-l-4 border-blue-400">
																																[ {mismatch.reconstructed.map((v: any, i: number) => (
																																	<span key={i}>{i > 0 ? ', ' : ''}{JSON.stringify(v)}</span>
																																))} ]
																															</div>
																														</div>
																													</div>
																												</div>
																											)
																										})}
																									</div>
																								</CollapsibleContent>
																							</Collapsible>
																						)}
																						
																						{realMisalignments.length > 0 && (
																							<Collapsible defaultOpen={true}>
																								<CollapsibleTrigger className="w-full">
																									<div className="flex items-center gap-2 p-2 rounded border border-red-300 cursor-pointer bg-red-50">
																										<ChevronDown className="w-3 h-3 transition-transform" />
																										<span className="text-xs font-semibold text-red-900">Actual Data Mismatches ({realMisalignments.length})</span>
																									</div>
																								</CollapsibleTrigger>
																								<CollapsibleContent className="mt-2">
																									<div className="p-2 rounded border border-red-300 space-y-2 max-h-96 overflow-y-auto bg-red-50">
																										{realMisalignments.map((mismatch: any, idx: number) => {
																											const formatDisplayValue = (val: any): any => {
																												if (typeof val === 'number' && val > 1000 && val < 50000) {
																													return formatIsoDate(excelDateToJSDate(val))
																												}
																												return val
																											}

																											return (
																												<div key={idx} className="border border-red-400 rounded p-2 bg-white">
																													<div className="font-semibold text-xs text-red-900 mb-2">Row {mismatch.rowIdx}</div>
																													<div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
																														<div>
																															<div className="font-semibold text-gray-700 mb-1">Original File:</div>
																															<div className="text-gray-700 bg-red-50 p-2 rounded break-all border-l-4 border-red-400">
																																[ {mismatch.original.map((v: any, i: number) => (
																																	<span key={i}>{i > 0 ? ', ' : ''}{JSON.stringify(formatDisplayValue(v))}</span>
																																))} ]
																															</div>
																														</div>
																														<div>
																															<div className="font-semibold text-gray-700 mb-1">Reconstructed File:</div>
																															<div className="text-gray-700 bg-blue-50 p-2 rounded break-all border-l-4 border-blue-400">
																																[ {mismatch.reconstructed.map((v: any, i: number) => (
																																	<span key={i}>{i > 0 ? ', ' : ''}{JSON.stringify(v)}</span>
																																))} ]
																															</div>
																														</div>
																													</div>
																												</div>
																											)
																										})}
																									</div>
																								</CollapsibleContent>
																							</Collapsible>
																						)}
																					</>
																				)
																			})()}
																		</div>
																	) : (
																		<div className="p-2 rounded border border-green-300 bg-green-50 text-xs text-green-900">
																			✓ No misaligned rows found
																		</div>
																	)}
																</div>
															</div>
														))}
													</div>
												</CollapsibleContent>
											</Collapsible>
										)
										})()}

										{/* Downloads & Verification */}
										<div className="bg-green-500/5 border border-green-500/20 rounded-lg p-4 space-y-4">
											<div className="flex items-center justify-between p-3 rounded-lg border border-slate-200">
												<span className="font-semibold text-sm">Downloads & Verification</span>

												{/* Overall status (green only if EVERYTHING matches) */}
												{(() => {
													const recon = reconstructionByDate[result.date]
													const reconstructionComparison = recon?.comparison
													return reconstructionComparison && reconstructionComparison.length > 0 && (
														<Badge
															variant="secondary"
															className={cn(
																"text-xs",
																reconstructionComparison.every((r: any) => r.matches) ? "bg-green-500/15 text-green-800" : "bg-red-500/15 text-red-800"
															)}
														>
															{reconstructionComparison.every((r: any) => r.matches) ? "✅ Reconstruction Verified" : "❌ Reconstruction Issues"}
														</Badge>
													)
												})()}
											</div>

											{/* Merged Files */}
											<div>
												<h4 className="text-sm font-semibold mb-2">Merged Files</h4>
												<div className="grid grid-cols-2 gap-3">
													<div>
														<p className="text-xs font-medium mb-2">Standard Version</p>
														<Button
															onClick={() => downloadFile(result.date, "standard")}
															variant="outline"
															size="sm"
															className="w-full cursor-grab hover:text-inherit"
														>
															<Download className="w-4 h-4 mr-2" />
															Download
														</Button>
													</div>
													<div>
														<p className="text-xs font-medium mb-2">With Metadata</p>
														<Button
															onClick={() => downloadFile(result.date, "withMetadata")}
															variant="outline"
															size="sm"
															className="w-full cursor-grab hover:text-inherit"
														>
															<Download className="w-4 h-4 mr-2" />
															Download
														</Button>
													</div>
												</div>
											</div>

											{/* Excluded Rows */}
											{result.droppedRows && result.droppedRows.length > 1 && (
												<div className="border-t pt-3">
													<h4 className="text-sm font-semibold mb-2">
														Excluded Rows <span className="text-xs text-muted-foreground font-normal">({result.droppedRows.length - 1} rows)</span>
													</h4>
													<p className="text-xs text-muted-foreground mb-3">
														Download the {result.droppedRows.length - 1} rows that were excluded from the merge
													</p>
													<Button
														onClick={() => downloadDroppedRows(result.date)}
														variant="outline"
														size="sm"
														className="w-full cursor-grab hover:text-inherit"
													>
														<Download className="w-4 h-4 mr-2" />
														Download Excluded Rows
													</Button>
												</div>
											)}

											{/* Reconstruction Verification (NO DOWNLOADS) */}
											<div className="border-t pt-3 space-y-3">
												<div className="flex items-start justify-between gap-3">
													<div>
														<h4 className="text-sm font-semibold">Reconstructed vs Original Verification</h4>
														<p className="text-xs text-muted-foreground">
															Runs reconstruction + integrity checks without downloading reconstructed files. Shows first/last 10 rows as tables.
														</p>
													</div>

													<div className="flex gap-2 shrink-0">
														<Button
															onClick={() => downloadReconstructedFilesOnly(result.date)}
															variant="outline"
															size="sm"
															disabled={originalFileData.length === 0}
														>
															<Download className="w-4 h-4 mr-2" />
															Download
														</Button>
													</div>
												</div>


											</div>
										</div>
											</CardContent>
										</Card>
									</CollapsibleContent>
								</Collapsible>
					))}
				</div>
			)}
		</div>
		</div>
	)
}
