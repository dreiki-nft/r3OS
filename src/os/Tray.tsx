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
import { checkStormAlert, getStormAlert, subscribeStormAlert, toggleStormAlert } from './stormAlert'
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
  const stormAlert = useSyncExternalStore(subscribeStormAlert, getStormAlert)
  const [storm, setStorm] = useState(false)
  const connectionOpen = balloons.some((notice) => notice.id === 'connection')
  const liveOpen = balloons.some((notice) => notice.id === 'live-session')
  const activeLive = liveActive(live)

  useEffect(() => setLiveOwner(wallet.account), [wallet.account])
  // The storm bell: rings 333 blocks before each DF1 storm while it's on (src/os/stormAlert.ts).
  useEffect(() => checkStormAlert(block.block, block.blockTimeMs), [block.block, block.blockTimeMs])

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
      <button
        className={stormAlert ? 'tray-bell on' : 'tray-bell'}
        aria-label={stormAlert ? 'Storm bell on' : 'Storm bell off'}
        aria-pressed={stormAlert}
        title={
          stormAlert
            ? 'Storm bell on: r3OS rings 333 blocks before every DF1 storm. Click to turn it off.'
            : 'Storm bell: get a ping 333 blocks (about 100 seconds) before every DF1 storm'
        }
        onClick={() => {
          void toggleStormAlert().then((result) =>
            pushBalloon({
              id: 'storm-bell',
              title: result === 'off' ? 'Storm bell off' : 'Storm bell on',
              icon: 'lightning',
              sound: false,
              body:
                result === 'off'
                  ? 'no more storm pings.'
                  : result === 'on'
                    ? 'r3OS will ping you 333 blocks (about 100 seconds) before every DF1 storm, even with this tab in the background. keep r3OS open in a tab.'
                    : 'r3OS will ping you here, 333 blocks before every DF1 storm, while it is open. browser notifications are blocked or not available, so it can only ring inside r3OS.',
            }),
          )
        }}
      >
        <Icon name="bell" size={20} colour={stormAlert ? '#FEC343' : undefined} />
        {!stormAlert && <i className="mute-slash" />}
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
            href:
              wallet.balance === 0n
                ? wallet.chainId === 10143
                  ? 'https://faucet.monad.xyz'
                  : 'https://docs.monad.xyz'
                : undefined,
            hrefLabel:
              wallet.balance === 0n
                ? wallet.chainId === 10143
                  ? 'Monad testnet faucet'
                  : 'Monad docs'
                : undefined,
          })
        }}
      >
        <Icon name="antenna" size={20} colour="#5FEDDF" />
      </button>
      {activeLive && live.session && live.burner && (
        <button
          className="tray-live"
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
          <span className="tray-live-dot" aria-hidden="true" />
          <b>LIVE</b>
          <Icon name="key" size={16} colour="#5FEDDF" />
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
