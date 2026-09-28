import { useState } from 'react'
import { ListBox } from '../ui/ListBox'

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
  credits: (
    <>
      Paint · r3tardOS 98. manufactured and supported by r3tards. built to expose Monad mechanics instead of
      hiding them.
    </>
  ),
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
      </article>
    </div>
  )
}
