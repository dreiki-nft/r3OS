import { useSyncExternalStore } from 'react'
import {
  connectWallet,
  getWalletSnapshot,
  metamaskDeepLink,
  subscribeWallet,
  walletChoices,
} from '../chain/wallet'
import { playSound } from './sound'
import { Button } from './ui/Button'

export function WalletChooser({ onClose }: { onClose: () => void }) {
  useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const choices = walletChoices()
  return (
    <div className="wallet-chooser sunken" role="group" aria-label="Choose a wallet">
      {choices.length ? (
        choices.map((choice) => (
          <Button
            key={choice.info.uuid}
            onClick={() =>
              void connectWallet(choice).then(() => {
                playSound('system-initiate')
                onClose()
              })
            }
          >
            {choice.info.name}
          </Button>
        ))
      ) : (
        <>
          <p>no injected wallet found.</p>
          <a href={metamaskDeepLink()}>Open in MetaMask</a>
          <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
            Install MetaMask
          </a>
        </>
      )}
    </div>
  )
}
