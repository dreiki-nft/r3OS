import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { PaintProgram } from '../paint/PaintProgram'
import { PassProgram } from '../pass/PassProgram'
import type { IconName } from './icons'
import { bottomRightWindowPosition, nextWindowPosition, openWindow } from './windows'
import { getReleaseSnapshot, isProgramAvailable, markProgramOpened, type ReleaseSnapshot } from './releases'
import { isRetiredProgram } from './retired'

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

const DxDiagProgram = lazy(() =>
  import('../diagnostics/DxDiagProgram').then((module) => ({ default: module.DxDiagProgram })),
)
const RunDialog = lazy(() => import('./RunDialog').then((module) => ({ default: module.RunDialog })))
const DisplayProperties = lazy(() =>
  import('./DisplayProperties').then((module) => ({ default: module.DisplayProperties })),
)
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
const LanesProgram = lazy(() =>
  import('../lanes/LanesProgram').then((module) => ({ default: module.LanesProgram })),
)
const NetworkProgram = lazy(() =>
  import('../network/NetworkProgram').then((module) => ({ default: module.NetworkProgram })),
)
const DefragProgram = lazy(() =>
  import('../defrag/DefragProgram').then((module) => ({ default: module.DefragProgram })),
)
const PageExeProgram = lazy(() =>
  import('../monadhw/PageExeProgram').then((module) => ({ default: module.PageExeProgram })),
)
const BlockCameraProgram = lazy(() =>
  import('../monadhw/BlockCameraProgram').then((module) => ({ default: module.BlockCameraProgram })),
)
const KernelDebuggerProgram = lazy(() =>
  import('../monadhw/KernelDebuggerProgram').then((module) => ({ default: module.KernelDebuggerProgram })),
)
const MonadHardwareProgram = lazy(() =>
  import('../monadhw/MonadHardwareProgram').then((module) => ({ default: module.MonadHardwareProgram })),
)
const CdromProgram = lazy(() =>
  import('../cdrom/CdromProgram').then((module) => ({ default: module.CdromProgram })),
)
const ImagingProgram = lazy(() =>
  import('../cdrom/ImagingProgram').then((module) => ({ default: module.ImagingProgram })),
)
const CardMemProgram = lazy(() =>
  import('../monadhw/CardMemProgram').then((module) => ({ default: module.CardMemProgram })),
)
const RouterProgram = lazy(() =>
  import('../router/RouterProgram').then((module) => ({ default: module.RouterProgram })),
)

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
  {
    id: 'cdrom',
    title: 'CD-ROM (D:)',
    icon: 'cdrom',
    colour: '#C9C9C9',
    component: CdromProgram,
    defaultSize: { width: 860, height: 560 },
    minSize: { width: 620, height: 420 },
    singleInstance: true,
    hash: '#/cdrom',
  },
  {
    id: 'lanes',
    title: 'Lanes',
    icon: 'chip',
    colour: '#D47827',
    component: LanesProgram,
    defaultSize: { width: 1200, height: 744 },
    minSize: { width: 760, height: 520 },
    singleInstance: true,
    hash: '#/lanes',
  },
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
  {
    id: 'validators',
    title: 'Validators',
    icon: 'globe',
    colour: '#5FEDDF',
    component: NetworkProgram,
    defaultSize: { width: 1200, height: 744 },
    minSize: { width: 760, height: 520 },
    singleInstance: true,
    hash: '#/validators',
  },
  {
    id: 'defrag',
    title: 'Disk Defragmenter',
    icon: 'layers',
    colour: '#9F70DA',
    component: DefragProgram,
    defaultSize: { width: 1200, height: 744 },
    minSize: { width: 760, height: 520 },
    singleInstance: true,
    hash: '#/defrag',
  },
  {
    id: 'page-exe',
    title: 'PAGE.EXE',
    icon: 'floppy',
    colour: '#5FEDDF',
    component: PageExeProgram,
    defaultSize: { width: 1200, height: 744 },
    minSize: { width: 760, height: 520 },
    singleInstance: true,
    hash: '#/page-exe',
  },
  {
    id: 'card-mem',
    title: 'CARDMEM.EXE',
    icon: 'chip',
    colour: '#5FEDDF',
    component: CardMemProgram,
    defaultSize: { width: 1200, height: 744 },
    minSize: { width: 760, height: 520 },
    singleInstance: true,
    hash: '#/card-mem',
  },
  {
    id: 'block-camera',
    title: 'Block Camera',
    icon: 'target',
    colour: '#FEC343',
    component: BlockCameraProgram,
    defaultSize: { width: 980, height: 744 },
    minSize: { width: 700, height: 520 },
    singleInstance: true,
    hash: '#/block-camera',
  },
  {
    id: 'kernel-debugger',
    title: 'Kernel Debugger',
    icon: 'bomb',
    colour: '#C52020',
    component: KernelDebuggerProgram,
    defaultSize: { width: 920, height: 700 },
    minSize: { width: 680, height: 520 },
    singleInstance: true,
    hash: '#/kernel-debugger',
  },
  {
    id: 'router',
    title: 'ROUTER.EXE',
    icon: 'antenna',
    colour: '#5FEDDF',
    component: RouterProgram,
    defaultSize: { width: 1200, height: 744 },
    minSize: { width: 760, height: 520 },
    singleInstance: true,
    hash: '#/router',
  },
  {
    id: 'monad-hw',
    title: 'Explore Monad',
    icon: 'lightning',
    colour: '#5FEDDF',
    component: MonadHardwareProgram,
    defaultSize: { width: 980, height: 700 },
    minSize: { width: 700, height: 520 },
    singleInstance: true,
    hash: '#/monad-hw',
  },
  {
    id: 'dxdiag',
    title: 'DXDIAG.EXE',
    icon: 'zoom',
    colour: '#5FEDDF',
    component: DxDiagProgram,
    defaultSize: { width: 720, height: 600 },
    minSize: { width: 520, height: 440 },
    singleInstance: true,
    hash: '#/dxdiag',
  },
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
    id: 'imaging',
    title: 'Imaging',
    icon: 'gallery',
    colour: '#EE93E3',
    component: ImagingProgram,
    defaultSize: { width: 760, height: 620 },
    minSize: { width: 520, height: 460 },
    singleInstance: true,
    hash: '#/imaging',
    hidden: true,
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
    id: 'display-props',
    title: 'Display Properties',
    icon: 'computer',
    colour: '#5FEDDF',
    component: DisplayProperties,
    defaultSize: { width: 610, height: 520 },
    minSize: { width: 320, height: 360 },
    singleInstance: true,
    hash: '#/display-props',
    hidden: true,
    alwaysOnTop: true,
    modal: true,
    controls: 'close',
  },
  {
    id: 'run',
    title: 'Run',
    icon: 'rocket',
    colour: '#FEC343',
    component: RunDialog,
    defaultSize: { width: 430, height: 236 },
    minSize: { width: 430, height: 236 },
    singleInstance: true,
    hash: '#/run',
    hidden: true,
    alwaysOnTop: true,
    modal: true,
    controls: 'close',
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

export const programById = (id: string) => programs.find((program) => program.id === id)

export function programIsVisible(program: ProgramDef, snapshot: ReleaseSnapshot = getReleaseSnapshot()) {
  return !program.hidden && !isRetiredProgram(program.id) && isProgramAvailable(program.id, snapshot)
}

export const visiblePrograms = (snapshot: ReleaseSnapshot = getReleaseSnapshot()) =>
  programs.filter((program) => programIsVisible(program, snapshot))

export function openProgram(id: string, updateHash = true, hashOverride?: string) {
  const program = programById(id)
  // Retired programs are never opened, by any route (desktop, Start, Run…, deep link, in-app button).
  if (!program || isRetiredProgram(program.id)) return false
  if (!program.hidden && !isProgramAvailable(program.id)) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('r3os:not-installed', { detail: { id: program.id, title: program.title } }),
      )
    }
    return false
  }
  if (!program.hidden && !getReleaseSnapshot().revealAll) markProgramOpened(program.id)
  const rect =
    program.placement === 'bottom-right'
      ? bottomRightWindowPosition(program.defaultSize, program.minSize)
      : nextWindowPosition(program.defaultSize, program.minSize)
  openWindow(program.id, rect, program.minSize, program.alwaysOnTop, program.placement !== 'bottom-right')
  const hash = hashOverride ?? program.hash
  // Paint is the home surface. Normal opens should not make it the next boot route; explicit deep links still work.
  const shouldUpdateHash = updateHash && (program.id !== 'paint' || hashOverride != null)
  if (shouldUpdateHash && location.hash !== hash) location.hash = hash
  return true
}
