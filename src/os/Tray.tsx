import { useEffect, useState, useSyncExternalStore } from 'react'
import { blockEta, getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { chainName } from '../chain/config'
import { formattedBalance, getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import {
  formatBurnerBalance,
  formatLiveTime,
  getLiveSnapshot,
  liveActive,
  liveTimeLeftMs,
  setLiveOwner,
  subscribeLive,
  unitsLeft,
} from '../live/liveStore'
import {
  getPresenceSnapshot,
  PRESENCE_WINDOW_BLOCKS,
  subscribePresence,
  summarize,
  windowLabel,
} from '../paint/presence'
import { getUnreadPaint, showUnreadPaint, subscribeUnreadPaint } from './activity'
import { dismissBalloon, getBalloons, pushBalloon, subscribeBalloons } from './balloons'
import { openProgram } from './programs'
import { getBlockPlayerPlaying, stopBlockPlayer, subscribeBlockPlayer } from '../monadhw/blockPlayer'
import { isMuted, setMuted, subscribeSoundSettings } from './sound'
import { Icon } from './ui/Icon'
import { MessageBox } from './ui/MessageBox'

function duration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return (
    `${hours ? String(hours).padStart(2, '0') + ':' : ''}${String(minutes).padStart(2, '0')}:` +
    String(remainder).padStart(2, '0')
  )
}

export function Tray() {
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const balloons = useSyncExternalStore(subscribeBalloons, getBalloons)
  const live = useSyncExternalStore(subscribeLive, getLiveSnapshot)
  const presence = useSyncExternalStore(subscribePresence, getPresenceSnapshot)
  const unreadPaint = useSyncExternalStore(subscribeUnreadPaint, getUnreadPaint)
  const painting = summarize(presence.strokes, block.block)
  const blockPlayer = useSyncExternalStore(subscribeBlockPlayer, getBlockPlayerPlaying)
  const muted = useSyncExternalStore(subscribeSoundSettings, isMuted)
  const [storm, setStorm] = useState(false)
  const connectionOpen = balloons.some((notice) => notice.id === 'connection')
  const liveOpen = balloons.some((notice) => notice.id === 'live-session')
  const activeLive = liveActive(live)

  useEffect(() => setLiveOwner(wallet.account), [wallet.account])

  return (
    <div className="tray sunken">
      <button
        aria-label="Mute sounds"
        onClick={() => {
          setMuted(!muted)
        }}
      >
        <Icon name="speaker" size={20} />
        {muted && <i className="mute-slash" />}
      </button>
      <button className={block.storm ? 'storming' : ''} onClick={() => setStorm(true)}>
        <Icon name="lightning" size={20} colour="#FEC343" />
        <span>
          {block.storm
            ? `STORM ${duration(blockEta(block.stormEndsIn))}`
            : duration(blockEta(block.nextStormIn))}
        </span>
      </button>
      {blockPlayer && (
        <button aria-label="Stop Block Player" title="Block Player is listening" onClick={stopBlockPlayer}>
          <Icon name="music" size={20} colour="#5FEDDF" />
        </button>
      )}
      <button
        aria-label="Show assistant"
        title="Show assistant"
        onClick={() => window.dispatchEvent(new Event('r3os-show-assistant'))}
      >
        <Icon name="question-filled" size={20} colour="#FFFFFF" />
      </button>
      <button
        aria-label="Connection information"
        onClick={() => {
          if (connectionOpen) {
            dismissBalloon('connection')
            return
          }
          pushBalloon({
            id: 'connection',
            title: 'Connection',
            body:
              `${chainName} · chain ${wallet.chainId ?? '—'}\n${wallet.account ?? 'not connected'}\n` +
              `${formattedBalance()}\nRPC ${block.mode}`,
            href: wallet.balance === 0n ? 'https://docs.monad.xyz' : undefined,
            hrefLabel:
              wallet.balance === 0n
                ? wallet.chainId === 10143
                  ? 'testnet faucet / Monad docs'
                  : 'Monad docs'
                : undefined,
          })
        }}
      >
        <Icon name="antenna" size={20} colour="#5FEDDF" />
      </button>
      {activeLive && live.session && live.burner && (
        <button
          aria-label="Live mode status"
          onClick={() => {
            if (liveOpen) {
              dismissBalloon('live-session')
              return
            }
            const session = live.session
            if (!session) return
            pushBalloon({
              id: 'live-session',
              title: 'Live mode',
              icon: 'key',
              body: [
                `expires block ${session.expiryBlock} · ` + `${formatLiveTime(liveTimeLeftMs(session))} left`,
                `${unitsLeft(session).toLocaleString()} units left · ` + formatBurnerBalance(live.balance),
              ].join('\n'),
              href: '#/pass?tab=Hardware%20Profiles',
              hrefLabel: 'Hardware Profiles',
            })
          }}
        >
          <Icon name="key" size={20} colour="#5FEDDF" />
        </button>
      )}
      {unreadPaint.length > 0 && (
        <button
          className="tray-mail"
          aria-label="You've got paint"
          title="You've got paint: see where others just painted"
          onClick={showUnreadPaint}
        >
          <Icon name="mail" size={20} colour="#FEC343" />
        </button>
      )}
      {painting.painters > 0 && (
        <button
          className="tray-painters"
          aria-label={`${painting.painters} active recently`}
          title={`${painting.painters} wallet${painting.painters === 1 ? '' : 's'} painted recently (${windowLabel(PRESENCE_WINDOW_BLOCKS, block.blockTimeMs)}) · open Paint`}
          onClick={() => void openProgram('paint')}
        >
          <Icon name="paint" size={20} />
          <span>{painting.painters}</span>
        </button>
      )}
      <span key={block.block.toString()} className="block-dot block-pulse">
        ●
      </span>
      <span>#{block.block.toString()}</span>
      {storm && (
        <MessageBox
          title="DF1 storm"
          message={
            block.storm
              ? '200% DF1 is active. fresh pixels can glitch until the storm ends.'
              : `next storm in ${block.nextStormIn} blocks.`
          }
          onClose={() => setStorm(false)}
        />
      )}
    </div>
  )
}
