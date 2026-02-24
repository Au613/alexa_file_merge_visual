"use client"

import Link from "next/link"
import {usePathname} from "next/navigation"
import {FileSpreadsheet, CheckCircle, GitCompare} from "lucide-react"
import {Button} from "@/components/ui/button"

export function Navigation() {
	const pathname = usePathname()

	return (
		<div className="border-b backdrop-blur-sm sticky top-0 z-50">
			<div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
				<div>
					<h1 className="text-xl font-bold">Monkey Data Manager</h1>
				</div>
				<div className="flex gap-2">
					<Button variant={pathname === "/" ? "default" : "outline"} asChild className={pathname === "/" ? "" : "hover:opacity-70 hover:text-inherit"}>
						<Link href="/" className="flex items-center gap-2">
							<FileSpreadsheet className="w-4 h-4" />
							Merge
						</Link>
					</Button>
					<Button variant={pathname === "/point-sample" ? "default" : "outline"} asChild className={pathname === "/point-sample" ? "" : "hover:opacity-70 hover:text-inherit"}>
						<Link href="/point-sample" className="flex items-center gap-2">
							<CheckCircle className="w-4 h-4" />
							Point Sample
						</Link>
					</Button>
					<Button variant={pathname === "/compare" ? "default" : "outline"} asChild className={pathname === "/compare" ? "" : "hover:opacity-70 hover:text-inherit"}>
						<Link href="/compare" className="flex items-center gap-2">
							<GitCompare className="w-4 h-4" />
							Compare
						</Link>
					</Button>
				</div>
			</div>
		</div>
	)
}
