'use client'

import { useState } from 'react'
import { Plus, Trash2, Power, PowerOff, Filter, ChevronDown, ChevronUp, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useData } from '@/lib/data-context'
import type { FilterRule, RuleOperator } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

const OPERATORS: { value: RuleOperator; label: string; requiresValue: boolean }[] = [
  { value: 'equals', label: 'Equals', requiresValue: true },
  { value: 'not_equals', label: 'Not equals', requiresValue: true },
  { value: 'contains', label: 'Contains', requiresValue: true },
  { value: 'not_contains', label: 'Does not contain', requiresValue: true },
  { value: 'starts_with', label: 'Starts with', requiresValue: true },
  { value: 'ends_with', label: 'Ends with', requiresValue: true },
  { value: 'time_after', label: 'Time after', requiresValue: true },
  { value: 'time_before', label: 'Time before', requiresValue: true },
  { value: 'is_empty', label: 'Is empty', requiresValue: false },
  { value: 'is_not_empty', label: 'Is not empty', requiresValue: false },
  { value: 'regex', label: 'Matches regex', requiresValue: true },
]

// Columns matching the actual data format
const COLUMNS = [
  { value: 'subject', label: 'Subject/Observer' },
  { value: 'timestamp', label: 'Full Timestamp' },
  { value: 'date', label: 'Date' },
  { value: 'time', label: 'Time' },
  { value: 'behavior', label: 'Behavior Code' },
  { value: '_timeRange', label: 'Time Block' },
  { value: '_sourceFileName', label: 'Source File' },
]

interface RuleBuilderProps {
  className?: string
}

export function RuleBuilder({ className }: RuleBuilderProps) {
  const { filterRules, addRule, deleteRule, toggleRule, applyFilters, clearFilters, filteredData, mergedData } = useData()
  const [isExpanded, setIsExpanded] = useState(true)
  const [isAddingRule, setIsAddingRule] = useState(false)

  // New rule form state
  const [newRuleName, setNewRuleName] = useState('')
  const [newRuleColumn, setNewRuleColumn] = useState('')
  const [newRuleOperator, setNewRuleOperator] = useState<RuleOperator>('contains')
  const [newRuleValue, setNewRuleValue] = useState('')

  const handleAddRule = () => {
    if (!newRuleName || !newRuleColumn) return

    addRule({
      name: newRuleName,
      column: newRuleColumn,
      operator: newRuleOperator,
      value: newRuleValue,
      enabled: true,
    })

    // Reset form
    setNewRuleName('')
    setNewRuleColumn('')
    setNewRuleOperator('contains')
    setNewRuleValue('')
    setIsAddingRule(false)
  }

  const activeRulesCount = filterRules.filter(r => r.enabled).length
  const currentOperator = OPERATORS.find(o => o.value === newRuleOperator)

  // Quick filter suggestions based on common patterns
  const quickFilters = [
    { name: 'Morning observations', column: 'time', operator: 'time_before' as RuleOperator, value: '12:00:00' },
    { name: 'Afternoon observations', column: 'time', operator: 'time_after' as RuleOperator, value: '12:00:00' },
    { name: 'Contains KAW', column: 'subject', operator: 'contains' as RuleOperator, value: 'KAW' },
    { name: 'Feeding behavior', column: 'behavior', operator: 'contains' as RuleOperator, value: 'FD' },
  ]

  return (
    <div className={cn("bg-card border border-border rounded-lg", className)}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-primary/10">
                <Filter className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Filter Rules</h3>
                <p className="text-xs text-muted-foreground">
                  {filterRules.length} rules ({activeRulesCount} active)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {mergedData.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {filteredData.length.toLocaleString()} / {mergedData.length.toLocaleString()} rows
                </Badge>
              )}
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-4">
            {/* Quick Filters */}
            {mergedData.length > 0 && filterRules.length === 0 && !isAddingRule && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Quick Filters</Label>
                <div className="flex flex-wrap gap-2">
                  {quickFilters.map(qf => (
                    <Button
                      key={qf.name}
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs bg-transparent"
                      onClick={() => {
                        addRule({
                          name: qf.name,
                          column: qf.column,
                          operator: qf.operator,
                          value: qf.value,
                          enabled: true,
                        })
                        setTimeout(applyFilters, 0)
                      }}
                    >
                      {qf.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Existing Rules */}
            {filterRules.length > 0 && (
              <ScrollArea className="max-h-[200px]">
                <div className="space-y-2">
                  {filterRules.map(rule => (
                    <RuleItem
                      key={rule.id}
                      rule={rule}
                      onToggle={() => {
                        toggleRule(rule.id)
                        setTimeout(applyFilters, 0)
                      }}
                      onDelete={() => {
                        deleteRule(rule.id)
                        setTimeout(applyFilters, 0)
                      }}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}

            {/* Add Rule Form */}
            {isAddingRule ? (
              <div className="space-y-3 p-3 bg-muted/50 rounded-lg border border-border">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">New Rule</h4>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setIsAddingRule(false)}
                    className="h-6 w-6 p-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>

                <div className="grid gap-3">
                  <div>
                    <Label className="text-xs">Rule Name</Label>
                    <Input
                      placeholder="e.g., Filter by behavior code"
                      value={newRuleName}
                      onChange={e => setNewRuleName(e.target.value)}
                      className="h-8 text-sm mt-1"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Column</Label>
                      <Select value={newRuleColumn} onValueChange={setNewRuleColumn}>
                        <SelectTrigger className="h-8 text-sm mt-1">
                          <SelectValue placeholder="Select column" />
                        </SelectTrigger>
                        <SelectContent>
                          {COLUMNS.map(col => (
                            <SelectItem key={col.value} value={col.value}>
                              {col.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-xs">Operator</Label>
                      <Select value={newRuleOperator} onValueChange={(v) => setNewRuleOperator(v as RuleOperator)}>
                        <SelectTrigger className="h-8 text-sm mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OPERATORS.map(op => (
                            <SelectItem key={op.value} value={op.value}>
                              {op.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {currentOperator?.requiresValue && (
                    <div>
                      <Label className="text-xs">Value</Label>
                      <Input
                        placeholder={
                          newRuleOperator === 'time_after' || newRuleOperator === 'time_before'
                            ? 'e.g., 10:00:00'
                            : 'Enter value...'
                        }
                        value={newRuleValue}
                        onChange={e => setNewRuleValue(e.target.value)}
                        className="h-8 text-sm mt-1"
                      />
                      {(newRuleOperator === 'time_after' || newRuleOperator === 'time_before') && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Format: H:MM:SS or HH:MM:SS (e.g., 8:30:00 or 14:00:00)
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={handleAddRule}
                      disabled={!newRuleName || !newRuleColumn}
                      className="flex-1"
                    >
                      Add Rule
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsAddingRule(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsAddingRule(true)}
                  className="flex-1"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add Rule
                </Button>
                {filterRules.length > 0 && (
                  <>
                    <Button
                      size="sm"
                      onClick={applyFilters}
                      className="flex-1"
                    >
                      <Settings2 className="w-3 h-3 mr-1" />
                      Apply
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={clearFilters}
                    >
                      Clear
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

interface RuleItemProps {
  rule: FilterRule
  onToggle: () => void
  onDelete: () => void
}

function RuleItem({ rule, onToggle, onDelete }: RuleItemProps) {
  const column = COLUMNS.find(c => c.value === rule.column)
  const operator = OPERATORS.find(o => o.value === rule.operator)

  const formatValue = () => {
    if (Array.isArray(rule.value)) {
      return `${rule.value[0]} - ${rule.value[1]}`
    }
    return String(rule.value)
  }

  return (
    <div className={cn(
      "flex items-center gap-3 p-2 rounded-md border transition-colors",
      rule.enabled 
        ? "bg-primary/5 border-primary/20" 
        : "bg-muted/50 border-border opacity-60"
    )}>
      <Switch
        checked={rule.enabled}
        onCheckedChange={onToggle}
        className="scale-75"
      />
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{rule.name}</span>
          {rule.enabled ? (
            <Power className="w-3 h-3 text-primary" />
          ) : (
            <PowerOff className="w-3 h-3 text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Badge variant="outline" className="text-[10px] px-1">
            {column?.label || rule.column}
          </Badge>
          <span>{operator?.label}</span>
          {operator?.requiresValue && (
            <span className="font-mono text-foreground">{formatValue()}</span>
          )}
        </div>
      </div>

      <Button
        size="sm"
        variant="ghost"
        onClick={onDelete}
        className="h-6 w-6 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  )
}
