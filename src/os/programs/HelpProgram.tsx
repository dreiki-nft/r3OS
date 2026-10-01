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
  'Block Camera': (
    <>
      photographs a block instead of a place. a capture mints a Labs token whose 32×32 portrait is built from
      the consensus context read inside your mint transaction: proposer validator, epoch, epoch-delay flag,
      parent hash, block number and season. the viewfinder only previews the current head; the token is drawn
      from the block it actually landed in. proposer identity is art and provenance, not randomness. one
      capture per wallet per block.
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
  'DXDIAG.EXE': (
    <>
      shows what this browser is connected to and which r3tardOS components it can see: chain, block, block
      clock mode, how many RPC endpoints are configured, the core contracts, installed drivers, Monad devices
      and the System Event state. it reads once when opened; Refresh reads again. Copy Report puts a
      plain-text support report on the clipboard with no RPC URL and no wallet in it. it never signs or sends
      anything.
    </>
  ),
  'Run…': (
    <>
      Start → Run… opens a program by name: <code>paint</code>, <code>frames</code>, <code>camera</code>,{' '}
      <code>hardware</code>, <code>dxdiag</code> and the rest of the desktop. a few typed routes work too:{' '}
      <code>operator</code>, <code>frame 12</code>, <code>auction 3</code>. it is not a shell: it won't open
      web addresses, run scripts or skip a program's release date.
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
  'Block Camera': { id: 'block-camera', label: 'Open Block Camera' },
  'CD-ROM (D:)': { id: 'cdrom', label: 'Open CD-ROM (D:)' },
  'DXDIAG.EXE': { id: 'dxdiag', label: 'Open DXDIAG.EXE' },
  'Run…': { id: 'run', label: 'Open Run…' },
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
