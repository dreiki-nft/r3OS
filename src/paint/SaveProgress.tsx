import { Button } from '../os/ui/Button'
export function SaveProgress({
  current,
  total,
  onCancel,
}: {
  current: number
  total: number
  onCancel: () => void
}) {
  return (
    <div className="copy-progress window">
      <b>Copying pixels…</b>
      <div className="flying-pixels">▦ ▦ ▦ ▦ ▦</div>
      <p>
        chunk {current} of {total}
      </p>
      <Button onClick={onCancel}>Cancel</Button>
    </div>
  )
}
