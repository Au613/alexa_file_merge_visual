'use client'

import { useState } from 'react'
import { Upload, FileSpreadsheet, X, AlertCircle, CheckCircle, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import * as XLSX from 'xlsx'

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
  mergeMap?: Array<{ fileIndex: number; rowsFromFile: number[] }>
}

// Rainbow colors for visualization
const RAINBOW_COLORS = [
  '#DC143C', '#FF8C00', '#DAA520', '#228B22', '#4169E1', '#6A5ACD',
  '#9370DB', '#CD5C5C', '#20B2AA', '#8FBC8F', '#B22222', '#6495ED',
]

export default function MergeAnalysisPage() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [analysis, setAnalysis] = useState<MergeAnalysis | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

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
    const excelFiles = newFiles.filter(f => f.name.endsWith('.xls') || f.name.endsWith('.xlsx'))
    
    if (excelFiles.length === 0) {
      setError('Please upload Excel files (.xls or .xlsx)')
      return
    }

    const uploadedFiles = excelFiles.map(f => ({
      id: Math.random().toString(36).substring(2),
      name: f.name,
      size: f.size,
      file: f
    }))

    setFiles(prev => [...prev, ...uploadedFiles])
    setError(null)
  }

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  const downloadFile = async (version: 'standard' | 'withMetadata') => {
    try {
      const response = await fetch(`/api/merge?version=${version}`)
      if (!response.ok) throw new Error('Download failed')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = version === 'standard' 
        ? 'merged_file.xls'
        : 'merged_file_with_metadata.xls'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      setError('Failed to download file')
    }
  }

  const parseExcelFile = (buffer: Buffer): any[][] => {
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    return XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][]
  }

  const handleMergeAndAnalyze = async () => {
    if (files.length === 0) {
      setError('Please upload at least one file')
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
        originalData.push({ fileName: file.name, rows })
      }

      // Step 2: Send to merge API
      const formData = new FormData()
      files.forEach(f => {
        formData.append('files', f.file)
      })

      const mergeResponse = await fetch('/api/merge', {
        method: 'POST',
        body: formData
      })

      if (!mergeResponse.ok) {
        throw new Error('Failed to merge files')
      }

      const mergeData = await mergeResponse.json()

      // Step 3: Get the merged metadata file
      const downloadResponse = await fetch('/api/merge?version=withMetadata')
      if (!downloadResponse.ok) {
        throw new Error('Failed to retrieve merged metadata')
      }

      const mergedBuffer = await downloadResponse.arrayBuffer()
      const mergedRows = parseExcelFile(Buffer.from(mergedBuffer))

      // Step 4: Build source map from merged file (columns: Author, DateTime, Data, Source File, Original Row #)
      const sourceMap = new Map<string, Set<number>>() // key: "filename|rowNum"

      for (let i = 1; i < mergedRows.length; i++) {
        const row = mergedRows[i]
        if (row.length >= 5) {
          const sourceFile = String(row[3])
          const originalRowNum = row[4]
          const key = `${sourceFile}|${originalRowNum}`
          sourceMap.set(key, new Set([i - 1])) // i-1 because we skip header
        }
      }

      // Step 5: Analyze each original file
      const analysisResults = originalData.map((data, fileIdx) => {
        const keptIndices: number[] = []
        const droppedIndices: number[] = []

        // Skip header row (row 0)
        for (let rowIdx = 1; rowIdx < data.rows.length; rowIdx++) {
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
          totalRows: data.rows.length - 1, // exclude header
          keptRows: keptIndices.length,
          droppedRows: droppedIndices.length,
          keptIndices,
          droppedIndices
        }
      })

      const totalOriginalRows = analysisResults.reduce((sum, f) => sum + f.totalRows, 0)
      const totalMergedRows = mergedRows.length - 1 // exclude header

      setAnalysis({
        originalFiles: analysisResults,
        totalOriginalRows,
        totalMergedRows,
        mergeMap: mergeData.mergeMap
      })
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process files')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-semibold mb-2">Merge & Analysis</h2>
        <p className="text-muted-foreground">
          Upload original files, merge them, and analyze which rows were kept vs dropped.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive border border-destructive/20">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">{error}</span>
          <button 
            onClick={() => setError(null)}
            className="ml-auto p-1 hover:bg-destructive/20 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 text-green-700 border border-green-500/20">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">Merge complete and analysis finished! Check the results below.</span>
          <button 
            onClick={() => setSuccess(false)}
            className="ml-auto p-1 hover:bg-green-500/20 rounded"
          >
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
          <CardDescription>
            Upload the source Excel files that will be merged and analyzed
          </CardDescription>
        </CardHeader>
        <CardContent>
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
            <p className="text-sm text-muted-foreground mb-2">
              Drag and drop Excel files here, or
            </p>
            <label>
              <input
                type="file"
                multiple
                accept=".xls,.xlsx"
                className="hidden"
                onChange={handleFileInput}
                disabled={isProcessing}
              />
              <Button variant="outline" size="sm" asChild disabled={isProcessing}>
                <span>Browse Files</span>
              </Button>
            </label>
          </div>

          {files.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium">Selected Files ({files.length})</p>
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileSpreadsheet className="w-4 h-4 text-blue-500 flex-shrink-0" />
                    <span className="truncate">{file.name}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {(file.size / 1024).toFixed(1)} KB
                    </Badge>
                  </div>
                  <button
                    onClick={() => removeFile(file.id)}
                    className="p-1 hover:bg-muted rounded flex-shrink-0"
                  >
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
        <Button
          onClick={handleMergeAndAnalyze}
          disabled={files.length === 0 || isProcessing}
          className="flex-1"
          size="lg"
        >
          {isProcessing ? 'Processing...' : 'Merge & Analyze'}
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
        <div className="space-y-6">
      {/* Summary Stats */}
          <Card className="bg-blue-500/5 border-blue-500/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="p-3 rounded-lg border border-blue-500/20">
                  <p className="text-xs text-muted-foreground mb-1">Total Original Rows</p>
                  <p className="text-2xl font-semibold">{analysis.totalOriginalRows}</p>
                </div>
                <div className="p-3 rounded-lg border border-blue-500/20">
                  <p className="text-xs text-muted-foreground mb-1">Total Merged Rows</p>
                  <p className="text-2xl font-semibold">{analysis.totalMergedRows}</p>
                </div>
                <div className="p-3 rounded-lg border border-blue-500/20">
                  <p className="text-xs text-muted-foreground mb-1">Rows Dropped</p>
                  <p className="text-2xl font-semibold">
                    {analysis.totalOriginalRows - analysis.totalMergedRows}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Merged File - Source Blocks Visualization */}
          {analysis.mergeMap && (
            <Card className="bg-purple-500/5 border-purple-500/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Merged File - Source Blocks</CardTitle>
                <CardDescription>
                  Shows which original file each block of rows came from in the merged output
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <p className="text-sm font-medium">Merged</p>
                  <div className="flex gap-0.5 h-8 bg-muted rounded overflow-hidden">
                    {Array.from({ length: analysis.totalMergedRows }).map((_, mergedIdx) => {
                      // Find which file this merged position came from
                      let sourceFileIdx = 0
                      if (analysis.mergeMap) {
                        for (let fIdx = 0; fIdx < analysis.mergeMap.length; fIdx++) {
                          if (analysis.mergeMap[fIdx].rowsFromFile.includes(mergedIdx)) {
                            sourceFileIdx = fIdx
                            break
                          }
                        }
                      }
                      const color = RAINBOW_COLORS[sourceFileIdx % RAINBOW_COLORS.length]
                      return (
                        <div
                          key={mergedIdx}
                          className="flex-1 h-full transition-all hover:opacity-75"
                          style={{ backgroundColor: color }}
                          title={`Row ${mergedIdx + 1} (from File ${sourceFileIdx + 1})`}
                        />
                      )
                    })}
                  </div>
                </div>

                {/* Legend */}
                <div className="p-3 rounded-lg border border-purple-500/20">
                  <p className="text-xs font-medium mb-2">File Legend</p>
                  <div className="grid grid-cols-2 gap-2">
                    {analysis.originalFiles.map((file) => (
                      <div key={file.fileIndex} className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded"
                          style={{ backgroundColor: RAINBOW_COLORS[file.fileIndex % RAINBOW_COLORS.length] }}
                        />
                        <span className="text-xs text-muted-foreground">{file.fileName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Per-File Analysis */}
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="details">Detailed Rows</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              {analysis.originalFiles.map((file) => {
                const keptPercent = file.totalRows > 0 ? (file.keptRows / file.totalRows) * 100 : 0
                const color = RAINBOW_COLORS[file.fileIndex % RAINBOW_COLORS.length]

                return (
                  <Card key={file.fileIndex}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded"
                            style={{ backgroundColor: color }}
                          />
                          {file.fileName}
                        </CardTitle>
                        <Badge variant="outline">
                          {file.keptRows} / {file.totalRows} rows kept
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Kept</span>
                          <span className="font-medium">{file.keptRows}</span>
                        </div>
                        <div className="h-2 bg-muted rounded overflow-hidden">
                          <div
                            className="h-full bg-green-500 transition-all"
                            style={{ width: `${keptPercent}%` }}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Dropped</span>
                          <span className="font-medium">{file.droppedRows}</span>
                        </div>
                        <div className="h-2 bg-muted rounded overflow-hidden">
                          <div
                            className="h-full bg-red-500 transition-all"
                            style={{ width: `${100 - keptPercent}%` }}
                          />
                        </div>
                      </div>

                      <div className="text-xs text-muted-foreground pt-2">
                        {keptPercent.toFixed(1)}% of rows from this file were included in the merge
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </TabsContent>

            <TabsContent value="details" className="space-y-4">
              {analysis.originalFiles.map((file) => (
                <Card key={file.fileIndex}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{file.fileName}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Kept Rows */}
                    <div>
                      <h4 className="text-sm font-medium mb-2 text-green-700">
                        Kept Rows ({file.keptRows})
                      </h4>
                      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 max-h-48 overflow-y-auto">
                        {file.keptIndices.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {file.keptIndices.map((idx) => (
                              <Badge key={idx} variant="secondary" className="bg-green-500/20 text-green-700 border-green-500/30">
                                Row {idx}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No rows kept</p>
                        )}
                      </div>
                    </div>

                    {/* Dropped Rows */}
                    <div>
                      <h4 className="text-sm font-medium mb-2 text-red-700">
                        Dropped Rows ({file.droppedRows})
                      </h4>
                      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 max-h-48 overflow-y-auto">
                        {file.droppedIndices.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {file.droppedIndices.map((idx) => (
                              <Badge key={idx} variant="secondary" className="bg-red-500/20 text-red-700 border-red-500/30">
                                Row {idx}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No rows dropped</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Download Section */}
      {analysis && (
        <Card className="bg-green-500/5 border-green-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Download Merged Files</CardTitle>
            <CardDescription>
              Download the final merged output in two formats
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-3 rounded-lg border border-green-500/20">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-medium text-sm">Standard Version</p>
                  <p className="text-xs text-muted-foreground">
                    Merged data without metadata columns
                  </p>
                </div>
              </div>
              <Button
                onClick={() => downloadFile('standard')}
                variant="outline"
                size="sm"
                className="w-full"
              >
                <Download className="w-4 h-4 mr-2" />
                Download Standard
              </Button>
            </div>

            <div className="p-3 rounded-lg border border-green-500/20">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-medium text-sm">With Metadata</p>
                  <p className="text-xs text-muted-foreground">
                    Includes source file name and original row number
                  </p>
                </div>
              </div>
              <Button
                onClick={() => downloadFile('withMetadata')}
                variant="outline"
                size="sm"
                className="w-full"
              >
                <Download className="w-4 h-4 mr-2" />
                Download With Metadata
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
