'use client'

import { useState } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileSpreadsheet, Calendar, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useData } from '@/lib/data-context'
import { formatFileSize, getRainbowColor } from '@/lib/types'
import type { MonthFolder, DayFolder, ExcelFile } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'

interface FolderNavigatorProps {
  className?: string
}

export function FolderNavigator({ className }: FolderNavigatorProps) {
  const { 
    yearData, 
    selectedMonth, 
    selectedDay,
    selectedFiles,
    selectMonth, 
    selectDay,
    toggleFileSelection,
    selectAllFiles,
    clearFileSelection,
    loadYear,
    isLoading,
    mergeDay,
    mergeSelectedFiles
  } = useData()
  
  const [expandedMonths, setExpandedMonths] = useState<Set<number>>(new Set())
  const [selectedYear, setSelectedYear] = useState(2023)

  const toggleMonthExpanded = (month: number) => {
    setExpandedMonths(prev => {
      const next = new Set(prev)
      if (next.has(month)) {
        next.delete(month)
      } else {
        next.add(month)
      }
      return next
    })
  }

  const handleYearChange = (year: number) => {
    setSelectedYear(year)
    loadYear(year)
  }

  const handleMonthClick = (month: MonthFolder) => {
    selectMonth(month)
    toggleMonthExpanded(month.month)
  }

  const handleDayClick = (day: DayFolder) => {
    selectDay(day)
  }

  const isFileSelected = (file: ExcelFile) => {
    return selectedFiles.some(f => f.id === file.id)
  }

  return (
    <div className={cn("flex flex-col h-full bg-sidebar border-r border-sidebar-border", className)}>
      {/* Header */}
      <div className="p-4 border-b border-sidebar-border">
        <h2 className="text-sm font-semibold text-sidebar-foreground mb-3">Data Navigator</h2>
        
        {/* Year Selector */}
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <select 
            value={selectedYear}
            onChange={(e) => handleYearChange(Number(e.target.value))}
            className="flex-1 bg-sidebar-accent text-sidebar-foreground text-sm rounded-md px-2 py-1.5 border border-sidebar-border focus:outline-none focus:ring-1 focus:ring-sidebar-ring"
          >
            {[2023, 2024, 2025, 2026].map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={() => loadYear(selectedYear)}
            disabled={isLoading}
            className="text-xs"
          >
            Load
          </Button>
        </div>
      </div>

      {/* Stats Bar */}
      {yearData && (
        <div className="px-4 py-2 border-b border-sidebar-border bg-sidebar-accent/50">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{yearData.totalFiles} files</span>
            <span>{yearData.totalRows.toLocaleString()} rows</span>
          </div>
        </div>
      )}

      {/* Folder Tree */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : yearData ? (
            <div className="space-y-0.5">
              {yearData.months.map(month => (
                <MonthItem
                  key={month.month}
                  month={month}
                  isExpanded={expandedMonths.has(month.month)}
                  isSelected={selectedMonth?.month === month.month}
                  selectedDay={selectedDay}
                  selectedFiles={selectedFiles}
                  onToggle={() => toggleMonthExpanded(month.month)}
                  onSelect={() => handleMonthClick(month)}
                  onDaySelect={handleDayClick}
                  onFileToggle={toggleFileSelection}
                  isFileSelected={isFileSelected}
                  onMergeDay={mergeDay}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Select a year and click Load to view data
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Selection Actions */}
      {selectedDay && (
        <div className="p-3 border-t border-sidebar-border bg-sidebar-accent/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">
              {selectedFiles.length} of {selectedDay.files.length} files selected
            </span>
          </div>
          <div className="flex gap-2 mb-2">
            <Button 
              size="sm" 
              variant="outline" 
              onClick={selectAllFiles}
              className="flex-1 text-xs bg-transparent"
            >
              Select All
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={clearFileSelection}
              className="flex-1 text-xs bg-transparent"
            >
              Clear
            </Button>
          </div>
          <Button 
            size="sm" 
            onClick={mergeSelectedFiles}
            disabled={selectedFiles.length === 0}
            className="w-full text-xs"
          >
            Merge Selected ({selectedFiles.length} files)
          </Button>
        </div>
      )}
    </div>
  )
}

interface MonthItemProps {
  month: MonthFolder
  isExpanded: boolean
  isSelected: boolean
  selectedDay: DayFolder | null
  selectedFiles: ExcelFile[]
  onToggle: () => void
  onSelect: () => void
  onDaySelect: (day: DayFolder) => void
  onFileToggle: (file: ExcelFile) => void
  isFileSelected: (file: ExcelFile) => boolean
  onMergeDay: (day: DayFolder) => void
}

function MonthItem({ 
  month, 
  isExpanded, 
  isSelected,
  selectedDay,
  selectedFiles,
  onToggle, 
  onSelect,
  onDaySelect,
  onFileToggle,
  isFileSelected,
  onMergeDay
}: MonthItemProps) {
  return (
    <div>
      <button
        onClick={() => {
          onSelect()
          if (!isExpanded) onToggle()
        }}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
          "hover:bg-sidebar-accent",
          isSelected && "bg-sidebar-accent text-sidebar-accent-foreground"
        )}
      >
        <span className="text-muted-foreground" onClick={(e) => { e.stopPropagation(); onToggle() }}>
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        {isExpanded ? (
          <FolderOpen className="w-4 h-4 text-primary" />
        ) : (
          <Folder className="w-4 h-4 text-muted-foreground" />
        )}
        <span className="flex-1 text-left truncate">{month.name}</span>
        <Badge variant="secondary" className="text-[10px] px-1.5">
          {month.days.length}d
        </Badge>
      </button>
      
      {isExpanded && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-2">
          {month.days.map(day => (
            <DayItem
              key={day.date}
              day={day}
              isSelected={selectedDay?.date === day.date}
              selectedFiles={selectedFiles}
              onSelect={() => onDaySelect(day)}
              onFileToggle={onFileToggle}
              isFileSelected={isFileSelected}
              onMergeDay={onMergeDay}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface DayItemProps {
  day: DayFolder
  isSelected: boolean
  selectedFiles: ExcelFile[]
  onSelect: () => void
  onFileToggle: (file: ExcelFile) => void
  isFileSelected: (file: ExcelFile) => boolean
  onMergeDay: (day: DayFolder) => void
}

function DayItem({ 
  day, 
  isSelected, 
  selectedFiles,
  onSelect,
  onFileToggle,
  isFileSelected,
  onMergeDay
}: DayItemProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const dayNumber = new Date(day.date).getDate()
  const dayName = new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })

  return (
    <div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => {
            onSelect()
            setIsExpanded(true)
          }}
          className={cn(
            "flex-1 flex items-center gap-2 px-2 py-1 rounded-md text-sm transition-colors",
            "hover:bg-sidebar-accent",
            isSelected && "bg-primary/10 text-foreground"
          )}
        >
          <span 
            className="text-muted-foreground" 
            onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded) }}
          >
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
          <Clock className="w-3 h-3 text-muted-foreground" />
          <span className="flex-1 text-left">
            <span className="font-medium">{dayNumber}</span>
            <span className="text-muted-foreground ml-1 text-xs">{dayName}</span>
          </span>
          <Badge variant="outline" className="text-[10px] px-1.5">
            {day.files.length}
          </Badge>
        </button>
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation()
            onMergeDay(day)
          }}
          className="h-6 px-2 text-[10px] text-primary hover:text-primary hover:bg-primary/10"
        >
          Merge
        </Button>
      </div>

      {isExpanded && isSelected && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-sidebar-border/50 pl-2">
          {day.files.map((file, index) => (
            <FileItem
              key={file.id}
              file={file}
              index={index}
              isSelected={isFileSelected(file)}
              onToggle={() => onFileToggle(file)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface FileItemProps {
  file: ExcelFile
  index: number
  isSelected: boolean
  onToggle: () => void
}

function FileItem({ file, index, isSelected, onToggle }: FileItemProps) {
  const color = getRainbowColor(index)
  
  // Format time blocks for display (e.g., "6-8, 10-12, 2-4")
  const formatTimeBlocks = () => {
    return file.timeBlocks.map(block => {
      const startH = parseInt(block.start.split(':')[0], 10)
      const endH = parseInt(block.end.split(':')[0], 10)
      const formatH = (h: number) => h > 12 ? `${h - 12}` : `${h}`
      return `${formatH(startH)}-${formatH(endH)}`
    }).join(', ')
  }
  
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-2 rounded-md text-xs transition-colors cursor-pointer",
        "hover:bg-sidebar-accent",
        isSelected && "bg-sidebar-accent"
      )}
      onClick={onToggle}
    >
      <Checkbox 
        checked={isSelected} 
        onCheckedChange={onToggle}
        className="w-3 h-3"
      />
      <div 
        className="w-2 h-6 rounded-sm flex-shrink-0" 
        style={{ backgroundColor: color.hex }}
      />
      <FileSpreadsheet className="w-3 h-3 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="font-medium text-foreground">File {file.fileNumber}</span>
        <span 
          className="text-[10px] text-muted-foreground"
        >
          {formatTimeBlocks()}
        </span>
      </div>
      <span className="text-[10px] text-muted-foreground/70">{file.rowCount} rows</span>
    </div>
  )
}
