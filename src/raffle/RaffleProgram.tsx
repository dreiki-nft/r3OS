import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Hex } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { addressExplorerUrl } from '../chain/explorer'
import { painterName, usePainterNames } from '../chain/names'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { openProgram } from '../os/programs'
import { Button } from '../os/ui/Button'
import { MAINNET_R3TARDS, scatterImageUrl } from '../pass/r3tardImages'
import { parseBoard, SEASON_FIRST_STORM, STORM_PERIOD, type Board } from '../storms/stormBoard'
import {
  RAFFLE_ABI,
  RAFFLE_ADDRESS,
  RAFFLE_SOURCE_URL,
  STATE_NAMES,
  fingerprint,
  holderOf,
  steps,
  ticketLines,
  ticketRanges,
  winningTicket,
} from './raffleModel'
import './raffle.css'

type Onchain = {
  totalTickets: number
  walletCount: number
  snapshotBlock: bigint
  snapshotHash: Hex
  prizeNFT: string
  prizeTokenId: bigint
  drawDeadline: bigint
  state: number
  sequence: bigint
  random: Hex
  winner: string
  winningTicket: number
  prizeDeposited: boolean
  prizeClaimed: boolean
}

const ZERO_HASH = `0x${'0'.repeat(64)}`
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`

async function readOnchain(): Promise<Onchain | undefined> {
  if (!publicClient || config.chainId !== 143) return undefined
  const [info, state] = await Promise.all([
    publicClient.readContract({ address: RAFFLE_ADDRESS, abi: RAFFLE_ABI, functionName: 'getRaffleInfo' }),
    publicClient.readContract({ address: RAFFLE_ADDRESS, abi: RAFFLE_ABI, functionName: 'getRaffleState' }),
  ])
  return {
    totalTickets: Number(info[0]),
    walletCount: Number(info[1]),
    snapshotBlock: info[2],
    snapshotHash: info[3],
    prizeNFT: info[4],
    prizeTokenId: info[5],
    drawDeadline: info[7],
    state: Number(state[0]),
    sequence: state[1],
    random: state[2],
    winner: state[3],
    winningTicket: Number(state[4]),
    prizeDeposited: state[5],
    prizeClaimed: state[6],
  }
}

export function RaffleProgram() {
  usePainterNames()
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const [board, setBoard] = useState<Board>()
  const [chain, setChain] = useState<Onchain | 'error'>()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void fetch('/storms/season-1.json', { cache: 'no-cache' })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((json) => json && setBoard(parseBoard(json)))
      .catch(() => undefined)
    const read = () =>
      readOnchain()
        .then(setChain)
        .catch(() => setChain('error'))
    void read()
    const timer = window.setInterval(read, 30_000) // a draw moves through its states in minutes, not blocks
    return () => window.clearInterval(timer)
  }, [])

  const entries = useMemo(() => (board ? ticketRanges(board.wallets) : []), [board])
  const listHash = useMemo(() => (entries.length ? fingerprint(entries) : undefined), [entries])
  const totalTickets = entries.reduce((sum, entry) => sum + entry.tickets, 0)
  const onchain = chain && chain !== 'error' ? chain : undefined
  const onchainIsSeason = Boolean(
    onchain && listHash && onchain.snapshotHash.toLowerCase() === listHash.toLowerCase(),
  )
  const stormsDone = board?.storms.length ?? 0
  const totalStorms = board?.totalStorms ?? 21
  const lastStormEnd = SEASON_FIRST_STORM + BigInt(totalStorms - 1) * STORM_PERIOD + 599n
  const list = steps(stormsDone, totalStorms, onchain?.state, onchainIsSeason)
  const current = list.findIndex((step) => !step.done)

  const me = wallet.account?.toLowerCase()
  const mine = entries.find((entry) => entry.address.toLowerCase() === me)

  // The proof, once the contract holds this season's draw.
  const proof =
    onchainIsSeason && onchain && onchain.random !== ZERO_HASH && totalTickets
      ? (() => {
          const ticket = winningTicket(onchain.random, totalTickets)
          return { ticket, holder: holderOf(entries, ticket) }
        })()
      : undefined

  const download = () => {
    const blob = new Blob([ticketLines(entries).join('\n') + '\n'], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'storm-season-tickets.txt'
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const prizeImage =
    onchainIsSeason && onchain?.prizeDeposited && onchain.prizeNFT.toLowerCase() === MAINNET_R3TARDS
      ? scatterImageUrl(onchain.prizeTokenId, onchain.prizeNFT)
      : ''

  return (
    <div className="raffle-program">
      <div className="raffle-head">
        {prizeImage ? (
          <img className="raffle-prize" src={prizeImage} alt={`r3tard #${onchain?.prizeTokenId}`} />
        ) : (
          <div className="raffle-prize placeholder">?</div>
        )}
        <div>
          <strong>Storm Season raffle</strong>
          <p>
            Prize: {prizeImage ? `r3tard #${onchain?.prizeTokenId}` : 'an r3tard'}. 1 ticket for every DF1
            storm a wallet painted in. The winner is picked onchain with Pyth Entropy randomness, and anyone
            can check it here.
          </p>
        </div>
      </div>

      <ol className="raffle-steps">
        {list.map((step, index) => (
          <li key={step.key} className={step.done ? 'done' : index === current ? 'now' : ''}>
            <i aria-hidden="true">{step.done ? '✓' : index === current ? '▸' : '○'}</i> {step.label}
            {step.key === 'tickets' && !step.done && (
              <small>
                {' '}
                · the draw comes after the last storm (block {lastStormEnd.toLocaleString('en-US')})
              </small>
            )}
            {step.key === 'winner' && step.done && onchain && (
              <small>
                {' '}
                · <b>{painterName(onchain.winner)}</b> ({short(onchain.winner)})
                {onchain.prizeClaimed ? ' · prize sent ✓' : ''}
              </small>
            )}
          </li>
        ))}
      </ol>

      <section className="raffle-box sunken">
        <h3>The ticket list</h3>
        {!board ? (
          <p>loading…</p>
        ) : (
          <>
            <p>
              <b>{totalTickets}</b> tickets · <b>{entries.length}</b> wallets · counted through storm{' '}
              {stormsDone}
            </p>
            <p className="raffle-hash">
              fingerprint{' '}
              <code title={listHash}>
                {listHash ? `${listHash.slice(0, 10)}…${listHash.slice(-8)}` : '—'}
              </code>{' '}
              <button
                className="link-button"
                onClick={() => {
                  if (!listHash) return
                  void navigator.clipboard?.writeText(listHash).then(() => setCopied(true))
                }}
              >
                {copied ? 'copied' : 'copy'}
              </button>
            </p>
            <p className={onchainIsSeason ? 'raffle-match ok' : 'raffle-match'}>
              {chain === 'error'
                ? "couldn't read the raffle contract right now"
                : !onchain
                  ? 'reading the raffle contract…'
                  : onchainIsSeason
                    ? `✓ matches the list locked in the contract (snapshot block ${onchain.snapshotBlock.toLocaleString('en-US')})`
                    : 'not locked in the contract yet: that happens after the last storm, with this exact list and fingerprint'}
            </p>
            <div className="raffle-actions">
              <Button onClick={download}>Download the ticket list</Button>
              <Button onClick={() => void openProgram('storms')}>Storm Chasers</Button>
            </div>
            {me && (
              <p className="raffle-mine">
                {mine
                  ? `your tickets: #${mine.from}${mine.to > mine.from ? `–#${mine.to}` : ''} (${mine.tickets} of ${totalTickets})`
                  : 'your wallet has no tickets yet: paint 1 pixel during a storm'}
              </p>
            )}
          </>
        )}
      </section>

      <section className="raffle-box sunken">
        <h3>How the winner is picked</h3>
        <ol className="raffle-how">
          <li>The list above is loaded into the contract and locked; its fingerprint is stored with it.</li>
          <li>
            The contract asks Pyth Entropy for a random number R. Nobody, including the team, can choose it.
          </li>
          <li>
            Winning ticket = R mod {totalTickets || 'total tickets'}. Tickets are numbered from #0 in the
            list's order (wallets sorted by address, one ticket per storm caught).
          </li>
          <li>The wallet holding that ticket wins. The contract's own team wallets are skipped.</li>
        </ol>
        {proof && onchain && (
          <p className="raffle-proof">
            R = <code title={onchain.random}>{short(onchain.random)}</code> → R mod {totalTickets} ={' '}
            <b>#{proof.ticket}</b> → {proof.holder ? <b>{painterName(proof.holder.entry.address)}</b> : '—'}
            {proof.holder && proof.holder.entry.address.toLowerCase() === onchain.winner.toLowerCase()
              ? ' ✓ same as the contract'
              : onchain.state >= 6
                ? ' (contract winner differs: check the list)'
                : ''}
          </p>
        )}
      </section>

      <p className="raffle-foot">
        Contract{' '}
        <a href={addressExplorerUrl(RAFFLE_ADDRESS, 143)} target="_blank" rel="noreferrer">
          {short(RAFFLE_ADDRESS)}
        </a>{' '}
        ·{' '}
        <a href={RAFFLE_SOURCE_URL} target="_blank" rel="noreferrer">
          verified source
        </a>
        {onchain && !onchainIsSeason && (
          <> · it currently holds an earlier raffle ({STATE_NAMES[onchain.state] ?? onchain.state})</>
        )}
        {block.block > 0n && block.block < lastStormEnd && (
          <> · {Math.max(0, totalStorms - stormsDone)} storms left</>
        )}
      </p>
    </div>
  )
}
