/** "Powered by Monad" with the Monad logo (light wordmark for r3OS's dark chrome). */
export function PoweredByMonad({ className = '', height = 22 }: { className?: string; height?: number }) {
  return (
    <div className={`powered-by ${className}`}>
      <span>Powered by</span>
      <img
        src="/os/brand/monad-logo-white.png"
        alt="Monad"
        height={height}
        width={Math.round(height * 5.2)}
      />
    </div>
  )
}
