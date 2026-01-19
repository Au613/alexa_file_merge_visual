'use client'

import { useMemo } from 'react'
import { FileSpreadsheet, Database, Clock, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useData } from '@/lib/data-context'
import { getRainbowColor } from '@/lib/types'

interface StatsPanelProps {
  className?: string
}

export function StatsPanel({ className }: StatsPanelProps) {
  const { yearData, selectedMonth, selectedDay, filteredData, mergedData, selectedFiles } = useData()

  // Get unique subjects
  const uniqueSubjects = useMemo(() => {
    const subjects = new Set(filteredData.map(row => row.subject))
    return subjects.size
  }, [filteredData])

  // Calculate time range
  const timeRange = useMemo(() => {
    if (filteredData.length === 0) return '-'
    
    const times = filteredData.map(row => row.time).sort()
    const first = times[0]
    const last = times[times.length - 1]
    
    const formatTime = (t: string) => {
      const [h, m] = t.split(':')
      const hour = parseInt(h, 10)
      const period = hour >= 12 ? 'PM' : 'AM'
      const displayHour = hour % 12 || 12
      return `${displayHour}:${m} ${period}`
    }
    
    return `${formatTime(first)} - ${formatTime(last)}`
  }, [filteredData])

  const stats = [
    {
      label: 'Total Files',
      value: selectedDay 
        ? selectedFiles.length 
        : selectedMonth 
          ? selectedMonth.totalFiles 
          : yearData?.totalFiles || 0,
      icon: FileSpreadsheet,
      color: 'text-red-500'
    },
    {
      label: 'Observations',
      value: filteredData.length.toLocaleString(),
      subValue: mergedData.length !== filteredData.length 
        ? `of ${mergedData.length.toLocaleString()}` 
        : undefined,
      icon: Database,
      color: 'text-green-500'
    },
    {
      label: 'Time Range',
      value: timeRange,
      icon: Clock,
      color: 'text-cyan-500'
    },
    {
      label: 'Unique Subjects',
      value: uniqueSubjects,
      icon: Users,
      color: 'text-blue-500'
    },
  ]

  return (
    <div className={cn("grid grid-cols-4 gap-4", className)}>
      {stats.map(stat => (
        <div 
          key={stat.label}
          className="bg-card border border-border rounded-lg p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">{stat.label}</span>
            <stat.icon className={cn("w-4 h-4", stat.color)} />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold">{stat.value}</span>
            {stat.subValue && (
              <span className="text-xs text-muted-foreground">{stat.subValue}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export function BehaviorBreakdown({ className }: { className?: string }) {
  const { filteredData } = useData()

  const behaviorStats = useMemo(() => {
    const stats = new Map<string, number>()
    filteredData.forEach(row => {
      const behavior = row.behavior
      stats.set(behavior, (stats.get(behavior) || 0) + 1)
    })
    return Array.from(stats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10) // Top 10 behaviors
  }, [filteredData])

  const total = filteredData.length

  if (filteredData.length === 0) return null

  return (
    <div className={cn("bg-card border border-border rounded-lg p-4", className)}>
      <h4 className="text-sm font-medium mb-3">Top Behavior Codes</h4>
      
      {/* Horizontal bar */}
      <div className="h-3 flex rounded-full overflow-hidden mb-4">
        {behaviorStats.map(([behavior, count], idx) => (
          <div
            key={behavior}
            className="h-full"
            style={{ 
              width: `${(count / total) * 100}%`,
              backgroundColor: getRainbowColor(idx).hex
            }}
            title={`${behavior}: ${count} (${((count / total) * 100).toFixed(1)}%)`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-2">
        {behaviorStats.map(([behavior, count], idx) => (
          <div key={behavior} className="flex items-center gap-2">
            <div 
              className="w-2 h-2 rounded-full flex-shrink-0" 
              style={{ backgroundColor: getRainbowColor(idx).hex }}
            />
            <span className="text-xs text-muted-foreground truncate flex-1" title={behavior}>
              {behavior}
            </span>
            <span className="text-xs font-medium">
              {((count / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SubjectBreakdown({ className }: { className?: string }) {
  const { filteredData } = useData()

  const subjectStats = useMemo(() => {
    const stats = new Map<string, number>()
    filteredData.forEach(row => {
      const subject = row.subject
      stats.set(subject, (stats.get(subject) || 0) + 1)
    })
    return Array.from(stats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8) // Top 8 subjects
  }, [filteredData])

  const total = filteredData.length

  if (filteredData.length === 0) return null

  return (
    <div className={cn("bg-card border border-border rounded-lg p-4", className)}>
      <h4 className="text-sm font-medium mb-3">Subject Distribution</h4>
      
      <div className="space-y-2">
        {subjectStats.map(([subject, count], idx) => {
          const percentage = (count / total) * 100
          return (
            <div key={subject} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground truncate max-w-[150px]" title={subject}>
                  {subject}
                </span>
                <span className="font-medium">{count}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full rounded-full transition-all duration-500"
                  style={{ 
                    width: `${percentage}%`,
                    backgroundColor: getRainbowColor(idx).hex
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
