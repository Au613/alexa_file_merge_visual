import { AlertCircle, CheckCircle2, AlertTriangle, ChevronDown } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

interface ValidationResultItem {
  check: string
  passed: boolean
  issues: string[]
  warnings: string[]
}

interface ValidationPanelProps {
  validations: ValidationResultItem[]
  title?: string
  defaultOpen?: boolean
}

export function ValidationPanel({ validations, title = "Validation Results", defaultOpen = true }: ValidationPanelProps) {
  const allPassed = validations.every((v) => v.passed)
  const totalIssues = validations.reduce((sum, v) => sum + v.issues.length, 0)
  const totalWarnings = validations.reduce((sum, v) => sum + v.warnings.length, 0)

  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="w-full">
        <div className={cn("w-full p-4 rounded-lg border cursor-pointer transition-colors", allPassed ? "border-green-500/20 bg-green-500/5" : "border-red-500/20 bg-red-500/5")}>
          <div className="flex items-start gap-3">
            {allPassed ? <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />}
            <div className="flex-1 text-left">
              <div className="flex items-center gap-2">
                <p className="font-semibold">{title}</p>
                <span className={cn("text-xs px-2 py-1 rounded", allPassed ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800")}>
                  {allPassed ? "All Passed" : `${totalIssues} Issue${totalIssues !== 1 ? "s" : ""}`}
                </span>
                {totalWarnings > 0 && <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-800">{totalWarnings} Warning{totalWarnings !== 1 ? "s" : ""}</span>}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {validations.length} check{validations.length !== 1 ? "s" : ""} performed
              </p>
            </div>
            <ChevronDown className="w-5 h-5 transition-transform flex-shrink-0" />
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <div className="space-y-2">
          {validations.map((validation, idx) => (
            <Collapsible key={idx} defaultOpen={!validation.passed}>
              <CollapsibleTrigger className="w-full">
                <div className={cn("w-full p-3 rounded-lg border cursor-pointer transition-colors hover:bg-opacity-50", validation.passed ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50")}>
                  <div className="flex items-start gap-2">
                    {validation.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                    )}
                    <div className="flex-1 text-left">
                      <p className={cn("font-medium text-sm", validation.passed ? "text-green-700" : "text-red-700")}>{validation.check}</p>
                      <p className={cn("text-xs mt-1", validation.passed ? "text-green-600" : "text-red-600")}>
                        {validation.passed ? "✓ Check passed" : `✗ Found ${validation.issues.length} issue${validation.issues.length !== 1 ? "s" : ""}`}
                      </p>
                    </div>
                    <ChevronDown className="w-4 h-4 transition-transform flex-shrink-0 mt-0.5" />
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-1">
                <Card className={cn("mt-2", validation.passed ? "border-green-200" : "border-red-200")}>
                  <CardContent className="pt-4">
                    <div className="space-y-3">
                      {validation.issues.length > 0 && (
                        <div className="bg-red-50 border border-red-200 rounded p-3 space-y-1">
                          <p className="text-xs font-semibold text-red-900 mb-2">Issues:</p>
                          {validation.issues.map((issue, issueIdx) => (
                            <div key={issueIdx} className="text-xs text-red-800 pl-2 border-l-2 border-red-300">
                              {issue}
                            </div>
                          ))}
                        </div>
                      )}

                      {validation.warnings.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded p-3 space-y-1">
                          <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className="w-3 h-3 text-amber-700" />
                            <p className="text-xs font-semibold text-amber-900">Warnings:</p>
                          </div>
                          {validation.warnings.map((warning, warnIdx) => (
                            <div key={warnIdx} className="text-xs text-amber-800 pl-2 border-l-2 border-amber-300">
                              {warning}
                            </div>
                          ))}
                        </div>
                      )}

                      {validation.passed && validation.issues.length === 0 && validation.warnings.length === 0 && (
                        <div className="text-xs text-green-700 p-2 bg-green-100 rounded">
                          All checks passed for this validation.
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
