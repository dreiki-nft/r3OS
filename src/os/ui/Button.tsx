import type { ComponentPropsWithRef, ReactNode } from 'react'
// React 19 passes `ref` as a normal prop, so the spread below forwards it to the <button>.
export function Button({
  primary,
  children,
  ...props
}: ComponentPropsWithRef<'button'> & { primary?: boolean; children: ReactNode }) {
  return (
    <button {...props} className={`r3-button raised ${primary ? 'primary' : ''} ${props.className ?? ''}`}>
      {children}
    </button>
  )
}
