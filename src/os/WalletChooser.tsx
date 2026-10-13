import { useState, useSyncExternalStore } from 'react'
import type { Address } from 'viem'
import { friendlyError } from '../chain/errors'
import {
  connectWallet,
  getWalletSnapshot,
  metamaskDeepLink,
  subscribeWallet,
  trustWalletDeepLink,
  walletChoices,
} from '../chain/wallet'
import { playSound } from './sound'
import { Button } from './ui/Button'

export function WalletChooser({
  onClose,
  onConnected,
}: {
  onClose: () => void
  onConnected?: (account: Address) => void
}) {
  useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const choices = walletChoices()
  const [connecting, setConnecting] = useState<string>()
  const [message, setMessage] = useState('')

  const choose = async (choice: ReturnType<typeof walletChoices>[number]) => {
    setConnecting(choice.info.uuid)
    setMessage('')
    // A wallet whose popup never appears (locked, or a request already waiting) must not freeze the chooser:
    // after a while, say where to look and let the buttons work again.
    const stuck = window.setTimeout(() => {
      setConnecting(undefined)
      setMessage(
        `no answer from ${choice.info.name} yet. open the wallet extension: it may be locked or have a request waiting. then try again.`,
      )
    }, 20_000)
    try {
      const next = await connectWallet(choice)
      playSound('system-initiate')
      if (next.account) onConnected?.(next.account)
      onClose()
    } catch (error) {
      const friendly = friendlyError(error)
      playSound(friendly.rejected ? 'cancel' : 'error')
      setMessage(friendly.message)
    } finally {
      window.clearTimeout(stuck)
      setConnecting(undefined)
    }
  }

  return (
    <div className="wallet-chooser sunken" role="group" aria-label="Choose a wallet">
      {choices.length ? (
        choices.map((choice) => (
          <Button
            key={choice.info.uuid}
            disabled={Boolean(connecting)}
            onClick={() => void choose(choice)}
          >
            {connecting === choice.info.uuid ? `Connecting ${choice.info.name}…` : choice.info.name}
          </Button>
        ))
      ) : (
        <>
          <p>this browser has no wallet. on a phone, open r3OS inside your wallet app's browser:</p>
          <a href={metamaskDeepLink()}>Open in MetaMask</a>
          <a href={trustWalletDeepLink()}>Open in Trust Wallet</a>
          <p>other wallet apps: open their browser tab and go to r3os.app.</p>
          <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
            Install MetaMask
          </a>
        </>
      )}
      {message && <p className="wallet-chooser-error" role="alert">{message}</p>}
    </div>
  )
}
