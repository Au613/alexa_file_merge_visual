"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Upload, Download, X, AlertCircle, CheckCircle, FileSpreadsheet, GitCompare, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Navigation } from "@/components/Navigation"
import * as XLSX from "xlsx"

/**
 * =========================
 * Types
 * =========================
 */
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
  status: "unchanged" | "added" | "deleted" | "modified"
  // default selection (used by download + edit mode)
  selected: "old" | "new"
}

type DiffLineType = "context" | "add" | "del"

interface DiffLine {
  key: string
  type: DiffLineType
  tsMs: number
  timestamp: string
  oldRowIdx: number | null
  newRowIdx: number | null
  text: string
  compIdx: number
}

/**
 * =========================
 * Matching knobs (STRICT)
 * =========================
 * User requirement: +/- 4 seconds only
 */
const STRICT_WINDOW_MS = 4 * 1000 // ±4 seconds (best score)
const EXACT_FALLBACK_MS = 30 * 1000 // ±30 seconds (only if signature matches)
const TIME_WEIGHT = 0.9
const DATA_WEIGHT = 0.1
const MIN_ACCEPT_SCORE = 0.7

/**
 * =========================
 * Inline diff helpers (word-ish highlighting)
 * =========================
 */
type InlineSeg = { t: "eq" | "del" | "add"; s: string }

function tokenizeForDiff(input: string): string[] {
  const s = input ?? ""
  return s.match(/[A-Za-z0-9_]+|[^\w]+/g) ?? []
}

function diffTokens(oldTokens: string[], newTokens: string[]): InlineSeg[] {
  const n = oldTokens.length
  const m = newTokens.length

  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        oldTokens[i] === newTokens[j]
          ? 1 + dp[i + 1][j + 1]
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const segs: InlineSeg[] = []
  let i = 0
  let j = 0

  const push = (t: InlineSeg["t"], s: string) => {
    if (!s) return
    const last = segs[segs.length - 1]
    if (last && last.t === t) last.s += s
    else segs.push({ t, s })
  }

  while (i < n && j < m) {
    if (oldTokens[i] === newTokens[j]) {
      push("eq", oldTokens[i])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("del", oldTokens[i])
      i++
    } else {
      push("add", newTokens[j])
      j++
    }
  }
  while (i < n) push("del", oldTokens[i++])
  while (j < m) push("add", newTokens[j++])

  return segs
}

function inlineDiff(oldText: string, newText: string) {
  return diffTokens(tokenizeForDiff(oldText), tokenizeForDiff(newText))
}

function InlineDiffText({
  segs,
  mode,
  theme,
}: {
  segs: InlineSeg[]
  mode: "old" | "new"
  theme: "light" | "dark"
}) {
  const delClass = theme === "dark" ? "bg-rose-900/60 text-rose-100" : "bg-red-200/70 text-red-900"
  const addClass = theme === "dark" ? "bg-emerald-900/60 text-emerald-100" : "bg-green-200/70 text-green-900"

  return (
    <>
      {segs.map((seg, i) => {
        if (seg.t === "eq") return <span key={i}>{seg.s}</span>

        if (mode === "old" && seg.t === "del") {
          return (
            <span key={i} className={cn("rounded px-0.5", delClass)}>
              {seg.s}
            </span>
          )
        }

        if (mode === "new" && seg.t === "add") {
          return (
            <span key={i} className={cn("rounded px-0.5", addClass)}>
              {seg.s}
            </span>
          )
        }

        // hide additions on old line, deletions on new line (GitHub style)
        return null
      })}
    </>
  )
}

/**
 * =========================
 * Matching helpers
 * =========================
 */
type RowItem = {
  idx: number
  row: any[]
  ts: string
  tsMs: number
  text: string
  sig: string
}

function rowToText(row: any[]): string {
  return (row ?? []).map((v) => String(v ?? "")).join(" | ")
}

/**
 * Signature used for exact-ish tie-breaking.
 * Default: ignore timestamp column (index 1). If col0 is also noise in your dataset, you can ignore it too.
 */
function rowSignature(row: any[]): string {
  return (row ?? [])
    .map((v, i) => (i === 0 || i === 1 ? "" : String(v ?? "").trim()))
    .join("|")
    .trim()
}

function dataSimilarity(a: string, b: string): number {
  const A = new Set(tokenizeForDiff(a).filter((t) => t.trim().length))
  const B = new Set(tokenizeForDiff(b).filter((t) => t.trim().length))
  if (A.size === 0 && B.size === 0) return 1
  const inter = [...A].filter((x) => B.has(x)).length
  const union = new Set([...A, ...B]).size
  return union === 0 ? 0 : inter / union
}

function timeScore(oldMs: number, newMs: number, windowMs: number): number {
  const d = Math.abs(oldMs - newMs)
  if (d >= windowMs) return 0
  return 1 - d / windowMs
}

/**
 * =========================
 * Component
 * =========================
 */
export default function Compare() {
  const [oldFile, setOldFile] = useState<FileData | null>(null)
  const [newFile, setNewFile] = useState<FileData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  const [comparisons, setComparisons] = useState<RowComparison[]>([])
  const [showOnlyDifferences, setShowOnlyDifferences] = useState(false)

  const [editMode, setEditMode] = useState(false)
  const [undoneIndices, setUndoneIndices] = useState<Set<number>>(new Set())

  // which version to keep for modified comps (old/new)
  const [selectedVersions, setSelectedVersions] = useState<Map<number, "old" | "new">>(new Map())

  // editing state for individual rows
  const [editingRows, setEditingRows] = useState<Map<number, { version: "old" | "new", value: string }>>(new Map())

  // edit history for undo functionality
  const [editHistory, setEditHistory] = useState<Array<Map<number, { version: "old" | "new", value: string }>>>([])

  // inline editing (double-click) state
  const [editingInline, setEditingInline] = useState<{ compIdx: number; version: "old" | "new" } | null>(null)
  const editingDraftRef = useRef<string>("")

  // table theme
  const [tableTheme, setTableTheme] = useState<"light" | "dark">("light")

  // preview final document modal
  const [showPreview, setShowPreview] = useState(false)
  const [previewSearchInput, setPreviewSearchInput] = useState("")
  const [previewJumpInput, setPreviewJumpInput] = useState("")
  const [previewCol2Search, setPreviewCol2Search] = useState("")
  const [previewCol3Search, setPreviewCol3Search] = useState("")
  const [previewSearchMode, setPreviewSearchMode] = useState<"includes" | "startsWith">("includes")

  const oldTableRef = useRef<HTMLDivElement>(null)
  const newTableRef = useRef<HTMLDivElement>(null)
  const previewTableRef = useRef<HTMLDivElement>(null)
  const usingScrollbarRef = useRef(false)

  const parseMDYTime = (ts: string): number => {
    const s = (ts || "").trim()
    const parts = s.split(/\s+/)
    if (parts.length < 2) return Number.POSITIVE_INFINITY

    const [mdy, hms] = parts
    const mdyParts = mdy.split("/").map(Number)
    const hmsParts = hms.split(":").map(Number)

    if (mdyParts.length < 3 || hmsParts.length < 2) return Number.POSITIVE_INFINITY

    const [mm, dd, yyyy] = mdyParts
    const [hh, mi, ss] = [hmsParts[0], hmsParts[1], hmsParts[2] || 0]

    if (
      !Number.isFinite(mm) ||
      !Number.isFinite(dd) ||
      !Number.isFinite(yyyy) ||
      !Number.isFinite(hh) ||
      !Number.isFinite(mi)
    ) {
      return Number.POSITIVE_INFINITY
    }

    return new Date(yyyy, mm - 1, dd, hh, mi, ss).getTime()
  }

  const parseExcelFile = (buffer: Buffer): any[][] => {
    const workbook = XLSX.read(buffer, { type: "buffer" })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const allRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][]
    const filtered = allRows.filter((row) => row.some((cell) => cell != null && cell !== ""))
    console.log("Parsed rows:", filtered.slice(0, 5))
    console.log("Total rows:", filtered.length)
    return filtered
  }

  const handleFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "old" | "new",
  ) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const buffer = await file.arrayBuffer()
      const rows = parseExcelFile(Buffer.from(buffer))
      if (type === "old") setOldFile({ name: file.name, rows })
      else setNewFile({ name: file.name, rows })
      setError(null)
      setSuccess(false)
    } catch (err) {
      setError(`Failed to parse ${type} file: ${err instanceof Error ? err.message : "Unknown error"}`)
    }
  }

  /**
   * ===================================
   * Core: strict ±4s matching
   * - time is primary
   * - data is tiebreaker (and exact signature bonus)
   * ===================================
   */
  const runComparison = () => {
    if (!oldFile || !newFile) {
      setError("Both old and new files must be uploaded")
      return
    }

    setIsProcessing(true)
    try {
      const oldItems: RowItem[] = oldFile.rows
        .map((row, idx) => {
          const ts = String(row?.[1] ?? "").trim()
          const tsMs = parseMDYTime(ts)
          return {
            idx,
            row,
            ts,
            tsMs,
            text: rowToText(row),
            sig: rowSignature(row),
          }
        })
        .filter((r) => r.ts && Number.isFinite(r.tsMs))

      const newItems: RowItem[] = newFile.rows
        .map((row, idx) => {
          const ts = String(row?.[1] ?? "").trim()
          const tsMs = parseMDYTime(ts)
          return {
            idx,
            row,
            ts,
            tsMs,
            text: rowToText(row),
            sig: rowSignature(row),
          }
        })
        .filter((r) => r.ts && Number.isFinite(r.tsMs))

      oldItems.sort((a, b) => a.tsMs - b.tsMs)
      newItems.sort((a, b) => a.tsMs - b.tsMs)

      const usedNew = new Set<number>()
      const results: RowComparison[] = []

      // two-pointer window
      let left = 0

      for (const o of oldItems) {
        while (left < newItems.length && newItems[left].tsMs < o.tsMs - EXACT_FALLBACK_MS) {
          left++
        }

        let bestJ = -1
        let bestScore = -1

        // PASS A: strict window (±4s), weighted scoring
        for (let j = left; j < newItems.length; j++) {
          const n = newItems[j]
          if (n.tsMs > o.tsMs + STRICT_WINDOW_MS) break
          if (usedNew.has(n.idx)) continue

          const tScore = timeScore(o.tsMs, n.tsMs, STRICT_WINDOW_MS)
          const dScore = dataSimilarity(o.text, n.text)
          const exactBonus = o.sig && n.sig && o.sig === n.sig ? 0.15 : 0

          const score = TIME_WEIGHT * tScore + DATA_WEIGHT * dScore + exactBonus

          if (score > bestScore) {
            bestScore = score
            bestJ = j
          }
        }

        // PASS B: fallback window (±30s) ONLY IF signature matches exactly
        if (bestJ < 0) {
          // find starting point for fallback
          let jStart = left
          while (jStart > 0 && newItems[jStart - 1].tsMs >= o.tsMs - EXACT_FALLBACK_MS) jStart--

          for (let j = jStart; j < newItems.length; j++) {
            const n = newItems[j]
            if (n.tsMs > o.tsMs + EXACT_FALLBACK_MS) break
            if (usedNew.has(n.idx)) continue

            // hard requirement for fallback matching: signatures must match exactly
            if (!o.sig || !n.sig || o.sig !== n.sig) continue

            // pick closest in time (since data is identical)
            const d = Math.abs(o.tsMs - n.tsMs)
            const score = 1 - d / EXACT_FALLBACK_MS // purely time-based within fallback

            if (score > bestScore) {
              bestScore = score
              bestJ = j
            }
          }
        }

        if (bestJ >= 0) {
          const n = newItems[bestJ]
          usedNew.add(n.idx)

          const isSame = JSON.stringify(o.row) === JSON.stringify(n.row)
          results.push({
            oldRowIdx: o.idx,
            newRowIdx: n.idx,
            timestamp: o.ts, // keep old timestamp for display
            tsMs: o.tsMs,
            oldData: o.row,
            newData: n.row,
            status: isSame ? "unchanged" : "modified",
            selected: isSame ? "old" : "new",
          })
        } else {
          results.push({
            oldRowIdx: o.idx,
            newRowIdx: null,
            timestamp: o.ts,
            tsMs: o.tsMs,
            oldData: o.row,
            newData: [],
            status: "deleted",
            selected: "old",
          })
        }
      }

      for (const n of newItems) {
        if (usedNew.has(n.idx)) continue
        results.push({
          oldRowIdx: null,
          newRowIdx: n.idx,
          timestamp: n.ts,
          tsMs: n.tsMs,
          oldData: [],
          newData: n.row,
          status: "added",
          selected: "new",
        })
      }

      results.sort(
        (a, b) =>
          a.tsMs - b.tsMs ||
          ((a.oldRowIdx ?? 1e9) - (b.oldRowIdx ?? 1e9)) ||
          ((a.newRowIdx ?? 1e9) - (b.newRowIdx ?? 1e9)),
      )

      setComparisons(results)
      setSuccess(true)
      setError(null)

      // reset edit states when recomputing
      setUndoneIndices(new Set())
      setEditMode(false)
    } catch (err) {
      setError(`Comparison failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleUndoIndex = (idx: number) => {
    setUndoneIndices((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const handleSelectVersion = (idx: number, version: "old" | "new") => {
    setSelectedVersions((prev) => {
      const next = new Map(prev)
      next.set(idx, version)
      return next
    })
  }

  const handleStartInlineEdit = (compIdx: number, version: "old" | "new", currentText: string) => {
    setEditMode(true)
    const existing = editingRows.get(compIdx)
    const draft = existing && existing.version === version ? existing.value : currentText
    editingDraftRef.current = draft
    setEditingInline({ compIdx, version })
  }

  const handleSaveInlineEdit = () => {
    if (!editingInline) return
    const { compIdx, version } = editingInline
    const value = editingDraftRef.current
    
    // Save current state to history before making changes
    setEditHistory((prev) => [...prev, new Map(editingRows)])
    
    setEditingRows((prev) => {
      const next = new Map(prev)
      next.set(compIdx, { version, value })
      return next
    })
    // auto-select the edited version for modified rows
    handleSelectVersion(compIdx, version)
    setEditingInline(null)
    editingDraftRef.current = ""
  }

  const handleUndo = () => {
    if (editHistory.length === 0) return
    const previousState = editHistory[editHistory.length - 1]
    setEditingRows(previousState)
    setEditHistory((prev) => prev.slice(0, -1))
  }

  const handleResetRow = (compIdx: number) => {
    setEditHistory((prev) => [...prev, new Map(editingRows)])
    setEditingRows((prev) => {
      const next = new Map(prev)
      next.delete(compIdx)
      return next
    })
  }

  const handleCancelInlineEdit = () => {
    setEditingInline(null)
    editingDraftRef.current = ""
  }

  const downloadResult = () => {
    try {
      const resultRows = computeFinalRows()

      const worksheet = XLSX.utils.aoa_to_sheet(resultRows)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, "Merged")
      
      // Generate filename from new file name + '_edited'
      const baseFileName = newFile?.name.replace(/\.xlsx?$/i, '') || 'merged-comparison-result'
      const fileName = `${baseFileName}_edited.xlsx`
      
      XLSX.writeFile(workbook, fileName)
    } catch {
      setError("Failed to download result file")
    }
  }

  const stats = useMemo(() => {
    return {
      added: comparisons.filter((c) => c.status === "added").length,
      deleted: comparisons.filter((c) => c.status === "deleted").length,
      modified: comparisons.filter((c) => c.status === "modified").length,
      unchanged: comparisons.filter((c) => c.status === "unchanged").length,
    }
  }, [comparisons])

  const handleTrackpadScroll = (
    sourceRef: React.RefObject<HTMLDivElement | null>,
    targetRef: React.RefObject<HTMLDivElement | null>,
  ) => {
    return () => {
      if (usingScrollbarRef.current) return
      if (sourceRef.current && targetRef.current) {
        targetRef.current.scrollTop = sourceRef.current.scrollTop
      }
    }
  }

  const handleScrollbarMouseDown = () => {
    usingScrollbarRef.current = true
  }

  const handleScrollbarMouseUp = () => {
    usingScrollbarRef.current = false
  }

  const filteredComparisons = useMemo(() => {
    return showOnlyDifferences ? comparisons.filter((c) => c.status !== "unchanged") : comparisons
  }, [comparisons, showOnlyDifferences])

  // Initialize selectedVersions default = "new" for modified (preserve user choices)
  useEffect(() => {
    setSelectedVersions((prev) => {
      const next = new Map(prev)
      comparisons.forEach((c, idx) => {
        if (c.status === "modified" && !next.has(idx)) next.set(idx, "new")
      })
      return next
    })
  }, [comparisons])

  // Compute final rows based on current selections
  const computeFinalRows = (): any[][] => {
    const resultRows: any[][] = []

    comparisons.forEach((comp, idx) => {
      const undone = undoneIndices.has(idx)
      const editedRow = editingRows.get(idx)

      if (comp.status === "deleted") {
        // readd if undone (user clicked readd)
        if (undone) {
          if (editedRow) {
            // Use edited value if it exists
            const parsed = editedRow.value.split(" | ")
            resultRows.push(parsed)
          } else {
            resultRows.push(comp.oldData)
          }
        }
        return
      }

      if (comp.status === "added") {
        // delete if undone (user clicked delete)
        if (!undone) {
          if (editedRow) {
            // Use edited value if it exists
            const parsed = editedRow.value.split(" | ")
            resultRows.push(parsed)
          } else {
            resultRows.push(comp.newData)
          }
        }
        return
      }

      if (comp.status === "modified") {
        // for modified, undone means keep old (user clicked undo)
        if (undone) {
          if (editedRow && editedRow.version === "old") {
            // Use edited old value
            const parsed = editedRow.value.split(" | ")
            resultRows.push(parsed)
          } else {
            resultRows.push(comp.oldData)
          }
          return
        }
        const pick = selectedVersions.get(idx) ?? "new"
        
        if (editedRow && editedRow.version === pick) {
          // Use edited value
          const parsed = editedRow.value.split(" | ")
          resultRows.push(parsed)
        } else if (pick === "old") {
          // When keeping old data, use new timestamp (column 2)
          const resultRow = [...comp.oldData]
          if (comp.newData[1]) {
            resultRow[1] = comp.newData[1]
          }
          resultRows.push(resultRow)
        } else {
          resultRows.push(comp.newData)
        }
        return
      }

      // unchanged
      if (editedRow) {
        const parsed = editedRow.value.split(" | ")
        resultRows.push(parsed)
      } else {
        resultRows.push(comp.oldData)
      }
    })

    return resultRows
  }

  const previewRows = useMemo(() => computeFinalRows(), [comparisons, undoneIndices, selectedVersions])

  const matchesSearch = (text: string, query: string, mode: "includes" | "startsWith"): boolean => {
    if (!query.trim()) return true
    const queryLower = query.toLowerCase()
    const textLower = text.toLowerCase()
    if (mode === "startsWith") {
      return textLower.startsWith(queryLower)
    }
    return textLower.includes(queryLower)
  }

  const previewSearchResults = useMemo(() => {
    const hasCol2Search = previewCol2Search.trim()
    const hasCol3Search = previewCol3Search.trim()

    if (!hasCol2Search && !hasCol3Search) return []

    return previewRows
      .map((row, idx) => {
        const col2 = row[1] ? String(row[1]) : ""
        const col3 = row[2] ? String(row[2]) : ""

        let matches = true

        if (hasCol2Search) {
          matches = matches && matchesSearch(col2, previewCol2Search, previewSearchMode)
        }

        if (hasCol3Search) {
          matches = matches && matchesSearch(col3, previewCol3Search, previewSearchMode)
        }

        return matches ? idx : -1
      })
      .filter((idx) => idx >= 0)
  }, [previewRows, previewCol2Search, previewCol3Search, previewSearchMode])

  const handlePreviewJumpToRow = (rowNum: number) => {
    const rowIdx = rowNum - 1
    if (rowIdx < 0 || rowIdx >= previewRows.length) return

    const tableDiv = previewTableRef.current
    if (!tableDiv) return

    const rowElement = tableDiv.querySelector(`[data-row-idx="${rowIdx}"]`)
    if (rowElement) {
      setTimeout(() => {
        rowElement.scrollIntoView({ behavior: "smooth", block: "center" })
      }, 0)
    }
  }

  const highlightPreviewText = (text: string, query: string, mode: "includes" | "startsWith") => {
    if (!query.trim()) return text

    const queryLower = query.toLowerCase()
    const textLower = text.toLowerCase()
    const index = textLower.indexOf(queryLower)

    if (index === -1) return text
    if (mode === "startsWith" && index !== 0) return text

    const start = text.substring(0, index)
    const match = text.substring(index, index + query.length)
    const end = text.substring(index + query.length)

    return (
      <>
        {start}
        <mark className="bg-yellow-300 text-black">{match}</mark>
        {end}
      </>
    )
  }

  /**
   * =========================
   * Git-diff view helpers
   * =========================
   */
  const compToDiffLines = (comp: RowComparison, compIdx: number): DiffLine[] => {
    const base = {
      tsMs: comp.tsMs,
      timestamp: comp.timestamp,
      oldRowIdx: comp.oldRowIdx,
      newRowIdx: comp.newRowIdx,
      compIdx,
    }

    const oldText = comp.oldData?.length ? comp.oldData.join(" | ") : ""
    const newText = comp.newData?.length ? comp.newData.join(" | ") : ""

    switch (comp.status) {
      case "unchanged":
        return [
          {
            key: `ctx-${compIdx}`,
            type: "context",
            ...base,
            text: newText || oldText,
          },
        ]
      case "added":
        return [
          {
            key: `add-${compIdx}`,
            type: "add",
            ...base,
            text: newText,
          },
        ]
      case "deleted":
        return [
          {
            key: `del-${compIdx}`,
            type: "del",
            ...base,
            text: oldText,
          },
        ]
      case "modified":
        return [
          {
            key: `mod-del-${compIdx}`,
            type: "del",
            ...base,
            text: oldText,
          },
          {
            key: `mod-add-${compIdx}`,
            type: "add",
            ...base,
            text: newText,
          },
        ]
    }
  }

  const applyContext = (lines: DiffLine[], context = 3): DiffLine[] => {
    const keep = new Set<number>()
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].type !== "context") {
        for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) {
          keep.add(j)
        }
      }
    }
    return lines.filter((_, idx) => keep.has(idx))
  }

  const baseLines = useMemo(() => {
    return filteredComparisons.flatMap((comp, idx) => {
      if (undoneIndices.has(idx) && (comp.status === "added" || comp.status === "modified")) {
        return []
      }
      return compToDiffLines(comp, idx)
    })
  }, [filteredComparisons, undoneIndices])

  const viewLines = useMemo(() => {
    return showOnlyDifferences ? baseLines.filter((l) => l.type !== "context") : applyContext(baseLines, 3)
  }, [baseLines, showOnlyDifferences])

  const inlineDiffCache = useMemo(() => {
    const map = new Map<number, InlineSeg[]>()
    filteredComparisons.forEach((comp, idx) => {
      if (comp.status !== "modified") return
      const oldText = comp.oldData?.length ? comp.oldData.join(" | ") : ""
      const newText = comp.newData?.length ? comp.newData.join(" | ") : ""
      map.set(idx, inlineDiff(oldText, newText))
    })
    return map
  }, [filteredComparisons])

  const rowBgClass = (type: DiffLineType, theme: "light" | "dark") => {
    if (theme === "dark") {
      if (type === "add") return "bg-emerald-950/40"
      if (type === "del") return "bg-rose-950/35"
      return "bg-slate-900"
    }
    if (type === "add") return "bg-green-50"
    if (type === "del") return "bg-red-50"
    return "bg-white"
  }

  const rowBorderClass = (theme: "light" | "dark") => (theme === "dark" ? "border-slate-800" : "border-gray-200")

  return (
    <div className="flex flex-col min-h-screen gap-6">
      <Navigation />

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
                    onChange={(e) => handleFileSelect(e, "old")}
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
                    onChange={(e) => handleFileSelect(e, "new")}
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
        <Button onClick={runComparison} disabled={!oldFile || !newFile || isProcessing} size="lg" className="w-full">
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
                <Button
                  variant={editMode ? "default" : "outline"}
                  onClick={() => {
                    setEditMode((v) => !v)
                    setUndoneIndices(new Set())
                  }}
                  size="sm"
                >
                  {editMode ? "Compare View" : "Edit Mode"}
                </Button>
              </div>
            </div>

            {/* Side-by-side Comparison or Edit Mode */}
            {editMode ? (
              <div
                className={cn(
                  "border rounded-lg overflow-hidden flex flex-col h-auto max-h-96",
                  tableTheme === "dark" ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900",
                )}
              >
                <div className="px-4 py-3 border-b-2 sticky top-0 z-40 flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-sm">Edit Mode - Git Diff</h3>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleUndo}
                      disabled={editHistory.length === 0}
                      className="h-7 px-2"
                      title="Undo last edit"
                    >
                      Undo ({editHistory.length})
                    </Button>
                    <div className="flex items-center gap-1 text-xs">
                      <span className="text-muted-foreground">Theme:</span>
                      <Button
                        variant={tableTheme === "light" ? "default" : "outline"}
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => setTableTheme("light")}
                      >
                        Light
                      </Button>
                      <Button
                        variant={tableTheme === "dark" ? "default" : "outline"}
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => setTableTheme("dark")}
                      >
                        Dark
                      </Button>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setShowPreview(true)}>
                      Preview Final
                    </Button>
                    <Button
                      variant={showOnlyDifferences ? "default" : "outline"}
                      size="sm"
                      onClick={() => setShowOnlyDifferences((v) => !v)}
                    >
                      {showOnlyDifferences ? "Show Context" : "Hide Context"}
                    </Button>
                  </div>
                </div>

                <div className="overflow-y-auto flex-1">
                  <table className="w-full text-xs font-mono">
                    <thead
                      className={cn(
                        "sticky top-0 z-30",
                        tableTheme === "dark" ? "bg-slate-800 text-slate-100" : "bg-gray-900 text-white",
                      )}
                    >
                      <tr>
                        <th className="w-14 px-2 py-2 text-right opacity-80">old</th>
                        <th className="w-14 px-2 py-2 text-right opacity-80">new</th>
                        <th className="w-6 px-2 py-2 text-center opacity-80" />
                        <th className="px-3 py-2 text-left">line</th>
                        <th className="w-28 px-3 py-2 text-right" />
                      </tr>
                    </thead>

                    <tbody>
                      {viewLines.map((line) => {
                        const comp = filteredComparisons[line.compIdx]
                        const isChange = line.type !== "context"

                        return (
                          <tr
                            key={line.key}
                            className={cn("border-b align-top", rowBgClass(line.type, tableTheme), rowBorderClass(tableTheme))}
                          >
                            {/* old line number */}
                            <td
                              className={cn(
                                "px-2 py-1 text-right select-text",
                                tableTheme === "dark" ? "text-slate-400" : "text-gray-500",
                                line.type === "del" && (tableTheme === "dark" ? "text-rose-200" : "text-red-900"),
                              )}
                            >
                              {line.type === "add" ? "" : line.oldRowIdx != null ? line.oldRowIdx + 1 : ""}
                            </td>

                            {/* new line number */}
                            <td
                              className={cn(
                                "px-2 py-1 text-right select-text",
                                tableTheme === "dark" ? "text-slate-400" : "text-gray-500",
                                line.type === "add" && (tableTheme === "dark" ? "text-emerald-200" : "text-green-900"),
                              )}
                            >
                              {line.type === "del" ? "" : line.newRowIdx != null ? line.newRowIdx + 1 : ""}
                            </td>

                            {/* prefix */}
                            <td className="px-2 py-1 text-center select-none font-bold">
                              {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                            </td>

                            {/* content */}
                            <td
                              className={cn(
                                "px-3 py-1 whitespace-pre-wrap break-words select-text",
                                tableTheme === "dark" ? "text-slate-100" : "text-gray-900",
                                line.type === "del" && (tableTheme === "dark" ? "text-rose-100" : "text-red-900"),
                                line.type === "add" && (tableTheme === "dark" ? "text-emerald-100" : "text-green-900"),
                              )}
                              onDoubleClick={() => {
                                const isOldLine = line.type === "del"
                                const isNewLine = line.type === "add"
                                const isContext = line.type === "context"

                                // For context lines (unchanged), allow editing too
                                let version: "old" | "new" = "new"
                                let currentText = ""

                                if (isContext) {
                                  // Unchanged rows - use old data
                                  version = "old"
                                  currentText = comp.oldData.join(" | ")
                                } else if (isOldLine) {
                                  version = "old"
                                  currentText = comp.oldData.join(" | ")
                                } else if (isNewLine) {
                                  version = "new"
                                  currentText = comp.newData.join(" | ")
                                }

                                handleStartInlineEdit(line.compIdx, version, currentText)
                              }}
                            >
                              {(() => {
                                const isEditing =
                                  editingInline &&
                                  editingInline.compIdx === line.compIdx &&
                                  editingInline.version === (line.type === "del" ? "old" : "new")

                                const editedRow = editingRows.get(line.compIdx)
                                const thisVersion = line.type === "del" ? "old" : line.type === "add" ? "new" : null
                                const displayText =
                                  editedRow && thisVersion && editedRow.version === thisVersion
                                    ? editedRow.value
                                    : line.text

                                if (isEditing) {
                                  return (
                                    <div className="flex flex-col gap-2">
                                      <textarea
                                        className={cn(
                                          "w-full border rounded px-2 py-1 text-xs",
                                          tableTheme === "dark"
                                            ? "bg-slate-950 text-slate-100 border-slate-700"
                                            : "bg-white text-black border-gray-300",
                                        )}
                                        rows={2}
                                        defaultValue={editingDraftRef.current}
                                        onChange={(e) => {
                                          editingDraftRef.current = e.target.value
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" && !e.shiftKey) {
                                            e.preventDefault()
                                            handleSaveInlineEdit()
                                          }
                                        }}
                                      />
                                      <div className="flex gap-2">
                                        <Button size="sm" className="h-7 px-3" onClick={handleSaveInlineEdit}>
                                          Save
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-7 px-3"
                                          onClick={handleCancelInlineEdit}
                                        >
                                          Cancel
                                        </Button>
                                      </div>
                                    </div>
                                  )
                                }

                                return (
                                  <>
                                    <span className="opacity-70">{line.timestamp}</span>{" "}
                                    {(() => {
                                      if (comp.status === "modified") {
                                        // if edited, show raw edited text; otherwise show diff
                                        if (editedRow && thisVersion && editedRow.version === thisVersion) {
                                          return displayText
                                        }
                                        const segs = inlineDiffCache.get(line.compIdx) ?? [{ t: "eq", s: line.text }]
                                        return (
                                          <InlineDiffText
                                            segs={segs}
                                            mode={line.type === "del" ? "old" : "new"}
                                            theme={tableTheme}
                                          />
                                        )
                                      }
                                      return displayText
                                    })()}
                                  </>
                                )
                              })()}
                            </td>

                            {/* action */}
                            <td className="px-3 py-1 text-right">
                              <div className="flex flex-row gap-1 justify-end items-center">
                                {editingRows.has(line.compIdx) && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleResetRow(line.compIdx)}
                                    className="h-7 px-2 text-xs"
                                    title="Reset to original"
                                  >
                                    Reset
                                  </Button>
                                )}
                                {comp.status === "modified" ? (
                                  (() => {
                                    const selected = selectedVersions.get(line.compIdx) ?? "new"
                                    const isOldLine = line.type === "del"
                                    const isNewLine = line.type === "add"
                                    const isThisLineSelected =
                                      (isOldLine && selected === "old") || (isNewLine && selected === "new")
                                    const editedRow = editingRows.get(line.compIdx)
                                    const isEditing = editedRow && editedRow.version === (isOldLine ? "old" : "new")

                                    if (!isOldLine && !isNewLine) return null

                                    return (
                                      <>
                                        {isThisLineSelected ? (
                                          <>
                                            <span className="inline-flex items-center gap-1 min-w-[96px] justify-center text-xs font-semibold text-green-700 px-2 py-1 rounded bg-green-50 border border-green-200">
                                              ✓ Selected
                                            </span>
                                            {isEditing ? (
                                              <span className="text-xs font-semibold text-blue-600 ml-1">(Edited)</span>
                                            ) : null}
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => {
                                                const currentText = isOldLine ? comp.oldData.join(" | ") : comp.newData.join(" | ")
                                                const currentEdit = editingRows.get(line.compIdx)
                                                
                                                if (currentEdit && currentEdit.version === (isOldLine ? "old" : "new")) {
                                                  // Currently editing, save it
                                                  setEditingRows((prev) => {
                                                    const next = new Map(prev)
                                                    next.delete(line.compIdx)
                                                    return next
                                                  })
                                                } else {
                                                  // Start editing
                                                  const editValue = currentEdit ? currentEdit.value : currentText
                                                  handleStartInlineEdit(line.compIdx, isOldLine ? "old" : "new", editValue)
                                                }
                                              }}
                                              className="h-7 px-2 bg-gray-800 hover:bg-gray-700 text-white"
                                              title="Edit this row"
                                            >
                                              <Pencil className="w-3 h-3" />
                                            </Button>
                                          </>
                                        ) : (
                                          <>
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              onClick={() => handleSelectVersion(line.compIdx, isOldLine ? "old" : "new")}
                                              className="h-7 px-2"
                                            >
                                              Select
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => {
                                                const currentText = isOldLine ? comp.oldData.join(" | ") : comp.newData.join(" | ")
                                                const currentEdit = editingRows.get(line.compIdx)
                                                const editValue = (currentEdit && currentEdit.version === (isOldLine ? "old" : "new")) 
                                                  ? currentEdit.value 
                                                  : currentText
                                                handleStartInlineEdit(line.compIdx, isOldLine ? "old" : "new", editValue)
                                              }}
                                              className="h-7 px-2 bg-gray-800 hover:bg-gray-700 text-white"
                                              title="Edit and select this row"
                                            >
                                              <Pencil className="w-3 h-3" />
                                            </Button>
                                          </>
                                        )}
                                      </>
                                    )
                                  })()
                                ) : comp.status === "added" ? (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleUndoIndex(line.compIdx)}
                                      className="h-7 px-2"
                                    >
                                      {undoneIndices.has(line.compIdx) ? "Redo" : "Delete"}
                                    </Button>
                                    {!undoneIndices.has(line.compIdx) && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          const currentText = comp.newData.join(" | ")
                                          const currentEdit = editingRows.get(line.compIdx)
                                          const editValue = currentEdit ? currentEdit.value : currentText
                                          handleStartInlineEdit(line.compIdx, "new", editValue)
                                        }}
                                        className="h-7 px-2 bg-gray-800 hover:bg-gray-700 text-white"
                                        title="Edit this row"
                                      >
                                        <Pencil className="w-3 h-3" />
                                      </Button>
                                    )}
                                  </>
                                ) : comp.status === "deleted" ? (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleUndoIndex(line.compIdx)}
                                      className="h-7 px-2"
                                    >
                                      {undoneIndices.has(line.compIdx) ? "Undo" : "Readd"}
                                    </Button>
                                    {undoneIndices.has(line.compIdx) && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          const currentText = comp.oldData.join(" | ")
                                          const currentEdit = editingRows.get(line.compIdx)
                                          const editValue = currentEdit ? currentEdit.value : currentText
                                          handleStartInlineEdit(line.compIdx, "old", editValue)
                                        }}
                                        className="h-7 px-2 bg-gray-800 hover:bg-gray-700 text-white"
                                        title="Edit this row"
                                      >
                                        <Pencil className="w-3 h-3" />
                                      </Button>
                                    )}
                                  </>
                                ) : (
                                  // Context/Unchanged rows
                                  line.type === "context" && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        const currentText = comp.oldData.join(" | ")
                                        const currentEdit = editingRows.get(line.compIdx)
                                        const editValue = currentEdit ? currentEdit.value : currentText
                                        handleStartInlineEdit(line.compIdx, "old", editValue)
                                      }}
                                      className="h-7 px-2 bg-gray-800 hover:bg-gray-700 text-white"
                                      title="Edit this row"
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </Button>
                                  )
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-6">
                {/* Old File */}
                <div
                  className={cn(
                    "border rounded-lg overflow-hidden flex flex-col h-96",
                    tableTheme === "dark" ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900",
                  )}
                >
                  <div className="px-4 py-3 border-b-2 sticky top-0 z-40">
                    <h3 className="font-semibold text-sm">Old File: {oldFile?.name}</h3>
                  </div>
                  <div
                    ref={oldTableRef}
                    onWheel={handleTrackpadScroll(oldTableRef, newTableRef) as any}
                    onMouseDown={handleScrollbarMouseDown}
                    onMouseUp={handleScrollbarMouseUp}
                    className="overflow-y-auto flex-1"
                  >
                    <table className="w-full text-xs">
                      <thead
                        className={cn(
                          "border-b sticky top-0 z-50 select-none",
                          tableTheme === "dark" ? "bg-slate-800 text-slate-100" : "bg-gray-900 text-white",
                        )}
                      >
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold w-12">Row</th>
                          <th className="px-3 py-2 text-left font-semibold w-12">Type</th>
                          <th className="px-3 py-2 text-left font-semibold">Timestamp</th>
                          <th className="px-3 py-2 text-left font-semibold">Data</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredComparisons.map(
                          (comp, idx) =>
                            comp.oldData.length > 0 && (
                              <tr
                                key={`old-${idx}`}
                                className={cn(
                                  "border-b",
                                  tableTheme === "dark" ? "border-slate-800" : "border-gray-200",
                                  comp.status === "deleted" &&
                                    (tableTheme === "dark" ? "bg-rose-950/35" : "bg-red-100"),
                                  comp.status === "added" &&
                                    (tableTheme === "dark" ? "bg-emerald-950/35" : "bg-green-100"),
                                  comp.status === "modified" &&
                                    (tableTheme === "dark" ? "bg-amber-950/30" : "bg-yellow-50"),
                                  comp.status === "unchanged" &&
                                    (tableTheme === "dark" ? "bg-slate-900" : "bg-blue-50"),
                                )}
                              >
                                <td className="px-3 py-2 font-mono text-muted-foreground text-xs font-semibold select-text">
                                  {comp.oldRowIdx != null ? comp.oldRowIdx + 1 : ""}
                                </td>
                                <td className="px-3 py-2">
                                  {comp.status === "deleted" && <Badge className="bg-red-600 text-xs">DEL</Badge>}
                                  {comp.status === "modified" && (
                                    <Badge className="bg-yellow-600 text-black text-xs">MOD</Badge>
                                  )}
                                  {comp.status === "unchanged" && (
                                    <Badge variant="secondary" className="text-xs">
                                      —
                                    </Badge>
                                  )}
                                </td>
                                <td
                                  className={cn(
                                    "px-3 py-2 font-mono text-xs select-text",
                                    tableTheme === "dark" ? "text-slate-300" : "text-muted-foreground",
                                  )}
                                >
                                  {comp.timestamp}
                                </td>
                                <td
                                  className={cn(
                                    "px-3 py-2 text-xs whitespace-pre-wrap break-words select-text",
                                    tableTheme === "dark" ? "text-slate-100" : "text-gray-700",
                                  )}
                                >
                                  {comp.oldData.join(" | ")}
                                </td>
                              </tr>
                            ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* New File */}
                <div
                  className={cn(
                    "border rounded-lg overflow-hidden flex flex-col h-96",
                    tableTheme === "dark" ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900",
                  )}
                >
                  <div className="px-4 py-3 border-b sticky top-0 z-40">
                    <h3 className="font-semibold text-sm">New File: {newFile?.name}</h3>
                  </div>
                  <div
                    ref={newTableRef}
                    onWheel={handleTrackpadScroll(newTableRef, oldTableRef) as any}
                    onMouseDown={handleScrollbarMouseDown}
                    onMouseUp={handleScrollbarMouseUp}
                    className="overflow-y-auto flex-1"
                  >
                    <table className="w-full text-xs">
                      <thead
                        className={cn(
                          "border-b sticky top-0 z-50 select-none",
                          tableTheme === "dark" ? "bg-slate-800 text-slate-100" : "bg-gray-900 text-white",
                        )}
                      >
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold w-12">Row</th>
                          <th className="px-3 py-2 text-left font-semibold w-12">Type</th>
                          <th className="px-3 py-2 text-left font-semibold">Timestamp</th>
                          <th className="px-3 py-2 text-left font-semibold">Data</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredComparisons.map(
                          (comp, idx) =>
                            comp.newData.length > 0 && (
                              <tr
                                key={`new-${idx}`}
                                className={cn(
                                  "border-b",
                                  tableTheme === "dark" ? "border-slate-800" : "border-gray-200",
                                  comp.status === "deleted" &&
                                    (tableTheme === "dark" ? "bg-rose-950/35" : "bg-red-100"),
                                  comp.status === "added" &&
                                    (tableTheme === "dark" ? "bg-emerald-950/35" : "bg-green-100"),
                                  comp.status === "modified" &&
                                    (tableTheme === "dark" ? "bg-amber-950/30" : "bg-yellow-50"),
                                  comp.status === "unchanged" &&
                                    (tableTheme === "dark" ? "bg-slate-900" : "bg-blue-50"),
                                )}
                              >
                                <td className="px-3 py-2 font-mono text-muted-foreground text-xs font-semibold select-text">
                                  {comp.newRowIdx != null ? comp.newRowIdx + 1 : ""}
                                </td>
                                <td className="px-3 py-2">
                                  {comp.status === "added" && <Badge className="bg-green-600 text-xs">ADD</Badge>}
                                  {comp.status === "modified" && (
                                    <Badge className="bg-yellow-600 text-black text-xs">MOD</Badge>
                                  )}
                                  {comp.status === "unchanged" && (
                                    <Badge variant="secondary" className="text-xs">
                                      —
                                    </Badge>
                                  )}
                                </td>
                                <td
                                  className={cn(
                                    "px-3 py-2 font-mono text-xs select-text",
                                    tableTheme === "dark" ? "text-slate-300" : "text-muted-foreground",
                                  )}
                                >
                                  {comp.timestamp}
                                </td>
                                <td
                                  className={cn(
                                    "px-3 py-2 text-xs whitespace-pre-wrap break-words select-text",
                                    tableTheme === "dark" ? "text-slate-100" : "text-gray-700",
                                  )}
                                >
                                  {comp.newData.join(" | ")}
                                </td>
                              </tr>
                            ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Download Button */}
            <Button onClick={downloadResult} className="w-full" size="lg">
              <Download className="w-4 h-4 mr-2" />
              Download Result
            </Button>

            {/* Preview Final Document Modal */}
            {showPreview && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-lg shadow-lg max-w-6xl w-full max-h-[80vh] flex flex-col">
                  <div className="px-4 py-3 border-b space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-black">Final Document Preview ({previewRows.length} rows)</h3>
                      <button
                        onClick={() => {
                          setShowPreview(false)
                          setPreviewCol2Search("")
                          setPreviewCol3Search("")
                          setPreviewJumpInput("")
                        }}
                        className="p-1 hover:bg-gray-100 rounded"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Jump to row */}
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="1"
                        max={previewRows.length}
                        placeholder="Jump to row..."
                        value={previewJumpInput}
                        onChange={(e) => setPreviewJumpInput(e.target.value)}
                        className="px-2 py-1 border rounded text-sm text-black"
                      />
                      <button
                        onClick={() => {
                          const num = parseInt(previewJumpInput)
                          if (num) handlePreviewJumpToRow(num)
                        }}
                        className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                      >
                        Jump
                      </button>
                    </div>

                    {/* Search Mode Toggle */}
                    <div className="flex gap-2 items-center">
                      <span className="text-sm text-black font-medium">Search mode:</span>
                      <button
                        onClick={() => setPreviewSearchMode("includes")}
                        className={`px-3 py-1 rounded text-sm ${
                          previewSearchMode === "includes"
                            ? "bg-blue-600 text-white"
                            : "bg-gray-200 text-black hover:bg-gray-300"
                        }`}
                      >
                        Includes
                      </button>
                      <button
                        onClick={() => setPreviewSearchMode("startsWith")}
                        className={`px-3 py-1 rounded text-sm ${
                          previewSearchMode === "startsWith"
                            ? "bg-blue-600 text-white"
                            : "bg-gray-200 text-black hover:bg-gray-300"
                        }`}
                      >
                        Starts With
                      </button>
                    </div>

                    {/* Column Search Inputs */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-black font-medium">Search Column 2 (Timestamp):</label>
                        <input
                          type="text"
                          placeholder="e.g., 01/15"
                          value={previewCol2Search}
                          onChange={(e) => setPreviewCol2Search(e.target.value)}
                          className="w-full px-2 py-1 border rounded text-sm text-black mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-black font-medium">Search Column 3 (Data):</label>
                        <input
                          type="text"
                          placeholder="e.g., John"
                          value={previewCol3Search}
                          onChange={(e) => setPreviewCol3Search(e.target.value)}
                          className="w-full px-2 py-1 border rounded text-sm text-black mt-1"
                        />
                      </div>
                    </div>

                    {(previewCol2Search.trim() || previewCol3Search.trim()) && (
                      <span className="text-sm text-black font-medium">
                        {previewSearchResults.length} match{previewSearchResults.length !== 1 ? "es" : ""}
                      </span>
                    )}
                  </div>

                  <div className="overflow-y-auto flex-1" ref={previewTableRef}>
                    <table className="w-full text-xs border-collapse">
                      <thead className="sticky top-0 bg-gray-100 border-b">
                        <tr>
                          <th className="px-3 py-2 text-left text-black font-semibold w-8 text-right">#</th>
                          <th className="px-3 py-2 text-left text-black font-semibold">Column 1</th>
                          <th className="px-3 py-2 text-left text-black font-semibold">Column 2 (Timestamp)</th>
                          <th className="px-3 py-2 text-left text-black font-semibold">Column 3 (Data)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, idx) => {
                          const isSearchMatch = previewSearchResults.includes(idx) || (!previewCol2Search.trim() && !previewCol3Search.trim())
                          if (!isSearchMatch) return null

                          const col1 = row[0] ? String(row[0]) : ""
                          const col2 = row[1] ? String(row[1]) : ""
                          const col3 = row.slice(2).join(" | ")

                          return (
                            <tr
                              key={idx}
                              className={`border-b ${
                                previewSearchResults.includes(idx) && (previewCol2Search.trim() || previewCol3Search.trim())
                                  ? "bg-yellow-100"
                                  : ""
                              }`}
                              data-row-idx={idx}
                            >
                              <td className="px-3 py-2 font-mono text-black font-semibold text-right select-none">
                                {idx + 1}
                              </td>
                              <td className="px-3 py-2 text-black whitespace-pre-wrap break-words select-text">
                                {col1}
                              </td>
                              <td className="px-3 py-2 text-black whitespace-pre-wrap break-words select-text">
                                {previewCol2Search.trim()
                                  ? highlightPreviewText(col2, previewCol2Search, previewSearchMode)
                                  : col2}
                              </td>
                              <td className="px-3 py-2 text-black whitespace-pre-wrap break-words select-text">
                                {previewCol3Search.trim()
                                  ? highlightPreviewText(col3, previewCol3Search, previewSearchMode)
                                  : col3}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
