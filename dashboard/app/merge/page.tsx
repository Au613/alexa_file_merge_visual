'use client'

import { useState } from 'react'
import { Upload, Download, FileSpreadsheet, X, AlertCircle, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface UploadedFile {
  id: string
  name: string
  size: number
  file: File
}

interface MergeInfo {
  standard: string
  withMetadata: string
  stats: {
    totalFiles: number
    totalRows: number
  }
  mergeMap?: Array<{ fileIndex: number; rowsFromFile: number[] }>
}

// Rainbow colors for sequential visualization
const RAINBOW_COLORS = [
  '#DC143C', // Crimson
  '#FF8C00', // Orange
  '#DAA520', // Goldenrod
  '#228B22', // Forest Green
  '#4169E1', // Royal Blue
  '#6A5ACD', // Slate Blue
  '#9370DB', // Medium Purple
  '#CD5C5C', // Indian Red
  '#20B2AA', // Light Sea Green
  '#8FBC8F', // Dark Sea Green
  '#B22222', // Firebrick
  '#6495ED', // Cornflower Blue
]

export default function MergePage() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [mergeInfo, setMergeInfo] = useState<MergeInfo | null>(null)

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

  const handleMerge = async () => {
    if (files.length === 0) {
      setError('Please upload at least one file')
      return
    }

    setIsProcessing(true)
    setError(null)
    setSuccess(false)

    try {
      const formData = new FormData()
      files.forEach(f => {
        formData.append('files', f.file)
      })

      const response = await fetch('/api/merge', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        throw new Error('Failed to merge files')
      }

      const data: MergeInfo = await response.json()
      setMergeInfo(data)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to merge files')
    } finally {
      setIsProcessing(false)
    }
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

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-semibold mb-2">Merge Excel Files</h2>
        <p className="text-muted-foreground">
          Upload multiple Excel files to merge them into a single file. You can download two versions: 
          one standard and one with source file and row number metadata.
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
          <span className="text-sm">Files merged successfully! Ready to download.</span>
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
            Select Files to Merge
          </CardTitle>
          <CardDescription>
            Upload multiple Excel files (.xls or .xlsx)
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

      {/* Merge Button */}
      <div className="flex gap-2">
        <Button
          onClick={handleMerge}
          disabled={files.length === 0 || isProcessing}
          className="flex-1"
        >
          {isProcessing ? 'Merging...' : 'Merge Files'}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setFiles([])
            setSuccess(false)
            setMergeInfo(null)
          }}
          disabled={isProcessing}
        >
          Clear
        </Button>
      </div>

      {/* Merge Visualization */}
      {mergeInfo && (
        <Card className="bg-blue-500/5 border-blue-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Merge Visualization</CardTitle>
            <CardDescription>
              Shows how rows from each file were distributed in the merged output (colors show sequential order)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {files.map((file, fileIdx) => (
              <div key={file.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">File {fileIdx + 1}: {file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {mergeInfo.mergeMap?.[fileIdx]?.rowsFromFile.length || 0} rows in merged output
                  </p>
                </div>
                <div className="flex gap-0.5 h-8 bg-muted rounded overflow-hidden">
                  {mergeInfo.mergeMap?.[fileIdx]?.rowsFromFile.map((mergeOrderIdx, idx) => {
                    const colorIdx = mergeOrderIdx % RAINBOW_COLORS.length
                    const color = RAINBOW_COLORS[colorIdx]
                    return (
                      <div
                        key={idx}
                        className="flex-1 h-full transition-all hover:opacity-75"
                        style={{ backgroundColor: color }}
                        title={`Row ${idx + 1} (merge order: ${mergeOrderIdx + 1})`}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
            
            {/* Color Legend */}
            <div className="mt-4 p-3 rounded-lg  border border-blue-500/20">
              <p className="text-xs font-medium mb-2">Color Legend (Sequential Merge Order)</p>
              <div className="grid grid-cols-6 gap-2">
                {RAINBOW_COLORS.slice(0, Math.min(12, (mergeInfo.stats.totalRows || 12))).map((color, idx) => (
                  <div key={idx} className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded" style={{ backgroundColor: color }} />
                    <span className="text-[10px] text-muted-foreground">#{idx + 1}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-3 rounded-lg  border border-blue-500/20">
              <p className="text-sm font-medium">Merge Statistics</p>
              <div className="text-xs text-muted-foreground mt-2 space-y-1">
                <p>Total Files: {mergeInfo.stats.totalFiles}</p>
                <p>Total Rows in Merged File: {mergeInfo.stats.totalRows}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Download Section */}
      {mergeInfo && (
        <Card className="bg-green-500/5 border-green-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Download Merged Files</CardTitle>
            <CardDescription>
              Two versions are available for download
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-3 rounded-lg  border border-green-500/20">
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

            <div className="p-3 rounded-lg  border border-green-500/20">
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
