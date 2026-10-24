import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '../ui/Button'
import { openProgram } from '../programs'
import { SHOW_WELCOME_EVENT } from '../welcomeChecklist'
import { SYSTEM_LOG_LINES } from '../../operator/copy'
import { HELP_GROUPS, HELP_TOPICS, helpHash, helpSlugFromHash, type HelpSlug } from '../helpTopics'

/** Plain-language help, one page per program. Keep sentences short; no contract or protocol jargon. */
const pages: Record<HelpSlug, ReactNode> = {
  welcome: (
    <>
      <p>
        r3OS is an onchain operating system for the world computer, styled like a 1998 desktop. the app is static: it reads
        contracts and chain events directly, with no app backend or database.
      </p>
      <p>
        the heart of it is <b>Paint</b>: one shared 256 × 256 canvas with 16 colours that everyone paints
        together. you save moments of it as frames, collect them, burn them onto CDs, and when a season ends
        its final canvas goes to auction.
      </p>
      <p>double-click an icon to open a program. new here? read “getting started”.</p>
    </>
  ),
  'getting-started': (
    <ol>
      <li>
        <b>open Paint first</b>. no wallet is needed to watch the live canvas, inspect recent strokes or draw
        locally.
      </li>
      <li>
        <b>connect when you want to paint</b>, then press <b>Start Live Mode to paint</b>. you authorize and fund
        a capped browser session once (two wallet prompts); after that every stroke is a Monad transaction sent
        without a wallet popup. Live Mode has no Undo.
      </li>
      <li>
        pick a colour, draw, then press <b>Paint</b>. with Auto-paint on, strokes go out as you draw.
      </li>
      <li>
        <b>save a frame</b>: in Paint, File › Save frame…. it becomes an NFT in <b>My Frames</b>.
      </li>
      <li>
        <b>claim your Pass</b> in <b>My Pass</b>. it collects stamps for what you do.
      </li>
      <li>
        then open <b>Explore Monad</b> to watch blocks and storage-page experiments live. <b>Quests</b>,
        <b>Block Camera</b> and the CD drive are there when you want to go deeper.
      </li>
      <li style={{ listStyle: 'none', marginLeft: -18 }}>
        <Button onClick={() => window.dispatchEvent(new Event(SHOW_WELCOME_EVENT))}>
          Show the getting started checklist
        </Button>
      </li>
    </ol>
  ),
  paint: (
    <>
      <p>everyone paints the same canvas. you only pay gas: there is no mint price.</p>
      <p>
        each hour you get a pixel budget. it grows with every day you paint. r3tards add the largest holder
        bonus per token; on mainnet, Skrumpeys and Monad Cards each add a smaller automatic daily bonus.
        painting a blank or still-wet pixel costs less of your budget than painting over dry art.
      </p>
      <p>
        a busy area can make fresh pixels glitch (that's DF1, see “storms & glitches”). the outline of the
        season's character is protected and can't be painted over.
      </p>
      <p>
        you're never painting alone: “active recently” shows how many wallets painted in roughly the last minute,
        and a stroke by someone else flashes on the canvas as it lands. click a recent stroke to jump to it.
        when you're in another program and people paint, a “You've got paint” note appears; the paint icon in
        the corner shows recent painters.
      </p>
      <p>File › Save frame… saves what the canvas looks like right now as your own frame.</p>
    </>
  ),
  frames: (
    <>
      <p>
        a frame is a snapshot of the canvas that you save as an NFT after you paint. it remembers the season,
        the block it was saved in and that block's <code>coinbase</code> / fee-recipient address (“sealed by”). frames never change.
      </p>
      <p>
        My Frames shows yours (Mine), everyone's (All frames), season finales and anything you hid. the Labs
        folder holds your CDs and block portraits.
      </p>
    </>
  ),
  pass: (
    <>
      <p>
        your Painter Pass is a free, soulbound badge: one per wallet, and it can't be sold or transferred.
        claim it after your first paint.
      </p>
      <p>
        its picture fills with stamps as you go: first paint, first frame, painting during a storm, 7 active
        days, holding an r3tard, quests, recycling, holding a Monad Card. it grants nothing; it just shows
        what you did.
      </p>
    </>
  ),
  cd: (
    <>
      <p>
        pick 1 to 12 of your saved frames, write a label, and burn them onto one mix CD. the CD is its own NFT
        with a silver disc picture and a track list.
      </p>
      <p>
        your frames stay yours: burning a CD doesn't use them up. finales can go on a CD; the live canvas
        (token #0) can't.
      </p>
    </>
  ),
  cdrom: (
    <>
      <p>
        plays the CDs you own. press Insert disc…, pick a CD, and its tracks show up as picture files you can
        open. a shared <code>#/cdrom?cd=123</code> link plays that CD read-only without a wallet.
      </p>
      <p>
        a CD keeps every track forever, even if a frame on it is later sold or recycled. if the CD leaves your
        wallet, the drive ejects it.
      </p>
    </>
  ),
  auction: (
    <>
      <p>
        when a season ends, its final canvas becomes a finale NFT. its owner can list it here in a candle
        auction.
      </p>
      <p>
        bidding runs for about a day (288,000 blocks). after bidding closes, the closing block hash selects one
        point inside the last-hour candle window. it is a public onchain candle mechanism, not cryptographic
        randomness. bids after the selected end don't count and are refunded.
      </p>
      <p>
        each bid must beat the top bid by at least 5%. bids are held until the auction is settled; anyone can
        press Settle, and everyone who didn't win withdraws their deposit.
      </p>
    </>
  ),
  quests: (
    <>
      <p>
        goals across r3OS: paint a lot, paint in a storm, save frames, bid, recycle, hold a Monad Card…
        each goal is checked against the chain, so it can't be faked.
      </p>
      <p>when a goal is reached, press Claim. your Pass shows how many quests you've completed.</p>
    </>
  ),
  bin: (
    <>
      <p>
        recycle saved frames you don't want: 1 to 50 at a time, gone for good. the live canvas and finales
        can't be recycled.
      </p>
      <p>
        the Bin keeps a small record of every recycled frame and a top 10 of recyclers. recycle 100 frames to
        earn the RECYCLER stamp and quest.
      </p>
    </>
  ),
  validators: (
    <>
      <p>
        the block-sealing addresses seen in saved frames. the heartbeat follows the live block stream and beats once
        per block; the window shows the cadence this browser is actually measuring.
      </p>
      <p>frames store <code>block.coinbase</code>. until Monad documents its identity semantics for this use, r3OS treats it as a fee-recipient / sealer address rather than claiming a verified validator identity.</p>
    </>
  ),
  'block-camera': (
    <>
      <p>
        takes a picture of a block instead of a place. press Capture and you mint a small portrait built from
        the block your transaction lands in: its validator, epoch, parent hash and number.
      </p>
      <p>one capture per wallet per block. if you hold a Monad Card it can be part of the shot.</p>
    </>
  ),
  'monad-hw': (
    <>
      <p>small experiments you can run with one button, each showing something Monad does differently:</p>
      <ul>
        <li>
          <b>Block speed</b>: watch new blocks arrive and see the cadence this browser measures live.
        </li>
        <li>
          <b>Storage race</b>: read the same amount of data from one storage page and from many. Monad warms a
          whole 4 KiB page at once (MIP-8), so the first way is far cheaper.
        </li>
        <li>
          <b>Block camera</b>: turn the current block into a picture.
        </li>
        <li>
          <b>Liquidity race</b> (mainnet): ask several Monad markets for the same quote in one simulation.
          nothing is traded.
        </li>
      </ul>
      <p>
        every result is read from the chain or measured live. the <b>System Information</b> tab has the full
        device list: <code>ONCHAIN</code> was read from the chain just now, <code>MEASURED</code> was timed by
        this app, <code>SPEC</code> comes from Monad's docs, <code>UNKNOWN</code> couldn't be confirmed.
      </p>
    </>
  ),
  xray: (
    <p>
      follows your last transaction from click to receipt, plus Monad Proposed / Voted / Finalized signals when
      the connected RPC exposes them: which block it landed in, the gas limit you paid for versus the gas it
      used, and which parts of the canvas it touched.
    </p>
  ),
  dxdiag: (
    <>
      <p>
        shows what this browser is connected to: the chain, the latest block, which r3OS parts it can see
        and which Monad devices answer.
      </p>
      <p>
        if something looks wrong, press Copy Report and send it to us. the report never contains your wallet
        or any private connection details.
      </p>
    </>
  ),
  'whats-new': (
    <>
      <p>r3OS keeps changing while the season runs. the latest, newest first:</p>
      <ul>
        <li>
          <b>Oct 24 · Storm Chasers</b> (Run → <code>storms</code>): the Storm Season leaderboard. 1 raffle ticket
          for every DF1 storm you paint in. your tickets, a live "you're in ✓" during a storm, every storm left
          in your time zone with a calendar file, and a card to share.
        </li>
        <li>
          <b>Oct 24 · r3OS Status</b> (Run → <code>status</code>): is everything working, checked live from your
          browser: the chain, the RPC, the live feed, the next storm.
        </li>
        <li>
          <b>Oct 24 · My Pass</b> shows your season rank among all painters and your storm tickets. DXDIAG now
          lists why a stroke didn't land, if one ever doesn't.
        </li>
        <li>
          <b>Oct 23 · Live Mode refunds</b>: everyone who left MON in a Live Mode burner from before the automatic
          sweep got it sent back.
        </li>
        <li>
          <b>Oct 22 · Live Mode</b> sends leftover MON back by itself when a session ends, offers to end the
          session before you disconnect, and shows MON left in burners from other browsers. plus the storm bell,
          Season Replay on the desktop and 7 pixel-art wallpapers.
        </li>
        <li>
          <b>Oct 21 · Storm Season</b>: every DF1 storm until season 1 ends is worth a raffle ticket.
        </li>
        <li>
          <b>Oct 19 · .r3 names</b>: painters show as <code>name.r3</code> when they have one.
        </li>
      </ul>
    </>
  ),
  seasons: (
    <p>
      a season lasts 30 days. each season can have its own character outlined on the canvas. when it ends, the
      final canvas is minted as that season's finale and can go to the Auction.
    </p>
  ),
  storms: (
    <>
      <p>
        when many people paint the same area, fresh pixels can glitch: that's DF1. it's part of the art, and
        frames remember how strong it was.
      </p>
      <p>
        every 200,000 blocks a storm hits for 600 blocks and everything glitches at 200%. painting in a storm
        earns the STORM CHASER stamp.
      </p>
      <p>
        until season 1 ends, every storm you paint in is also <b>1 raffle ticket</b>. see yours, and when the
        next storms hit, in <b>Storm Chasers</b> (Run → <code>storms</code>), or tap the ⚡ timer in the tray.
      </p>
    </>
  ),
  'live-mode': (
    <>
      <p>
        painting in r3OS goes through Live Mode, so you never confirm every stroke. Live Mode authorizes a capped
        browser key (at most 10 MON) for paint-only actions, for a
        limited time and a limited number of units. strokes still go through the Paint contract; live WebSocket updates can be speculative until the block advances through Monad commitment states.
      </p>
      <p>
        press <b>Start Live Mode to paint</b> in Paint. if you are disconnected, choose the wallet there and quick start
        continues automatically. the wallet signs the session once and, when needed, sends the burner a little
        MON for gas. after that, strokes need no wallet popup. if the burner still has enough MON, setup is one
        wallet prompt.
      </p>
      <p>
        Live Mode has <b>no Undo</b>: once a stroke is sent, the app does not keep a local undo history for it. the green LIVE strip and taskbar
        badge stay visible while the session is active, and Paint shows your receipt/block inclusion proof plus fresh
        strokes arriving from other browsers.
      </p>
      <p>
        the burner can't mint frames, claim the Pass, recycle or move your tokens. end the session, and get
        leftover MON back, from My Pass › Hardware Profiles.
      </p>
    </>
  ),
  gas: (
    <p>
      on Monad you pay for the gas limit you set, not only the gas you use, so r3OS sets tight limits for
      each action. every button that sends a transaction shows its maximum cost before you sign.
    </p>
  ),
  sounds: <p>preview, change the volume of, or mute every r3OS sound.</p>,
  run: (
    <p>
      Start › Run… opens a program by name: <code>paint</code>, <code>frames</code>, <code>camera</code>,{' '}
      <code>explore</code>, <code>dxdiag</code> and the rest. a few shortcuts work too: <code>frame 12</code>{' '}
      opens a frame's properties and <code>auction 3</code> opens an auction.
    </p>
  ),
  'owner-powers': (
    <p>
      the project owner can prepare future seasons' outlines, add optional ways to render frames, and add
      programs and Pass stamps. the owner can't paint for free, change a running or past season, edit frames,
      or touch anyone's tokens.
    </p>
  ),
  'system-log': (
    <p>
      {SYSTEM_LOG_LINES.map((line, index) => (
        <span key={line}>
          <code>{line}</code>
          {index < SYSTEM_LOG_LINES.length - 1 && <br />}
        </span>
      ))}
    </p>
  ),
  credits: (
    <p>Paint · r3OS 98. made by dreiki, on Monad. built to show how the chain works, not hide it.</p>
  ),
}

export function HelpProgram() {
  const [slug, setSlug] = useState<HelpSlug>(() => helpSlugFromHash(location.hash))
  useEffect(() => {
    // Other programs link straight to a page with `#/help?topic=…`, also while Help is already open.
    const onHash = () => {
      if (location.hash.startsWith('#/help')) setSlug(helpSlugFromHash(location.hash))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const topic = HELP_TOPICS.find((item) => item.slug === slug)!
  const program = 'program' in topic ? topic.program : undefined
  return (
    <div className="help-view">
      <div role="listbox" aria-label="Help topics" className="listbox sunken">
        {HELP_TOPICS.map((item, index) => (
          <div key={item.slug} className="help-topic-entry">
            {item.group !== HELP_TOPICS[index - 1]?.group && (
              <span className="help-group">{HELP_GROUPS[item.group]}</span>
            )}
            <button
              role="option"
              aria-selected={slug === item.slug}
              onClick={() => {
                setSlug(item.slug)
                if (location.hash.startsWith('#/help')) history.replaceState(null, '', helpHash(item.slug))
              }}
            >
              {item.title}
            </button>
          </div>
        ))}
      </div>
      <article className="sunken">
        <h2>{topic.title}</h2>
        <div className="help-body">{pages[slug]}</div>
        {program && <Button onClick={() => openProgram(program)}>Open {topic.title}</Button>}
      </article>
    </div>
  )
}
