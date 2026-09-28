import type { ReactNode } from 'react'
export function GroupBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="group-box">
      <legend>{title}</legend>
      {children}
    </fieldset>
  )
}
