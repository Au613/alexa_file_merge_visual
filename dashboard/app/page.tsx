'use client'

import { useState, useCallback } from 'react'
import { FileSearch } from 'lucide-react'
import { DiffProvider, useDiff } from '@/lib/diff-context'
import { FileUpload } from '@/components/file-upload'
import { DiffVisualizer } from '@/components/diff-visualizer'
import type { UploadedFile } from '@/lib/types'

function AppContent() {
  const { setFiles, runAnalysis, hasAnalyzed, clearAll } = useDiff()
  const [showUpload, setShowUpload] = useState(true)

  const handleFilesUploaded = useCallback((originalFiles: UploadedFile[], mergedFile: UploadedFile) => {
    setFiles(originalFiles, mergedFile)
    runAnalysis(originalFiles, mergedFile)
    setShowUpload(false)
  }, [setFiles, runAnalysis])

  const handleBack = useCallback(() => {
    clearAll()
    setShowUpload(true)
  }, [clearAll])

  return (
    <div className="flex h-screen bg-background">
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileSearch className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Merge Analysis Tool</h1>
              <p className="text-sm text-muted-foreground">
                Compare original files with merged output to see what changed
              </p>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {showUpload ? (
            <FileUpload onFilesUploaded={handleFilesUploaded} />
          ) : (
            <DiffVisualizer onBack={handleBack} />
          )}
        </div>
      </main>
    </div>
  )
}

export default function Home() {
  return (
    <DiffProvider>
      <AppContent />
    </DiffProvider>
  )
}
