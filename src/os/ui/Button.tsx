import type { ButtonHTMLAttributes, ReactNode } from 'react'
export function Button({
  primary,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; children: ReactNode }) {
  return (
    <button {...props} className={`r3-button raised ${primary ? 'primary' : ''} ${props.className ?? ''}`}>
      {children}
    </button>
  )
}
