import { useState } from 'react'
import { Button } from '../ui/Button'
import { ListBox } from '../ui/ListBox'
import { openProgram } from '../programs'
import { SYSTEM_LOG_LINES } from '../../operator/copy'

const topics = {
  'what this is': (
    <>
      a canvas that runs at the speed of Monad. one shared 256×256 surface, 16 colours, gas only. it is
      designed around page storage and region-local writes, not advertised as magic.
    </>
  ),
  'how painting works': (
    <>
      your hourly budget grows with active days. r3tard holders add daily token quota. blank and wet pixels
      are cheaper than dry overwrites. tiles accumulate heat, regions have per-block caps, outline pixels are
      protected, and DF1 pressure can corrupt fresh writes. storms force DF1 to 200% for 600 blocks.
    </>
  ),
  frames: (
    <>
      save immutable snapshots after you paint. frames remember their season, face/background, block and{' '}
      <code>block.coinbase</code> seal. the project calls that “Sealed by” without claiming validator identity
      yet.
    </>
  ),
  'Painter Pass': (
    <>
      a soulbound, burnable credential with live stamps. it grants absolutely nothing. claim once per address
      after painting.
    </>
  ),
  'owner powers': (
    <>
      the owner may set future-season outlines, append/freeze the renderer registry, manage the display-only
      Lab registry, bind the Painter Pass once, and add Pass stamp sources. the owner cannot paint for free,
      edit a running/past season, rewrite frames, force your renderer choice, or mutate Lab state.
    </>
  ),
  'system.log': (
    <>
      {SYSTEM_LOG_LINES.map((line, index) => (
        <span key={line}>
          <code>{line}</code>
          {index < SYSTEM_LOG_LINES.length - 1 && <br />}
        </span>
      ))}
    </>
  ),
  'Monad Hardware': (
    <>
      Device Manager for the chain underneath r3tardOS. every row says where its value comes from:{' '}
      <code>ONCHAIN</code> is read from the chain now, <code>MEASURED</code> was timed or gas-measured by this
      app, <code>SPEC</code> comes from protocol docs, <code>CONFIG</code> is pinned in the app, and{' '}
      <code>ABSENT</code> / <code>UNKNOWN</code> mean it could not be confirmed. a light on the hardware bus
      only turns on when that device was actually probed. click a bus device to jump to its row.
    </>
  ),
  'PAGE.EXE': (
    <>
      a MIP-8 microscope. Monad charges storage by 4 KiB pages of 128 slots: the first read on a page is cold
      (about 8,100 gas), the rest of that page is warm (about 100). the benchmarks run as an{' '}
      <code>eth_call</code> that always reverts, so nothing is stored and nothing is paid. every wallet also
      owns one real page: view it as hex, ASCII or a 128×64 16-colour image, draw on it, and write only the
      words you changed. anyone's page can be opened read-only.
    </>
  ),
  'CARDMEM.EXE': (
    <>
      an EEPROM programmer for your Monad Card. CARD.DRV gives every card id one 4 KiB storage page, and only
      the card's current owner can write it. the card itself is never wrapped, moved or touched. Monad Cards
      are soulbound and mainnet-only; testnet uses a mock card. holding a card earns the MONAD CARD stamp on
      the Painter Pass; holding one and painting 143 pixels completes the CARD CARRIER quest.
    </>
  ),
  'Block Camera': (
    <>
      photographs a block instead of a place. a capture mints a Labs token whose 32×32 portrait is built from
      the consensus context read inside your mint transaction: proposer validator, epoch, epoch-delay flag,
      parent hash, block number and season. the viewfinder only previews the current head; the token is drawn
      from the block it actually landed in. proposer identity is art and provenance, not randomness. one
      capture per wallet per block.
    </>
  ),
  'Kernel Debugger': (
    <>
      watch Monad decide whether an execution can commit. Monad keeps a reserve: an account's balance may not
      end a transaction below <code>min(starting balance, 10 MON)</code> unless it is an allowed emptying
      transaction. the debugger funds a throwaway process key with 0.05 MON and runs SINGLE, BURST GRACEFUL
      (isolate, check the reserve device, return the value) or BURST NAIVE (no unwind, expected to revert,
      full gas limit charged). the screen is built only from real receipts and logs. Sweep back returns what
      is left to your wallet. it also takes commands: <code>help</code>, <code>device</code>,{' '}
      <code>dump</code>, <code>event</code>, <code>operator</code>, <code>venues</code>, <code>route</code>,{' '}
      <code>quote</code>.
    </>
  ),
  'ROUTER.EXE': (
    <>
      compares MRC-17 DRAFT venues inside one execution. a RUN is one <code>eth_call</code>: every venue is
      quoted at the same block, each in its own child frame that is always rolled back, and the row with the
      HIGHEST QUOTED OUTPUT is marked. a quote is not a fill: QUOTE SCOPE (wrapped MON input only) runs the
      actual swap inside a frame that also rolls back and shows quoted vs delivered. nothing is ever sent;
      there are no approvals, no custody and no fees. results describe that block only, not a later one.
      venues are third-party adapters; mainnet uses a pinned manifest and checks each adapter's code hash.
    </>
  ),
  'CD-ROM (D:)': (
    <>
      plays the CDs you made in Burn a CD. Insert disc… lists the CDs your wallet holds; the drive shows{' '}
      <code>CDINFO.TXT</code> and one <code>TRACKnn.BMP</code> per burned frame, and Imaging opens them. a CD
      stores frame ids, and Paint keeps every frame's pixels forever, so a CD traded to another wallet still
      plays every track, even ones whose frame was later recycled. a CD that leaves your wallet is ejected.
    </>
  ),
  credits: (
    <>
      Paint · r3tardOS 98. manufactured and supported by r3tards. built to expose Monad mechanics instead of
      hiding them.
    </>
  ),
}

/** Topics that describe one program get an Open button. */
const programFor: Partial<Record<keyof typeof topics, { id: string; label: string }>> = {
  'Monad Hardware': { id: 'monad-hw', label: 'Open Monad Hardware' },
  'PAGE.EXE': { id: 'page-exe', label: 'Open PAGE.EXE' },
  'CARDMEM.EXE': { id: 'card-mem', label: 'Open CARDMEM.EXE' },
  'Block Camera': { id: 'block-camera', label: 'Open Block Camera' },
  'Kernel Debugger': { id: 'kernel-debugger', label: 'Open Kernel Debugger' },
  'ROUTER.EXE': { id: 'router', label: 'Open ROUTER.EXE' },
  'CD-ROM (D:)': { id: 'cdrom', label: 'Open CD-ROM (D:)' },
}

export function HelpProgram() {
  const [k, setK] = useState<keyof typeof topics>('what this is')
  return (
    <div className="help-view">
      <ListBox label="Help topics">
        {Object.keys(topics).map((x) => (
          <button
            role="option"
            key={x}
            aria-selected={k === x}
            onClick={() => setK(x as keyof typeof topics)}
          >
            {x}
          </button>
        ))}
      </ListBox>
      <article className="sunken">
        <h2>{k}</h2>
        <p>{topics[k]}</p>
        {programFor[k] && (
          <Button onClick={() => openProgram(programFor[k]!.id)}>{programFor[k]!.label}</Button>
        )}
      </article>
    </div>
  )
}
