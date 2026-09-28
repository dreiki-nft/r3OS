import type { ReactNode } from 'react'
export function TreeView({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div role="tree" aria-label={label} className="tree-view sunken">
      {children}
    </div>
  )
}
