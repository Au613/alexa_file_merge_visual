'use client'

import React from "react"

import { useState, useCallback } from 'react'
import { Upload, FileSpreadsheet, X, Check, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { UploadedFile } from '@/lib/types'
import { parseExcelFile } from '@/lib/diff-analysis'

interface FileUploadProps {
  onFilesUploaded: (originalFiles: UploadedFile[], mergedFile: UploadedFile) => void
}

export function FileUpload({ onFilesUploaded }: FileUploadProps) {
  const [originalFiles, setOriginalFiles] = useState<UploadedFile[]>([])
  const [mergedFile, setMergedFile] = useState<UploadedFile | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<'original' | 'merged' | null>(null)

  const handleOriginalFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    
    setIsProcessing(true)
    setError(null)
    
    try {
      const parsedFiles: UploadedFile[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (file.name.endsWith('.xls') || file.name.endsWith('.xlsx')) {
          const parsed = await parseExcelFile(file)
          parsedFiles.push(parsed)
        }
      }
      setOriginalFiles(prev => [...prev, ...parsedFiles])
    } catch (err) {
      setError('Failed to parse original files. Please ensure they are valid Excel files.')
    } finally {
      setIsProcessing(false)
    }
  }, [])

  const handleMergedFile = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    
    setIsProcessing(true)
    setError(null)
    
    try {
      const file = files[0]
      if (file.name.endsWith('.xls') || file.name.endsWith('.xlsx')) {
        const parsed = await parseExcelFile(file)
        setMergedFile(parsed)
      } else {
        setError('Please upload a valid Excel file (.xls or .xlsx)')
      }
    } catch (err) {
      setError('Failed to parse merged file. Please ensure it is a valid Excel file.')
    } finally {
      setIsProcessing(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, type: 'original' | 'merged') => {
    e.preventDefault()
    setDragOver(null)
    
    const files = e.dataTransfer.files
    if (type === 'original') {
      handleOriginalFiles(files)
    } else {
      handleMergedFile(files)
    }
  }, [handleOriginalFiles, handleMergedFile])

  const handleDragOver = useCallback((e: React.DragEvent, type: 'original' | 'merged') => {
    e.preventDefault()
    setDragOver(type)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOver(null)
  }, [])

  const removeOriginalFile = useCallback((id: string) => {
    setOriginalFiles(prev => prev.filter(f => f.id !== id))
  }, [])

  const canAnalyze = originalFiles.length > 0 && mergedFile !== null

  const handleAnalyze = useCallback(() => {
    if (canAnalyze) {
      onFilesUploaded(originalFiles, mergedFile!)
    }
  }, [canAnalyze, originalFiles, mergedFile, onFilesUploaded])

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-semibold mb-2">Upload Files for Analysis</h2>
        <p className="text-muted-foreground">
          Upload the original Excel files and the merged output file to see what changes were made during the merge process.
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

      <div className="grid md:grid-cols-2 gap-6">
        {/* Original Files Upload */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-blue-500" />
              Original Files
            </CardTitle>
            <CardDescription>
              Upload the source Excel files (before merging)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-6 text-center transition-colors",
                dragOver === 'original' && "border-blue-500 bg-blue-500/10",
                !dragOver && "border-muted-foreground/25 hover:border-muted-foreground/50"
              )}
              onDrop={(e) => handleDrop(e, 'original')}
              onDragOver={(e) => handleDragOver(e, 'original')}
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
                  onChange={(e) => handleOriginalFiles(e.target.files)}
                  disabled={isProcessing}
                />
                <Button variant="outline" size="sm" asChild disabled={isProcessing}>
                  <span>Browse Files</span>
                </Button>
              </label>
            </div>

            {originalFiles.length > 0 && (
              <div className="mt-4 space-y-2">
                {originalFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                      <span className="truncate">{file.name}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {file.rows.length} rows
                      </Badge>
                    </div>
                    <button
                      onClick={() => removeOriginalFile(file.id)}
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

        {/* Merged File Upload */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-green-500" />
              Merged File
            </CardTitle>
            <CardDescription>
              Upload the final merged Excel file
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-6 text-center transition-colors",
                dragOver === 'merged' && "border-green-500 bg-green-500/10",
                !dragOver && "border-muted-foreground/25 hover:border-muted-foreground/50"
              )}
              onDrop={(e) => handleDrop(e, 'merged')}
              onDragOver={(e) => handleDragOver(e, 'merged')}
              onDragLeave={handleDragLeave}
            >
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-2">
                Drag and drop the merged file here, or
              </p>
              <label>
                <input
                  type="file"
                  accept=".xls,.xlsx"
                  className="hidden"
                  onChange={(e) => handleMergedFile(e.target.files)}
                  disabled={isProcessing}
                />
                <Button variant="outline" size="sm" asChild disabled={isProcessing}>
                  <span>Browse File</span>
                </Button>
              </label>
            </div>

            {mergedFile && (
              <div className="mt-4">
                <div className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <span className="truncate">{mergedFile.name}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {mergedFile.rows.length} rows
                    </Badge>
                  </div>
                  <button
                    onClick={() => setMergedFile(null)}
                    className="p-1 hover:bg-muted rounded flex-shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary and Analyze Button */}
      <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border">
        <div className="text-sm">
          <span className="text-muted-foreground">Ready to analyze: </span>
          <span className="font-medium">{originalFiles.length} original file(s)</span>
          <span className="text-muted-foreground"> + </span>
          <span className="font-medium">{mergedFile ? '1 merged file' : 'No merged file'}</span>
        </div>
        <Button 
          onClick={handleAnalyze}
          disabled={!canAnalyze || isProcessing}
        >
          {isProcessing ? 'Processing...' : 'Analyze Merge'}
        </Button>
      </div>
    </div>
  )
}
