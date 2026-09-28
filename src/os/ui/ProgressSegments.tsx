export function ProgressSegments({ value, max }: { value: number; max: number }) {
  const n = max <= 0 ? 0 : Math.round(Math.max(0, Math.min(1, value / max)) * 12)
  return (
    <div className="progress-segments sunken" aria-label={`${value} of ${max}`}>
      {Array.from({ length: 12 }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </div>
  )
}
