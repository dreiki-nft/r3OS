import { useState } from 'react'
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
  const [stopping, setStopping] = useState(false)
  return (
    <div className="copy-progress window">
      <b>{stopping ? 'Stopping…' : 'Copying pixels…'}</b>
      <div className="flying-pixels">▦ ▦ ▦ ▦ ▦</div>
      <p>
        chunk {current} of {total}
      </p>
      {stopping && (
        <p>
          no more chunks will be sent. to stop this one too, reject the open request in your wallet; if it was
          already signed, it still lands.
        </p>
      )}
      <Button
        disabled={stopping}
        onClick={() => {
          setStopping(true)
          onCancel()
        }}
      >
        Cancel
      </Button>
    </div>
  )
}
