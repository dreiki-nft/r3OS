# r3OS 98 asset pack

Drop this folder into the web app's `public/` as `public/os/`. Everything here is already sized and normalised. Nothing needs a build step.

```
os/
  icons/       60 pixel icons, white on transparent, 36 px (name.png) and 72 px (name@2x.png)
  sfx/         12 sound effects, mp3, loudness-matched (about -24 dB mean, -1.5 dB peak)
  wallpaper/   wallpaper-dark.webp  (emo wallpaper with the purple background swapped for charcoal)
  badges/      13 quest badges, q00 … q12 (see Quest badges)
  brand/       logo.png (Start button, Pass monitor for non-holders)
               pfp-main.webp (Painter Pass "Manufactured and supported by")
               assistant.webp (the r3tard assistant, bottom-right)
```

Holders' own r3tards (the Pass monitor's "Display:" picker) are not in this pack; the site loads them from the collection's `tokenURI` at runtime.

## Theme tokens (neutral dark, one palette accent)

| Token | Value | Used for |
|---|---|---|
| desktop | `#0b0b0c` | page background behind the wallpaper |
| face | `#232326` | window body, taskbar, buttons |
| face-2 | `#1b1b1e` | inactive tabs |
| field | `#0e0e10` | sunken wells: canvas frame, list boxes, inputs |
| bevel-light | `#6b6b73` | 1 px top/left highlight |
| bevel-light-2 | `#3d3d44` | 2 px inner highlight |
| bevel-dark | `#121214` | 2 px inner shadow |
| bevel-outer | `#000000` | 1 px bottom/right edge |
| text | `#f2efe9` | body copy |
| text-muted | `#a3a09a` | captions, inactive titles |
| title-active | `linear-gradient(90deg, #0a0a0b, #4a4a52)` | focused window title bar |
| title-inactive | `linear-gradient(90deg, #2b2b31, #3a3a41)` | unfocused title bar, muted text |
| window-shadow | `6px 6px 0 rgba(0,0,0,.55)` | hard offset shadow on windows |
| accent | `#5feddf` (palette 11, DF1 cyan) | focus ring, radio/checkbox. Never a button fill: buttons are always the neutral face; the default button gets bold text and a 1 px black ring. |
| accent-soft | `rgba(95,237,223,.22)` | selected rows, icons and list items (text stays light) |

Wallpaper: `filter: saturate(.7) brightness(.5) contrast(1.06)` plus a black vignette, SVG fractal noise at 20% overlay, and white grain. The corruption extras (scratches, NO SIGNAL / DF1 200% tags, the ♡) are off-white or palette gold/pink at low opacity. No purple anywhere.

Bevel recipe:

```css
.raised { box-shadow: inset -1px -1px 0 #000, inset 1px 1px 0 #6b6b73, inset -2px -2px 0 #121214, inset 2px 2px 0 #3d3d44; }
.sunken { box-shadow: inset 1px 1px 0 #000, inset -1px -1px 0 #6b6b73, inset 2px 2px 0 #121214, inset -2px -2px 0 #3d3d44; }
.window { box-shadow: inset -1px -1px 0 #000, inset 1px 1px 0 #6b6b73, inset -2px -2px 0 #121214, inset 2px 2px 0 #3d3d44, 6px 6px 0 rgba(0,0,0,.55); }
```

## Icons: recolour with CSS masks

The PNGs are white masks, so one file can take any palette colour:

```css
.ico {
  width: 36px; height: 36px;
  background: var(--ico-colour, #f2efe9);
  -webkit-mask: var(--ico) center / contain no-repeat;
          mask: var(--ico) center / contain no-repeat;
  image-rendering: pixelated;
}
```

```html
<span class="ico" style="--ico: url(/os/icons/paint@2x.png); --ico-colour: #F7931A"></span>
```

Sizes: the art was drawn on a 24 px grid and stored at 36 px. Render at **36 px** (desktop), **24 px** (toolbars, taskbar, start menu, title bars 20 px) or **72 px** from `@2x`. Avoid 48 px, which stretches the pixels unevenly.

Colour mapping (all from the r3tards 16-colour palette):

| Where | Icon file | Colour |
|---|---|---|
| r3tards Paint | `paint` | `#F7931A` orange |
| My Pass / System Properties | `computer` | `#FFFFFF` |
| My Frames | `gallery` | `#EE93E3` pink |
| Block Camera | `target` | `#FEC343` gold |
| Explore Monad | `lightning` | `#FEC343` gold |
| Burn a CD | `music` | `#EE93E3` pink |
| Monad X-ray | `eye` | `#5FEDDF` teal |
| DXDIAG | `zoom` | `#F2EFE9` |
| Finale Auction | `gavel` | `#FFFFFF` |
| Quests | `trophy` | `#FEC343` gold |
| Validators | `globe` | `#5FEDDF` teal |
| Sounds | `music` | `#EE93E3` pink |
| Help | `help` | `#FFFFFF` |
| Recycle Bin | `trash` | `#877549` olive |
| CD-ROM (D:), empty drive | `cdrom` | `#C9C9C9` silver |
| CD-ROM (D:), disc inserted | `disc` | `#C9C9C9` silver |
| Imaging (track viewer) | `gallery` | `#EE93E3` pink |
| Tools: pencil, brush, fill, picker, eraser, zoom | `pencil` `brush` `bucket` `picker` `eraser` `zoom` | `#F2EFE9` |
| Tray: sound | `speaker` | `#F2EFE9` |
| Tray: next storm, storm screen | `lightning` | `#FEC343` |
| Tray: connected | `antenna` | `#F2EFE9` |
| Start menu: connect wallet | `key` | `#F2EFE9` |
| Dialogs: info / OK status | `info` | `#5FEDDF` |
| Dialogs: warning, device problem | `warning` | `#FEC343` |
| Dialogs: error, revert | `error` | `#C52020` |
| Busy cursor | `hourglass` | `#F2EFE9` |
| Spare, for later | `crown` `floppy` `frog` `gift` `star` `lock` `briefcase` `eye` `skull` `bomb` `dice` `bell` `flash` `calendar` `target` `rocket` `chat` `mail` `toggle` `cursor` `home` `medal` `heart` `umbrella` `meteor` `moon` `layers` `wand` `clock` `question-filled` | pick from the palette |

The icon directory also retains masks used by historical/retired experiments. Those files are assets only; the production program registry is the source of truth for which windows are launchable.

## Quest badges (`badges/`)

One 60 × 60 pixel badge per day-one quest, octagon pin in a palette colour with a pack icon on top. Show them at 60 px (crisp) or 120 px (`image-rendering: pixelated`); 40 px in dense lists is fine. Locked quests use `filter: grayscale(1) brightness(.5); opacity: .6`. They are website art only; onchain the Pass shows `QUESTS n`.

| Quest id | Badge | Icon | Base colour |
|---:|---|---|---|
| 0 | `q00_month_in.png` | calendar | `#C52020` |
| 1 | `q01_storm_regular.png` | lightning | `#000000` |
| 2 | `q02_live_wire.png` | antenna | `#5FEDDF` |
| 3 | `q03_pixels_10k.png` | palette | `#FEC343` |
| 4 | `q04_archivist.png` | floppy | `#965E4B` |
| 5 | `q05_animator.png` | film | `#EE93E3` |
| 6 | `q06_reel_maker.png` | layers | `#D47827` |
| 7 | `q07_green_thumb.png` | sprout | `#07992F` |
| 8 | `q08_timelines.png` | tree | `#A0055D` |
| 9 | `q09_dna_hunter.png` | dna | `#C864AA` |
| 10 | `q10_lab_rat.png` | frog | `#F7931A` |
| 11 | `q11_paddle_up.png` | gavel | `#FFFFFF` |
| 12 | `q12_recycler.png` | trash | `#694B87` |

Quests added later (ids 13+) fall back to a generic trophy badge until art exists for them.

## Sound map

| File | Plays when |
|---|---|
| `system-initiate.mp3` | wallet connects / r3OS boots |
| `system-shutdown.mp3` | disconnect, Start › Shut Down |
| `select.mp3` | selecting a tool, colour, desktop icon, tab, list row; menu clicks |
| `confirm.mp3` | the wallet signed; OK buttons |
| `cancel.mp3` | close boxes, Cancel, dismissing a balloon |
| `success-light.mp3` | paint landed and other lightweight successful actions |
| `success-heavy.mp3` | frame/CD minted, stamp earned, quest complete, auction won |
| `error.mp3` | a revert, or an action that needs something first (out of budget, verify before catch) |
| `storm.mp3` | once when a DF1 storm starts; never loops |
| `df1.mp3` | DF1 glitched pixels you painted |
| `cute-bubble.mp3` | tray balloons, assistant pop-ups |
| `text.mp3` | the r3tard assistant says something new |

Rules for the frontend:

- Nothing plays until the first user click (browsers block autoplay anyway). Never play on page load.
- A tray speaker toggles mute; persist it in `localStorage` (`r3os.muted`), wrapped in try/catch. Default volume 60%.
- Preload with `new Audio(src)` once per file and `cloneNode()` to overlap; cap at one instance per sound per 80 ms so fast clicking doesn't stack.
- Respect `prefers-reduced-motion` for animations only, not sound; the mute toggle covers sound.
- One sound per action. When an action has two stages (sign, then land), play `confirm` on signature and `success-light` on receipt.
