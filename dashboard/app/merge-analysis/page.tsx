"use client"

import {useState, useMemo} from "react"
import {Upload, FileSpreadsheet, X, AlertCircle, CheckCircle, Download} from "lucide-react"
import {Button} from "@/components/ui/button"
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card"
import {Badge} from "@/components/ui/badge"
import {cn} from "@/lib/utils"
import * as XLSX from "xlsx"
import type {DataRow, DiffAnalysis} from "@/lib/types"

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

// Helper function to convert merge analysis to DiffAnalysis
function convertToDiffAnalysis(analysis: MergeAnalysis, now: Date): DiffAnalysis {
	const today = new Date().toISOString().split("T")[0]
	const displayDate = new Date().toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	})

	return {
		date: today,
		displayDate,
		analyzedAt: now,
		originalFiles: analysis.originalFiles.map((file) => ({
			fileIndex: file.fileIndex,
			fileName: file.fileName,
			totalRows: file.totalRows,
			keptRows: file.keptRows,
			excludedRows: file.droppedRows,
			timestampModifications: 0,
			rows: [
				...file.keptIndices.map((idx, pos) => ({
					originalRowIndex: idx,
					sourceFileName: file.fileName,
					sourceFileIndex: file.fileIndex,
					subject: "",
					originalTimestamp: "",
					behavior: "",
					status: "kept" as const,
					mergedRowIndex: pos,
					timestampModified: false,
				})),
				...file.droppedIndices.map((idx) => ({
					originalRowIndex: idx,
					sourceFileName: file.fileName,
					sourceFileIndex: file.fileIndex,
					subject: "",
					originalTimestamp: "",
					behavior: "",
					status: "excluded" as const,
					mergedRowIndex: undefined,
					timestampModified: false,
				})),
			] as any[],
		})),
		mergedFile: {
			fileName: "merged_file.xls",
			totalRows: analysis.totalMergedRows,
		},
		totalOriginalRows: analysis.totalOriginalRows,
		totalKept: analysis.totalOriginalRows - (analysis.totalOriginalRows - analysis.totalMergedRows),
		totalExcluded: analysis.totalOriginalRows - analysis.totalMergedRows,
		totalTimestampModifications: 0,
	}
}

export default function MergeAnalysisPage() {
	const [files, setFiles] = useState<UploadedFile[]>([])
	const [error, setError] = useState<string | null>(null)
	const [success, setSuccess] = useState(false)
	const [dragOver, setDragOver] = useState(false)
	const [analysis, setAnalysis] = useState<MergeAnalysis | null>(null)
	const [isProcessing, setIsProcessing] = useState(false)
	const [mergedMetadata, setMergedMetadata] = useState<any>({standard: "", metadata: ""})
	const [mergedRowsData, setMergedRowsData] = useState<any[][]>([])
	const [sourceFileBlocks, setSourceFileBlocks] = useState<SourceFileBlock[]>([])
	const [droppedRowsData, setDroppedRowsData] = useState<any[][] | null>(null)
	const [selectedSourceFile, setSelectedSourceFile] = useState<string | null>(null)

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

	const downloadFile = async (version: "standard" | "withMetadata") => {
		try {
			if (!mergedMetadata || typeof mergedMetadata !== "object" || !("standard" in mergedMetadata)) {
				setError("Merged file data not available")
				return
			}

			// Extract date from first uploaded file name
			let datePrefix = new Date().toISOString().split("T")[0].replace(/-/g, ".")
			if (files.length > 0) {
				const firstFileName = files[0].name
				const dateMatch = firstFileName.match(/(\d{4}\.\d{2}\.\d{2})/)
				if (dateMatch) {
					datePrefix = dateMatch[1]
				}
			}

			const base64Data = version === "standard" ? (mergedMetadata as any).standard : (mergedMetadata as any).metadata

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
			a.download = version === "standard" ? `${datePrefix}-merged.xls` : `${datePrefix}-merged-with-metadata.xls`
			document.body.appendChild(a)
			a.click()
			window.URL.revokeObjectURL(url)
			document.body.removeChild(a)
		} catch (err) {
			setError("Failed to download file")
		}
	}

	const downloadDroppedRows = () => {
		try {
			if (!droppedRowsData || droppedRowsData.length === 0) {
				setError("No dropped rows to download")
				return
			}

			// Extract date from first uploaded file name
			let datePrefix = new Date().toISOString().split("T")[0].replace(/-/g, ".")
			if (files.length > 0) {
				const firstFileName = files[0].name
				const dateMatch = firstFileName.match(/(\d{4}\.\d{2}\.\d{2})/)
				if (dateMatch) {
					datePrefix = dateMatch[1]
				}
			}

			// Create a new workbook with the dropped rows
			const worksheet = XLSX.utils.aoa_to_sheet(droppedRowsData)
			const workbook = XLSX.utils.book_new()
			XLSX.utils.book_append_sheet(workbook, worksheet, "Dropped Rows")

			// Download the file
			XLSX.writeFile(workbook, `${datePrefix}-dropped-rows.xls`)
		} catch (err) {
			setError("Failed to download dropped rows file")
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

			// Step 3: Use the first result (for the primary date)
			if (!mergeData.results || mergeData.results.length === 0) {
				throw new Error("No merge results returned")
			}

			const primaryResult = mergeData.results[0]

			// Decode the metadata buffer from base64
			const metaBufBase64 = primaryResult.withMetadataBase64
			const binaryString = atob(metaBufBase64)
			const bytes = new Uint8Array(binaryString.length)
			for (let i = 0; i < binaryString.length; i++) {
				bytes[i] = binaryString.charCodeAt(i)
			}
			const mergedBuffer = bytes.buffer as ArrayBuffer
			const mergedRows = parseExcelFile(Buffer.from(mergedBuffer))

			// Step 4: Build source map from merged file
			const sourceMap = new Map<string, Set<number>>()

			for (let i = 0; i < mergedRows.length; i++) {
				const row = mergedRows[i]
				if (row.length >= 5) {
					const sourceFile = String(row[3])
					const originalRowNum = row[4]
					const key = `${sourceFile}|${originalRowNum}`
					sourceMap.set(key, new Set([i]))
				}
			}

			// Step 5: Analyze each original file
			const analysisResults = originalData.map((data, fileIdx) => {
				const keptIndices: number[] = []
				const droppedIndices: number[] = []

				for (let rowIdx = 0; rowIdx < data.rows.length; rowIdx++) {
					const key = `${data.fileName}|${rowIdx}`
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

			setAnalysis(mergeAnalysis)
			setMergedRowsData(mergedRows)

			// Step 6: Build source file blocks visualization data
			const blocks: SourceFileBlock[] = []
			let currentFile: string | null = null
			let blockStart = 0
			let blockStartTimestamp = ""

			for (let i = 0; i < mergedRows.length; i++) {
				const row = mergedRows[i]
				const sourceFile = String(row[3] || "")
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

			setSourceFileBlocks(blocks)

			// Step 7: Build dropped rows data for export
			const droppedRows: any[][] = [["Row Data (Author)", "DateTime", "Data", "Source File", "Original Row Number"]]

			analysisResults.forEach((fileAnalysis) => {
				const originalFile = originalData[fileAnalysis.fileIndex]
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

			setDroppedRowsData(droppedRows)

			// Store the base64 buffers for download
			setMergedMetadata({
				standard: primaryResult.standardBase64,
				metadata: primaryResult.withMetadataBase64,
			})

			setSuccess(true)
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to process files")
		} finally {
			setIsProcessing(false)
		}
	}

	return (
		<div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
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

			{/* File Upload */}
			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="text-base flex items-center gap-2">
						<FileSpreadsheet className="w-5 h-5 text-blue-500" />
						Original Files to Merge
					</CardTitle>
					<CardDescription>Upload the source Excel files that will be merged and analyzed</CardDescription>
				</CardHeader>
				<CardContent>
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
						setAnalysis(null)
					}}
					disabled={isProcessing}
				>
					Clear
				</Button>
			</div>

			{/* Analysis Results */}
			{analysis && (
				<Card>
					<CardHeader>
						<CardTitle>Merge Analysis Results</CardTitle>
						<CardDescription>Visual breakdown of which source files appear in the merged output</CardDescription>
					</CardHeader>
					<CardContent>{sourceFileBlocks.length > 0 && mergedRowsData.length > 0 && <SourceFileVisualizer blocks={sourceFileBlocks} mergedRowCount={analysis.totalMergedRows} mergedRows={mergedRowsData} selectedSourceFile={selectedSourceFile} onSelectSourceFile={setSelectedSourceFile} />}</CardContent>
				</Card>
			)}

			{/* Download Section */}
			{analysis && (
				<Card className="bg-green-500/5 border-green-500/20">
					<CardHeader className="pb-3">
						<CardTitle className="text-base">Download Merged Files</CardTitle>
						<CardDescription>Download the final merged output in two formats</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="grid grid-cols-2 gap-3 mb-4">
							<div className="p-3 rounded-lg border border-green-500/20">
								<div className="mb-3">
									<p className="font-medium text-sm">Standard Version</p>
									<p className="text-xs text-muted-foreground">Without metadata</p>
								</div>
								<Button onClick={() => downloadFile("standard")} variant="outline" size="sm" className="w-full">
									<Download className="w-4 h-4 mr-2" />
									Download
								</Button>
							</div>

							<div className="p-3 rounded-lg border border-green-500/20">
								<div className="mb-3">
									<p className="font-medium text-sm">With Metadata</p>
									<p className="text-xs text-muted-foreground">Includes source file info</p>
								</div>
								<Button onClick={() => downloadFile("withMetadata")} variant="outline" size="sm" className="w-full">
									<Download className="w-4 h-4 mr-2" />
									Download
								</Button>
							</div>
						</div>

						{droppedRowsData && droppedRowsData.length > 1 && (
							<>
								<div className="border-t pt-4 mt-4">
									<h3 className="text-sm font-semibold mb-3">Excluded Rows</h3>
									<p className="text-xs text-muted-foreground mb-3">Download the {droppedRowsData.length - 1} rows that were excluded from the merge</p>
									<Button onClick={downloadDroppedRows} variant="outline" size="sm" className="w-full">
										<Download className="w-4 h-4 mr-2" />
										Download Excluded Rows
									</Button>
								</div>
							</>
						)}
					</CardContent>
				</Card>
			)}
		</div>
	)
}
