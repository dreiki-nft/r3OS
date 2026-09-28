import { createElement, lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { PaintProgram } from '../paint/PaintProgram'
import { PassProgram } from '../pass/PassProgram'
import type { IconName } from './icons'
import { bottomRightWindowPosition, nextWindowPosition, openWindow } from './windows'

export type WindowControls = 'full' | 'min-close' | 'help-close' | 'close'

export interface ProgramDef {
  id: string
  title: string
  icon: IconName
  colour: string
  component: ComponentType | LazyExoticComponent<ComponentType>
  defaultSize: { width: number; height: number }
  minSize: { width: number; height: number }
  singleInstance: boolean
  hash: string
  hidden?: boolean
  alwaysOnTop?: boolean
  modal?: boolean
  controls?: WindowControls
  placement?: 'cascade' | 'bottom-right'
  pinToggle?: boolean
}

const SoundsProgram = lazy(() =>
  import('./programs/SoundsProgram').then((module) => ({ default: module.SoundsProgram })),
)
const HelpProgram = lazy(() =>
  import('./programs/HelpProgram').then((module) => ({ default: module.HelpProgram })),
)
const RecycleBin = lazy(() =>
  import('./programs/RecycleBin').then((module) => ({ default: module.RecycleBin })),
)
const FramesProgram = lazy(() =>
  import('../frames/FramesProgram').then((module) => ({ default: module.FramesProgram })),
)
const FramePropsDialog = lazy(() =>
  import('../frames/FramePropsDialog').then((module) => ({ default: module.FramePropsDialog })),
)
const LiveWizard = lazy(() => import('../live/LiveWizard').then((module) => ({ default: module.LiveWizard })))
const XRayProgram = lazy(() =>
  import('../xray/XRayProgram').then((module) => ({ default: module.XRayProgram })),
)
const FlipbookProgram = lazy(() =>
  import('../labs/FlipbookProgram').then((module) => ({ default: module.FlipbookProgram })),
)
const WeedsProgram = lazy(() =>
  import('../labs/WeedsProgram').then((module) => ({ default: module.WeedsProgram })),
)
const ForksProgram = lazy(() =>
  import('../labs/ForksProgram').then((module) => ({ default: module.ForksProgram })),
)
const QuestsProgram = lazy(() =>
  import('../labs/QuestsProgram').then((module) => ({ default: module.QuestsProgram })),
)
const BlockDNAProgram = lazy(() =>
  import('../labs/BlockDNAProgram').then((module) => ({ default: module.BlockDNAProgram })),
)
const AuctionProgram = lazy(() =>
  import('../labs/AuctionProgram').then((module) => ({ default: module.AuctionProgram })),
)
const SleepwalkerProgram = lazy(() =>
  import('../labs/SleepwalkerProgram').then((module) => ({ default: module.SleepwalkerProgram })),
)
const CDBurnerProgram = lazy(() =>
  import('../labs/CDBurnerProgram').then((module) => ({ default: module.CDBurnerProgram })),
)

function placeholder(title: string, icon: IconName) {
  return lazy(async () => {
    const { Placeholder } = await import('./programs/Placeholder')
    return { default: () => createElement(Placeholder, { title, icon }) }
  })
}

const placeholderProgram = (
  id: string,
  title: string,
  icon: IconName,
  colour: string,
  hash = `#/${id}`,
): ProgramDef => ({
  id,
  title,
  icon,
  colour,
  component: placeholder(title, icon),
  defaultSize: { width: 440, height: 300 },
  minSize: { width: 320, height: 220 },
  singleInstance: true,
  hash,
})

export const programs: ProgramDef[] = [
  {
    id: 'paint',
    title: 'Paint',
    icon: 'paint',
    colour: '#F7931A',
    component: PaintProgram,
    defaultSize: { width: 770, height: 676 },
    minSize: { width: 520, height: 440 },
    singleInstance: true,
    hash: '#/paint',
  },
  {
    id: 'pass',
    title: 'My Pass',
    icon: 'computer',
    colour: '#FFFFFF',
    component: PassProgram,
    defaultSize: { width: 580, height: 632 },
    minSize: { width: 500, height: 480 },
    singleInstance: true,
    hash: '#/pass',
  },
  {
    id: 'frames',
    title: 'My Frames',
    icon: 'gallery',
    colour: '#EE93E3',
    component: FramesProgram,
    defaultSize: { width: 1200, height: 744 },
    minSize: { width: 760, height: 520 },
    singleInstance: true,
    hash: '#/frames',
  },
  {
    id: 'flipbook',
    title: 'Flipbook',
    icon: 'film',
    colour: '#5FEDDF',
    component: FlipbookProgram,
    defaultSize: { width: 1200, height: 744 },
    minSize: { width: 760, height: 520 },
    singleInstance: true,
    hash: '#/flipbook',
  },
  {
    id: 'weeds',
    title: 'Weeds',
    icon: 'sprout',
    colour: '#07992F',
    component: WeedsProgram,
    defaultSize: { width: 1200, height: 744 },
    minSize: { width: 760, height: 520 },
    singleInstance: true,
    hash: '#/weeds',
  },
  {
    id: 'forks',
    title: 'Forks',
    icon: 'tree',
    colour: '#9F70DA',
    component: ForksProgram,
    defaultSize: { width: 1200, height: 744 },
    minSize: { width: 760, height: 520 },
    singleInstance: true,
    hash: '#/forks',
  },
  {
    id: 'brushes',
    title: 'Block DNA',
    icon: 'dna',
    colour: '#C864AA',
    component: BlockDNAProgram,
    defaultSize: { width: 1200, height: 744 },
    minSize: { width: 760, height: 520 },
    singleInstance: true,
    hash: '#/brushes',
  },
  {
    id: 'sleepwalker',
    title: 'Sleepwalker',
    icon: 'moon',
    colour: '#9F70DA',
    component: SleepwalkerProgram,
    defaultSize: { width: 1200, height: 744 },
    minSize: { width: 760, height: 520 },
    singleInstance: true,
    hash: '#/sleepwalker',
  },
  {
    id: 'cd',
    title: 'Burn a CD',
    icon: 'music',
    colour: '#5FEDDF',
    component: CDBurnerProgram,
    defaultSize: { width: 1200, height: 744 },
    minSize: { width: 760, height: 520 },
    singleInstance: true,
    hash: '#/cd',
  },
  placeholderProgram('lanes', 'Lanes', 'chip', '#D47827'),
  {
    id: 'auction',
    title: 'Auction',
    icon: 'gavel',
    colour: '#FFFFFF',
    component: AuctionProgram,
    defaultSize: { width: 1200, height: 744 },
    minSize: { width: 760, height: 520 },
    singleInstance: true,
    hash: '#/auction',
  },
  {
    id: 'quests',
    title: 'Quests',
    icon: 'trophy',
    colour: '#FEC343',
    component: QuestsProgram,
    defaultSize: { width: 1200, height: 744 },
    minSize: { width: 760, height: 520 },
    singleInstance: true,
    hash: '#/quests',
  },
  placeholderProgram('validators', 'Validators', 'globe', '#5FEDDF'),
  {
    id: 'xray',
    title: 'Monad X-ray',
    icon: 'eye',
    colour: '#5FEDDF',
    component: XRayProgram,
    defaultSize: { width: 380, height: 676 },
    minSize: { width: 360, height: 520 },
    singleInstance: true,
    hash: '#/xray',
    alwaysOnTop: true,
    controls: 'min-close',
    placement: 'bottom-right',
    pinToggle: true,
  },
  {
    id: 'sounds',
    title: 'Sounds',
    icon: 'music',
    colour: '#EE93E3',
    component: SoundsProgram,
    defaultSize: { width: 520, height: 540 },
    minSize: { width: 430, height: 430 },
    singleInstance: true,
    hash: '#/sounds',
  },
  {
    id: 'help',
    title: 'Help',
    icon: 'help',
    colour: '#FFFFFF',
    component: HelpProgram,
    defaultSize: { width: 680, height: 520 },
    minSize: { width: 520, height: 400 },
    singleInstance: true,
    hash: '#/help',
  },
  {
    id: 'bin',
    title: 'Recycle Bin',
    icon: 'trash',
    colour: '#877549',
    component: RecycleBin,
    defaultSize: { width: 1200, height: 744 },
    minSize: { width: 760, height: 520 },
    singleInstance: true,
    hash: '#/bin',
  },
  {
    id: 'frame-props',
    title: 'Frame Properties',
    icon: 'gallery',
    colour: '#EE93E3',
    component: FramePropsDialog,
    defaultSize: { width: 580, height: 648 },
    minSize: { width: 560, height: 620 },
    singleInstance: true,
    hash: '#/frame-props',
    hidden: true,
    controls: 'help-close',
  },
  {
    id: 'live-wizard',
    title: 'Live Mode Setup Wizard',
    icon: 'key',
    colour: '#FFFFFF',
    component: LiveWizard,
    defaultSize: { width: 620, height: 470 },
    minSize: { width: 620, height: 470 },
    singleInstance: true,
    hash: '#/live-wizard',
    hidden: true,
    alwaysOnTop: true,
    modal: true,
    controls: 'close',
  },
]

export const visiblePrograms = () => programs.filter((program) => !program.hidden)
export const programById = (id: string) => programs.find((program) => program.id === id)

export function openProgram(id: string, updateHash = true, hashOverride?: string) {
  const program = programById(id)
  if (!program) return
  const rect =
    program.placement === 'bottom-right'
      ? bottomRightWindowPosition(program.defaultSize, program.minSize)
      : nextWindowPosition(program.defaultSize, program.minSize)
  openWindow(program.id, rect, program.minSize, program.alwaysOnTop, program.placement !== 'bottom-right')
  const hash = hashOverride ?? program.hash
  if (updateHash && location.hash !== hash) location.hash = hash
}
