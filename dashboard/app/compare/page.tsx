"use client"

import { useState, useRef } from "react"
import Link from "next/link"
import { Upload, Download, X, AlertCircle, CheckCircle, FileSpreadsheet, GitCompare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import * as XLSX from "xlsx"

interface FileData {
	name: string
	rows: any[][]
}

interface RowComparison {
	oldRowIdx: number | null
	newRowIdx: number | null
	timestamp: string
	tsMs: number
	oldData: any[]
	newData: any[]
	status: 'unchanged' | 'added' | 'deleted' | 'modified'
	selected: 'old' | 'new'
}

export default function Compare() {
	const [oldFile, setOldFile] = useState<FileData | null>(null)
	const [newFile, setNewFile] = useState<FileData | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [success, setSuccess] = useState(false)
	const [isProcessing, setIsProcessing] = useState(false)
	const [comparisons, setComparisons] = useState<RowComparison[]>([])
	const [showOnlyDifferences, setShowOnlyDifferences] = useState(false)
	const oldTableRef = useRef<HTMLDivElement>(null)
	const newTableRef = useRef<HTMLDivElement>(null)

	const parseMDYTime = (ts: string): number => {
		const s = (ts || "").trim()
		const parts = s.split(/\s+/)
		if (parts.length < 2) return Number.POSITIVE_INFINITY
		
		const [mdy, hms] = parts
		const mdy_parts = mdy.split("/").map(Number)
		const hms_parts = hms.split(":").map(Number)
		
		if (mdy_parts.length < 3 || hms_parts.length < 2) return Number.POSITIVE_INFINITY
		
		const [mm, dd, yyyy] = mdy_parts
		const [hh, mi, ss] = [hms_parts[0], hms_parts[1], hms_parts[2] || 0]
		
		if (
			!Number.isFinite(mm) || !Number.isFinite(dd) || !Number.isFinite(yyyy) ||
			!Number.isFinite(hh) || !Number.isFinite(mi)
		) return Number.POSITIVE_INFINITY
		
		return new Date(yyyy, mm - 1, dd, hh, mi, ss).getTime()
	}

	const parseExcelFile = (buffer: Buffer): any[][] => {
		const workbook = XLSX.read(buffer, { type: "buffer" })
		const sheetName = workbook.SheetNames[0]
		const worksheet = workbook.Sheets[sheetName]
		const allRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][]
		
		// Filter out rows that are completely empty
		const filtered = allRows.filter(row => row.some(cell => cell != null && cell !== ''))
		console.log('Parsed rows:', filtered.slice(0, 5))
		console.log('Total rows:', filtered.length)
		return filtered
	}

	const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, type: 'old' | 'new') => {
		const file = e.target.files?.[0]
		if (!file) return

		try {
			const buffer = await file.arrayBuffer()
			const rows = parseExcelFile(Buffer.from(buffer))
			
			if (type === 'old') {
				setOldFile({ name: file.name, rows })
			} else {
				setNewFile({ name: file.name, rows })
			}
			setError(null)
		} catch (err) {
			setError(`Failed to parse ${type} file: ${err instanceof Error ? err.message : 'Unknown error'}`)
		}
	}

	const runComparison = () => {
		if (!oldFile || !newFile) {
			setError("Both old and new files must be uploaded")
			return
		}

		setIsProcessing(true)
		try {
			console.log('Old file rows:', oldFile.rows.slice(0, 5))
			console.log('New file rows:', newFile.rows.slice(0, 5))
			
			const oldMap = new Map<string, { idx: number; row: any[] }>()
			const newMap = new Map<string, { idx: number; row: any[] }>()

			oldFile.rows.forEach((row, idx) => {
				const timestamp = String(row[1] || "")
				if (timestamp) {
					oldMap.set(timestamp, { idx, row })
				}
			})

			newFile.rows.forEach((row, idx) => {
				const timestamp = String(row[1] || "")
				if (timestamp) {
					newMap.set(timestamp, { idx, row })
				}
			})

			const comparisonResults: RowComparison[] = []
			const processedTimestamps = new Set<string>()

			oldFile.rows.forEach((row, idx) => {
				const timestamp = String(row[1] || "")
				if (!timestamp) return

				processedTimestamps.add(timestamp)
				const newRow = newMap.get(timestamp)

				if (!newRow) {
					const tsMs = parseMDYTime(timestamp)
					comparisonResults.push({
						oldRowIdx: idx,
						newRowIdx: null,
						timestamp,
						tsMs,
						oldData: row,
						newData: [],
						status: 'deleted',
						selected: 'old',
					})
				} else {
					const oldDataStr = JSON.stringify(row)
					const newDataStr = JSON.stringify(newRow.row)
					const isModified = oldDataStr !== newDataStr
					const tsMs = parseMDYTime(timestamp)

					comparisonResults.push({
						oldRowIdx: idx,
						newRowIdx: newRow.idx,
						timestamp,
						tsMs,
						oldData: row,
						newData: newRow.row,
						status: isModified ? 'modified' : 'unchanged',
						selected: isModified ? 'new' : 'old',
					})
				}
			})

			newFile.rows.forEach((row, idx) => {
				const timestamp = String(row[1] || "")
				if (!timestamp || processedTimestamps.has(timestamp)) return

				const tsMs = parseMDYTime(timestamp)
				comparisonResults.push({
					oldRowIdx: null,
					newRowIdx: idx,
					timestamp,
					tsMs,
					oldData: [],
					newData: row,
					status: 'added',
					selected: 'new',
				})
			})

			comparisonResults.sort((a, b) => a.tsMs - b.tsMs)

			setComparisons(comparisonResults)
			setSuccess(true)
		} catch (err) {
			setError(`Comparison failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
		} finally {
			setIsProcessing(false)
		}
	}

	const downloadResult = () => {
		try {
			const resultRows: any[][] = []

			comparisons.forEach((comp) => {
				if (comp.status === 'deleted' && comp.selected === 'old') {
					resultRows.push(comp.oldData)
				} else if (comp.status === 'added' && comp.selected === 'new') {
					resultRows.push(comp.newData)
				} else if (comp.status === 'modified') {
					resultRows.push(comp.selected === 'old' ? comp.oldData : comp.newData)
				} else if (comp.status === 'unchanged') {
					resultRows.push(comp.oldData)
				}
			})

			const worksheet = XLSX.utils.aoa_to_sheet(resultRows)
			const workbook = XLSX.utils.book_new()
			XLSX.utils.book_append_sheet(workbook, worksheet, "Merged")
			XLSX.writeFile(workbook, "merged-comparison-result.xlsx")
		} catch (err) {
			setError("Failed to download result file")
		}
	}

	const stats = {
		added: comparisons.filter((c) => c.status === 'added').length,
		deleted: comparisons.filter((c) => c.status === 'deleted').length,
		modified: comparisons.filter((c) => c.status === 'modified').length,
		unchanged: comparisons.filter((c) => c.status === 'unchanged').length,
	}

	const handleSyncScroll = (sourceRef: React.RefObject<HTMLDivElement | null>, targetRef: React.RefObject<HTMLDivElement | null>) => {
		return () => {
			if (sourceRef.current && targetRef.current) {
				targetRef.current.scrollTop = sourceRef.current.scrollTop
			}
		}
	}

	const filteredComparisons = showOnlyDifferences 
		? comparisons.filter(c => c.status !== 'unchanged')
		: comparisons

	return (
		<div className="flex flex-col min-h-screen gap-6">
			{/* Navigation Bar */}
			<div className="border-b bg-slate-50/50 backdrop-blur-sm sticky top-0 z-50">
				<div className="max-w-full mx-auto px-12 py-4 flex items-center justify-between">
					<div>
						<h1 className="text-xl font-bold">Monkey Data Manager</h1>
					</div>
					<div className="flex gap-2">
						<Button variant="outline" asChild>
							<Link href="/" className="flex items-center gap-2">
								<FileSpreadsheet className="w-4 h-4" />
								Merge
							</Link>
						</Button>
						<Button variant="default" asChild>
							<Link href="/compare" className="flex items-center gap-2">
								<GitCompare className="w-4 h-4" />
								Compare
							</Link>
						</Button>
					</div>
				</div>
			</div>

			<div className="flex flex-col gap-6 px-12 py-6 max-w-full mx-auto w-full">
				<div className="text-center mb-4">
					<h2 className="text-2xl font-semibold mb-2">File Comparison</h2>
					<p className="text-muted-foreground">Compare old and new merged files and choose which changes to keep</p>
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

				{success && comparisons.length > 0 && (
					<div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 text-green-700 border border-green-500/20">
						<CheckCircle className="w-4 h-4 flex-shrink-0" />
						<span className="text-sm">Comparison complete!</span>
						<button onClick={() => setSuccess(false)} className="ml-auto p-1 hover:bg-green-500/20 rounded">
							<X className="w-4 h-4" />
						</button>
					</div>
				)}

				{/* File Upload Section */}
				<div className="grid grid-cols-2 gap-6">
					{/* Old File Upload */}
					<Card>
						<CardContent className="pt-6">
							<h3 className="font-semibold mb-4">Old File</h3>
							<div className="border-2 border-dashed rounded-lg p-6 text-center transition-colors border-muted-foreground/25 hover:border-muted-foreground/50">
								<Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
								<p className="text-sm text-muted-foreground mb-3">Drag and drop or</p>
								<label>
									<input
										type="file"
										accept=".xls,.xlsx"
										className="hidden"
										onChange={(e) => handleFileSelect(e, 'old')}
										disabled={isProcessing}
									/>
									<Button variant="outline" size="sm" asChild disabled={isProcessing}>
										<span>Browse</span>
									</Button>
								</label>
							</div>
							{oldFile && (
								<div className="mt-4 p-3 rounded bg-muted/50">
									<p className="text-sm font-medium truncate">{oldFile.name}</p>
									<p className="text-xs text-muted-foreground">{oldFile.rows.length} rows</p>
								</div>
							)}
						</CardContent>
					</Card>

					{/* New File Upload */}
					<Card>
						<CardContent className="pt-6">
							<h3 className="font-semibold mb-4">New File</h3>
							<div className="border-2 border-dashed rounded-lg p-6 text-center transition-colors border-muted-foreground/25 hover:border-muted-foreground/50">
								<Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
								<p className="text-sm text-muted-foreground mb-3">Drag and drop or</p>
								<label>
									<input
										type="file"
										accept=".xls,.xlsx"
										className="hidden"
										onChange={(e) => handleFileSelect(e, 'new')}
										disabled={isProcessing}
									/>
									<Button variant="outline" size="sm" asChild disabled={isProcessing}>
										<span>Browse</span>
									</Button>
								</label>
							</div>
							{newFile && (
								<div className="mt-4 p-3 rounded bg-muted/50">
									<p className="text-sm font-medium truncate">{newFile.name}</p>
									<p className="text-xs text-muted-foreground">{newFile.rows.length} rows</p>
								</div>
							)}
						</CardContent>
					</Card>
				</div>

				{/* Process Button */}
				<Button
					onClick={runComparison}
					disabled={!oldFile || !newFile || isProcessing}
					size="lg"
					className="w-full"
				>
					{isProcessing ? "Processing..." : "Compare Files"}
				</Button>

				{/* Comparison Results */}
				{comparisons.length > 0 && (
					<div className="space-y-6">
						{/* Stats */}
						<div className="space-y-4">
							<div className="grid grid-cols-4 gap-4">
								<Card>
									<CardContent className="pt-6 text-center">
										<p className="text-2xl font-bold text-blue-600">{stats.unchanged}</p>
										<p className="text-xs text-muted-foreground">Unchanged</p>
									</CardContent>
								</Card>
								<Card>
									<CardContent className="pt-6 text-center">
										<p className="text-2xl font-bold text-yellow-600">{stats.modified}</p>
										<p className="text-xs text-muted-foreground">Modified</p>
									</CardContent>
								</Card>
								<Card>
									<CardContent className="pt-6 text-center">
										<p className="text-2xl font-bold text-green-600">{stats.added}</p>
										<p className="text-xs text-muted-foreground">Added</p>
									</CardContent>
								</Card>
								<Card>
									<CardContent className="pt-6 text-center">
										<p className="text-2xl font-bold text-red-600">{stats.deleted}</p>
										<p className="text-xs text-muted-foreground">Deleted</p>
									</CardContent>
								</Card>
							</div>
							<div className="flex gap-2">
								<Button 
									variant={showOnlyDifferences ? "default" : "outline"}
									onClick={() => setShowOnlyDifferences(true)}
									size="sm"
								>
									Differences Only
								</Button>
								<Button 
									variant={!showOnlyDifferences ? "default" : "outline"}
									onClick={() => setShowOnlyDifferences(false)}
									size="sm"
								>
									All Rows
								</Button>
							</div>
						</div>

						{/* Side-by-side Comparison */}
						<div className="grid grid-cols-2 gap-6">
							{/* Old File */}
							<div className="border rounded-lg overflow-hidden flex flex-col h-96">
								<div className="px-4 py-3 border-b-2 sticky top-0 z-40">
									<h3 className="font-semibold text-sm">Old File: {oldFile?.name}</h3>
								</div>
								<div 
									ref={oldTableRef}
									onScroll={handleSyncScroll(oldTableRef, newTableRef)}
									className="overflow-y-auto flex-1"
								>
									<table className="w-full text-xs">
										<thead className="bg-gray-900 text-white border-b sticky top-0 z-50">
											<tr>
												<th className="px-3 py-2 text-left font-semibold w-12">Row</th>
												<th className="px-3 py-2 text-left font-semibold w-12">Type</th>
												<th className="px-3 py-2 text-left font-semibold">Timestamp</th>
												<th className="px-3 py-2 text-left font-semibold">Data</th>
											</tr>
										</thead>
										<tbody>
											{filteredComparisons.map((comp, idx) => (
												comp.oldData.length > 0 && (
													<tr
														key={`old-${idx}`}
														className={cn(
															"border-b",
															comp.status === 'deleted' && 'bg-red-100',
															comp.status === 'modified' && 'bg-yellow-50',
															comp.status === 'unchanged' && 'bg-blue-50'
														)}
													>
														<td className="px-3 py-2 font-mono text-muted-foreground text-xs font-semibold">{comp.oldRowIdx}</td>
														<td className="px-3 py-2">
															{comp.status === 'deleted' && <Badge className="bg-red-600 text-xs">DEL</Badge>}
															{comp.status === 'modified' && <Badge className="bg-yellow-600 text-black text-xs">MOD</Badge>}
															{comp.status === 'unchanged' && <Badge variant="secondary" className="text-xs">—</Badge>}
														</td>
														<td className="px-3 py-2 font-mono text-muted-foreground text-xs">{comp.timestamp}</td>
														<td className="px-3 py-2 text-gray-700 text-xs whitespace-pre-wrap break-words">
															{comp.oldData.join(" | ")}
														</td>
													</tr>
												)
											))}
										</tbody>
									</table>
								</div>
							</div>

							{/* New File */}
							<div className="border rounded-lg overflow-hidden flex flex-col h-96">
								<div className="px-4 py-3 border-b sticky top-0 z-40">
									<h3 className="font-semibold text-sm">New File: {newFile?.name}</h3>
								</div>
								<div 
									ref={newTableRef}
									onScroll={handleSyncScroll(newTableRef, oldTableRef)}
									className="overflow-y-auto flex-1"
								>
									<table className="w-full text-xs">
										<thead className="bg-gray-900 text-white border-b sticky top-0 z-50">
											<tr>
												<th className="px-3 py-2 text-left font-semibold w-12">Row</th>
												<th className="px-3 py-2 text-left font-semibold w-12">Type</th>
												<th className="px-3 py-2 text-left font-semibold">Timestamp</th>
												<th className="px-3 py-2 text-left font-semibold">Data</th>
											</tr>
										</thead>
										<tbody>
											{filteredComparisons.map((comp, idx) => (
												comp.newData.length > 0 && (
													<tr
														key={`new-${idx}`}
														className={cn(
															"border-b",
															comp.status === 'added' && 'bg-green-100',
															comp.status === 'modified' && 'bg-yellow-50',
															comp.status === 'unchanged' && 'bg-blue-50'
														)}
													>
														<td className="px-3 py-2 font-mono text-muted-foreground text-xs font-semibold">{comp.newRowIdx}</td>
														<td className="px-3 py-2">
															{comp.status === 'added' && <Badge className="bg-green-600 text-xs">ADD</Badge>}
															{comp.status === 'modified' && <Badge className="bg-yellow-600 text-black text-xs">MOD</Badge>}
															{comp.status === 'unchanged' && <Badge variant="secondary" className="text-xs">—</Badge>}
														</td>
														<td className="px-3 py-2 font-mono text-muted-foreground text-xs">{comp.timestamp}</td>
														<td className="px-3 py-2 text-gray-700 text-xs whitespace-pre-wrap break-words">
															{comp.newData.join(" | ")}
														</td>
													</tr>
												)
											))}
										</tbody>
									</table>
								</div>
							</div>
						</div>
										
{/* Download Button */}
						<Button onClick={downloadResult} className="w-full" size="lg">
							<Download className="w-4 h-4 mr-2" />
							Download Result
						</Button>
					</div>
				)}
			</div>
		</div>
	)
}
