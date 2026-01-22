"use client"

import { FocalFollowRange } from "@/lib/utils"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

interface FocalFollowLegendProps {
	title: string
	ranges: FocalFollowRange[]
	colorMap: Map<string, string>
}

export function FocalFollowLegend({ title, ranges, colorMap }: FocalFollowLegendProps) {
	if (ranges.length === 0) {
		return (
			<div className="p-4 rounded-lg border border-slate-200 ">
				<p className="text-sm font-semibold mb-2">{title}</p>
				<p className="text-xs text-muted-foreground">No focal follow ranges found</p>
			</div>
		)
	}

	// Group ranges by focal type
	const groupedByType = new Map<string, FocalFollowRange[]>()
	ranges.forEach((range) => {
		if (!groupedByType.has(range.focalType)) {
			groupedByType.set(range.focalType, [])
		}
		groupedByType.get(range.focalType)!.push(range)
	})

	// Sort by focal type for consistent display
	const sortedTypes = Array.from(groupedByType.keys()).sort()

	// Calculate total row span for the progress bar
	const maxEndRow = Math.max(...ranges.map((r) => r.endRow), 0)
	const totalRowSpan = maxEndRow + 1 // +1 because rows are 0-indexed

	// Create segments for the progress bar - all ranges sorted by start row
	const sortedRanges = [...ranges].sort((a, b) => a.startRow - b.startRow)
	const barSegments = sortedRanges.map((range) => ({
		focalType: range.focalType,
		startRow: range.startRow,
		endRow: range.endRow,
		width: ((range.rowCount / totalRowSpan) * 100).toFixed(2),
		offsetLeft: ((range.startRow / totalRowSpan) * 100).toFixed(2),
	}))

	return (
		<div className="p-4 rounded-lg border border-slate-200 ">
			<p className="text-sm font-semibold mb-3">{title}</p>

			{/* Visual Progress Bar */}
			<div className="mb-4">
				<div className="relative w-full h-8 bg-slate-100 rounded-lg border border-slate-300 overflow-hidden">
					{barSegments.map((segment, idx) => {
						const color = colorMap.get(segment.focalType) || "#ccc"
						return (
							<div
								key={idx}
								className="absolute h-full transition-all hover:opacity-80"
								style={{
									backgroundColor: color,
									left: `${segment.offsetLeft}%`,
									width: `${segment.width}%`,
									minWidth: "2px",
								}}
								title={`${segment.focalType}: Rows ${segment.startRow + 1}-${segment.endRow + 1} (${segment.endRow - segment.startRow + 1} rows)`}
							/>
						)
					})}
				</div>
				<p className="text-xs text-muted-foreground mt-1">Total span: {totalRowSpan} rows</p>
			</div>

			{/* Legend Details */}
			<div className="space-y-3">
				{sortedTypes.map((focalType) => {
					const typeRanges = groupedByType.get(focalType) || []
					const color = colorMap.get(focalType) || "#ccc"

					return (
						<div key={focalType} className="space-y-1">
							<div className="flex items-center gap-2">
								<div className="w-4 h-4 rounded" style={{ backgroundColor: color }} />
								<span className="font-semibold text-sm text-white">{focalType}</span>
								<Badge variant="secondary" className="text-xs ml-auto">
									{typeRanges.length} {typeRanges.length === 1 ? "range" : "ranges"}
								</Badge>
							</div>

							{/* List the row ranges */}
							<div className="ml-6 space-y-1">
								{typeRanges.map((range, idx) => (
									<div key={idx} className="text-xs text-muted-foreground">
										Rows {range.startRow + 1}-{range.endRow + 1}
										<span className="text-gray-500 ml-2">
											({range.rowCount} rows)
										</span>
										<span className="text-gray-400 ml-2">
											{range.startTime} to {range.endTime}
										</span>
									</div>
								))}
							</div>
						</div>
					)
				})}
			</div>
		</div>
	)
}
