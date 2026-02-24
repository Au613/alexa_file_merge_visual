"use client"

import {useState} from "react"
import Link from "next/link"
import {Upload, FileSpreadsheet, ChevronDown, CheckCircle, AlertCircle, GitCompare} from "lucide-react"
import * as XLSX from "xlsx"
import {Button} from "@/components/ui/button"
import {Card, CardContent} from "@/components/ui/card"
import {Badge} from "@/components/ui/badge"
import {Collapsible, CollapsibleTrigger, CollapsibleContent} from "@/components/ui/collapsible"
import {cn} from "@/lib/utils"
import {checkPointSampleIntervals} from "@/lib/validators"
import {Navigation} from "@/components/Navigation"

interface UploadedFile {
	id: string
	name: string
	size: number
	file: File
}

function excelDateToJSDate(serial: number): Date {
	const utcDays = Math.floor(serial - 25569)
	const utcValue = utcDays * 86400
	const fractionalDay = serial - Math.floor(serial) + 0.0000001
	const totalSeconds = Math.floor(86400 * fractionalDay)
	return new Date((utcValue + totalSeconds) * 1000)
}

function normalizeDateCell(v: any): string {
	if (v == null || v === "") return ""
	if (typeof v === "number" && Number.isFinite(v)) {
		return excelDateToJSDate(v).toISOString()
	}
	return String(v).trim()
}

function normalizeRowsForValidation(rows: any[][]): any[][] {
	return rows.map((row) => {
		const out = Array.isArray(row) ? [...row] : []
		if (out.length > 1) {
			out[1] = normalizeDateCell(out[1])
		}
		return out
	})
}

export default function PointSamplePage() {
	const [file, setFile] = useState<UploadedFile | null>(null)
	const [dragOver, setDragOver] = useState(false)
	const [isProcessing, setIsProcessing] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [pointSampleFilter, setPointSampleFilter] = useState<"all" | "passed" | "failed">("all")
	const [intervals, setIntervals] = useState<
		Array<{
			row1: number
			row2: number
			time1: string
			time2: string
			data1: string
			data2: string
			intervalMin: number
			status: "pass" | "fail"
		}>
	>([])
	const [issues, setIssues] = useState<string[]>([])
	const [warnings, setWarnings] = useState<string[]>([])
	const [passed, setPassed] = useState<boolean | null>(null)
	const [rows, setRows] = useState<any[][]>([])
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
		const excelFile = newFiles.find((f) => f.name.endsWith(".xls") || f.name.endsWith(".xlsx"))

		if (!excelFile) {
			setError("Please upload a .xls or .xlsx file.")
			return
		}

		setError(null)
		setFile({
			id: Math.random().toString(36).substring(2),
			name: excelFile.name,
			size: excelFile.size,
			file: excelFile,
		})
	}

	const parseExcelFile = (buffer: ArrayBuffer): any[][] => {
		const workbook = XLSX.read(buffer, {type: "array"})
		const sheetName = workbook.SheetNames[0]
		const worksheet = workbook.Sheets[sheetName]
		return XLSX.utils.sheet_to_json(worksheet, {header: 1}) as any[][]
	}

	const runPointSampleCheck = async () => {
		if (!file) return

		setIsProcessing(true)
		setError(null)

		try {
			const buffer = await file.file.arrayBuffer()
			const rawRows = parseExcelFile(buffer)
			const normalizedRows = normalizeRowsForValidation(rawRows)
			setRows(normalizedRows)

			const validation = checkPointSampleIntervals(normalizedRows)
			setIntervals(validation.pointSampleIntervals || [])
			setIssues(validation.issues)
			setWarnings(validation.warnings)
			setPassed(validation.passed)
		} catch (err) {
			console.error(err)
			setError("Failed to analyze the file.")
		} finally {
			setIsProcessing(false)
		}
	}

	const filteredIntervals = intervals.filter((interval) => {
		if (pointSampleFilter === "all") return true
		if (pointSampleFilter === "passed") return interval.status === "pass"
		if (pointSampleFilter === "failed") return interval.status === "fail"
		return true
	})

	return (
		<div className="flex flex-col min-h-screen gap-6">
			<Navigation />

			<div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
				<div className="text-center mb-4">
					<h2 className="text-2xl font-semibold mb-2">Point Sample Check</h2>
					<p className="text-muted-foreground">Upload a single file to validate point sample intervals.</p>
				</div>

				<Collapsible defaultOpen={true}>
					<CollapsibleTrigger className="w-full">
						<div className="flex items-center gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer transition-colors">
							<ChevronDown className="w-5 h-5 transition-transform" />
							<FileSpreadsheet className="w-5 h-5 text-blue-500" />
							<div className="text-left">
								<p className="font-semibold">Single File Upload</p>
								<p className="text-sm text-muted-foreground">Upload a source Excel file to check point sample intervals</p>
							</div>
							{file && <Badge variant="secondary" className="ml-auto">1 file</Badge>}
						</div>
					</CollapsibleTrigger>
					<CollapsibleContent className="mt-2">
						<Card>
							<CardContent className="pt-6">
								<div
									className={cn(
										"border-2 border-dashed rounded-lg p-6 text-center transition-colors",
										dragOver && "border-blue-500 bg-blue-500/10",
										!dragOver && "border-muted-foreground/25 hover:border-muted-foreground/50"
									)}
									onDrop={handleDrop}
									onDragOver={handleDragOver}
									onDragLeave={handleDragLeave}
								>
									<Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
									<p className="text-sm text-muted-foreground mb-2">Drag and drop an Excel file here, or</p>
									<label>
										<input type="file" accept=".xls,.xlsx" className="hidden" onChange={handleFileInput} disabled={isProcessing} />
										<Button variant="outline" size="sm" asChild disabled={isProcessing} className="hover:text-inherit">
											<span>Browse File</span>
										</Button>
									</label>
								</div>

								{file && (
									<div className="mt-4 space-y-2">
										<p className="text-sm font-medium">Selected File</p>
										<div className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm">
											<div className="flex items-center gap-2 min-w-0">
												<FileSpreadsheet className="w-4 h-4 text-blue-500 flex-shrink-0" />
												<span className="truncate">{file.name}</span>
												<Badge variant="secondary" className="text-[10px]">
													{(file.size / 1024).toFixed(1)} KB
												</Badge>
											</div>
											<Button
												variant="outline"
												size="sm"
												onClick={() => {
													setFile(null)
													setIntervals([])
													setIssues([])
													setWarnings([])
													setPassed(null)
												setRows([])
												setFixedIntervals(new Set())
											}}
											>
												Remove
											</Button>
										</div>
									</div>
								)}
							</CardContent>
						</Card>
					</CollapsibleContent>
				</Collapsible>

				<div className="flex gap-2">
					<Button onClick={runPointSampleCheck} disabled={!file || isProcessing} className="flex-1" size="lg">
						{isProcessing ? "Checking..." : "Run Point Sample Check"}
					</Button>
					<Button
						variant="outline"
						onClick={() => {
							setFile(null)
							setIntervals([])
							setIssues([])
							setWarnings([])
							setPassed(null)
							setRows([])
							setError(null)
							setFixedIntervals(new Set())
						}}
						disabled={isProcessing}
						className="hover:text-inherit"
					>
						Clear
					</Button>
				</div>

				{error && (
					<div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive border border-destructive/20">
						<AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
						<div className="text-sm">{error}</div>
					</div>
				)}

				{passed !== null && (
					<div className="space-y-4">
						<div className="flex items-center justify-between p-3 rounded-lg border border-slate-200">
							<span className="font-semibold text-sm">Point Sample Results</span>
							<Badge
								variant="secondary"
								className={cn("text-xs", passed ? "bg-green-500/15 text-green-800" : "bg-red-500/15 text-red-800")}
							>
								{passed ? "✅ Passed" : "❌ Issues Found"}
							</Badge>
						</div>

						{issues.length > 0 && (
							<div className="p-3 rounded-lg border border-red-300 bg-red-50 text-sm">
								<p className="font-semibold text-red-900 mb-2">Issues</p>
								<ul className="list-disc list-inside space-y-1 text-red-900">
									{issues.map((issue, idx) => (
										<li key={idx}>{issue}</li>
									))}
								</ul>
							</div>
						)}

						{warnings.length > 0 && (
							<div className="p-3 rounded-lg border border-yellow-300 bg-yellow-50 text-sm">
								<p className="font-semibold text-yellow-900 mb-2">Warnings</p>
								<ul className="list-disc list-inside space-y-1 text-yellow-900">
									{warnings.map((warning, idx) => (
										<li key={idx}>{warning}</li>
									))}
								</ul>
							</div>
						)}

						<div className="border rounded-lg p-3">
							<div className="flex items-center justify-between mb-3">
								<h4 className="font-semibold text-sm">Point Sample Intervals</h4>
								<div className="flex gap-2">
									<Button
										variant={pointSampleFilter === "all" ? "default" : "outline"}
										size="sm"
										onClick={() => setPointSampleFilter("all")}
										className="text-xs h-7 hover:text-inherit"
									>
										All ({intervals.length})
									</Button>
									<Button
										variant={pointSampleFilter === "passed" ? "default" : "outline"}
										size="sm"
										onClick={() => setPointSampleFilter("passed")}
										className="text-xs h-7 bg-green-600 hover:bg-green-700 text-white hover:opacity-75 hover:text-inherit"
									>
										Passed ({intervals.filter((i) => i.status === "pass").length})
									</Button>
									<Button
										variant={pointSampleFilter === "failed" ? "default" : "outline"}
										size="sm"
										onClick={() => setPointSampleFilter("failed")}
										className="text-xs h-7 bg-red-600 hover:bg-red-700 text-white hover:opacity-75 hover:text-inherit"
									>
										Failed ({intervals.filter((i) => i.status === "fail").length})
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
										{filteredIntervals.map((interval, idx) => {
											const data1 = interval.data1 || String(rows[interval.row1 - 1]?.[2] || "")
											const data2 = interval.data2 || String(rows[interval.row2 - 1]?.[2] || "")
											const intervalKey = `${interval.row1}-${interval.row2}`
											const isFixed = fixedIntervals.has(intervalKey)

											return (
												<tr
													key={idx}
													className={cn(
														"border-b hover:bg-slate-100 transition-colors",
														idx % 2 === 0 && "bg-white",
														interval.status === "pass" ? "bg-green-50" : isFixed ? "bg-yellow-50" : "bg-red-100"
													)}
												>
													<td className={cn("px-3 py-2 font-mono", interval.status === "fail" && "text-red-900", interval.status === "pass" && "text-muted-foreground")}>{interval.row1}</td>
													<td className={cn("px-3 py-2 truncate", interval.status === "fail" && "text-red-900", interval.status === "pass" && "text-muted-foreground")}>{interval.time1}</td>
													<td className={cn("px-3 py-2 truncate", interval.status === "fail" && "text-red-900", interval.status === "pass" && "text-gray-700")}>{data1}</td>
													<td className={cn("px-3 py-2 font-mono", interval.status === "fail" && "text-red-900", interval.status === "pass" && "text-muted-foreground")}>{interval.row2}</td>
													<td className={cn("px-3 py-2 truncate", interval.status === "fail" && "text-red-900", interval.status === "pass" && "text-muted-foreground")}>{interval.time2}</td>
													<td className={cn("px-3 py-2 truncate", interval.status === "fail" && "text-red-900", interval.status === "pass" && "text-gray-700")}>{data2}</td>
													<td className={cn("px-3 py-2 font-mono font-semibold", interval.status === "fail" && "text-red-900", interval.status === "pass" && "text-muted-foreground")}>{interval.intervalMin}</td>
													<td className="px-3 py-2">
														<div className="flex items-center gap-2">
															{interval.status === "pass" ? (
																<Badge className="bg-green-600 text-white">✓ Pass</Badge>
															) : (
																<Badge className={isFixed ? "bg-yellow-600 text-white" : "bg-red-600 text-white"}>
																	{isFixed ? "✓ Fixed" : "✗ Fail"}
																</Badge>
															)}
															{pointSampleFilter === "failed" && interval.status === "fail" && (
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

							{filteredIntervals.length === 0 && (
								<div className="text-center py-4 text-sm text-muted-foreground">
									No intervals found for selected filter
								</div>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
