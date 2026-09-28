import type { ReactNode } from 'react'
export function ListBox({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div role="listbox" aria-label={label} className="listbox sunken">
      {children}
    </div>
  )
}
