import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { IconName } from './icons'
import { bottomRightWindowPosition, clampRect, getWindows, nextWindowPosition, openWindow } from './windows'
import { getReleaseSnapshot, isProgramAvailable, markProgramOpened, type ReleaseSnapshot } from './releases'
import { isRetiredProgram } from './retired'
import { markProgramOpen } from '../chain/perf'

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
  placement?: 'cascade' | 'bottom-right' | 'top-left'
  pinToggle?: boolean
}

const JudgeMode = lazy(() => import('../demo/JudgeMode').then((m) => ({ default: m.JudgeMode })))
const PaintProgram = lazy(() =>
  import('../paint/PaintProgram').then((module) => ({ default: module.PaintProgram })),
)
const PassProgram = lazy(() =>
  import('../pass/PassProgram').then((module) => ({ default: module.PassProgram })),
)
const RaffleProgram = lazy(() =>
  import('../raffle/RaffleProgram').then((module) => ({ default: module.RaffleProgram })),
)
const StatusProgram = lazy(() =>
  import('../status/StatusProgram').then((module) => ({ default: module.StatusProgram })),
)
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
const QuestsProgram = lazy(() =>
  import('../labs/QuestsProgram').then((module) => ({ default: module.QuestsProgram })),
)
const AuctionProgram = lazy(() =>
  import('../labs/AuctionProgram').then((module) => ({ default: module.AuctionProgram })),
)
const CDBurnerProgram = lazy(() =>
  import('../labs/CDBurnerProgram').then((module) => ({ default: module.CDBurnerProgram })),
)
const NetworkProgram = lazy(() =>
  import('../network/NetworkProgram').then((module) => ({ default: module.NetworkProgram })),
)
const BlockCameraProgram = lazy(() =>
  import('../monadhw/BlockCameraProgram').then((module) => ({ default: module.BlockCameraProgram })),
)
const MonadHardwareProgram = lazy(() =>
  import('../monadhw/MonadHardwareProgram').then((module) => ({ default: module.MonadHardwareProgram })),
)
const ReplayProgram = lazy(() =>
  import('../replay/ReplayProgram').then((module) => ({ default: module.ReplayProgram })),
)
const StormChasersProgram = lazy(() =>
  import('../storms/StormChasersProgram').then((module) => ({ default: module.StormChasersProgram })),
)
const CdromProgram = lazy(() =>
  import('../cdrom/CdromProgram').then((module) => ({ default: module.CdromProgram })),
)
const ImagingProgram = lazy(() =>
  import('../cdrom/ImagingProgram').then((module) => ({ default: module.ImagingProgram })),
)

export const programs: ProgramDef[] = [
  {
    id: 'demo',
    title: 'demo.exe · Judge Mode',
    icon: 'computer',
    colour: '#5FEDDF',
    component: JudgeMode,
    defaultSize: { width: 316, height: 650 },
    minSize: { width: 280, height: 385 },
    singleInstance: true,
    hash: '#/demo',
    hidden: true,
    alwaysOnTop: true,
    controls: 'min-close',
    placement: 'top-left',
  },
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
    defaultSize: { width: 720, height: 820 },
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
    id: 'replay',
    title: 'Season Replay',
    icon: 'replay',
    colour: '#5FEDDF',
    component: ReplayProgram,
    defaultSize: { width: 580, height: 720 },
    minSize: { width: 340, height: 460 },
    singleInstance: true,
    hash: '#/replay',
  },
  {
    id: 'storms',
    title: 'Storm Chasers',
    icon: 'lightning',
    colour: '#FEC343',
    component: StormChasersProgram,
    defaultSize: { width: 460, height: 620 },
    minSize: { width: 320, height: 420 },
    singleInstance: true,
    hash: '#/storms',
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
    title: 'Network',
    icon: 'globe',
    colour: '#5FEDDF',
    component: NetworkProgram,
    defaultSize: { width: 1200, height: 744 },
    minSize: { width: 760, height: 520 },
    singleInstance: true,
    hash: '#/validators',
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
    id: 'raffle',
    title: 'RAFFLE.EXE',
    icon: 'medal',
    colour: '#FEC343',
    component: RaffleProgram,
    defaultSize: { width: 520, height: 680 },
    minSize: { width: 320, height: 440 },
    singleInstance: true,
    hash: '#/raffle',
  },
  {
    id: 'status',
    title: 'r3OS Status',
    icon: 'antenna',
    colour: '#5FEDDF',
    component: StatusProgram,
    defaultSize: { width: 520, height: 640 },
    minSize: { width: 320, height: 420 },
    singleInstance: true,
    hash: '#/status',
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
    defaultSize: { width: 640, height: 520 },
    minSize: { width: 520, height: 420 },
    singleInstance: true,
    hash: '#/live-wizard',
    hidden: true,
    alwaysOnTop: true,
    modal: true,
    controls: 'close',
  },
]

type ProgramPreload = {
  id: string
  label: string
  load: () => Promise<ComponentType>
}

const launchPreloads: readonly ProgramPreload[] = [
  { id: 'paint', label: 'Paint', load: () => import('../paint/PaintProgram').then((m) => m.PaintProgram) },
  { id: 'pass', label: 'My Pass', load: () => import('../pass/PassProgram').then((m) => m.PassProgram) },
  { id: 'frames', label: 'My Frames', load: () => import('../frames/FramesProgram').then((m) => m.FramesProgram) },
  {
    id: 'frame-props',
    label: 'Frame Properties',
    load: () => import('../frames/FramePropsDialog').then((m) => m.FramePropsDialog),
  },
  {
    id: 'block-camera',
    label: 'Block Camera',
    load: () => import('../monadhw/BlockCameraProgram').then((m) => m.BlockCameraProgram),
  },
  { id: 'cdrom', label: 'CD-ROM', load: () => import('../cdrom/CdromProgram').then((m) => m.CdromProgram) },
  { id: 'replay', label: 'Season Replay', load: () => import('../replay/ReplayProgram').then((m) => m.ReplayProgram) },
  {
    id: 'storms',
    label: 'Storm Chasers',
    load: () => import('../storms/StormChasersProgram').then((m) => m.StormChasersProgram),
  },
  { id: 'cd', label: 'Burn a CD', load: () => import('../labs/CDBurnerProgram').then((m) => m.CDBurnerProgram) },
  {
    id: 'monad-hw',
    label: 'Explore Monad',
    load: () => import('../monadhw/MonadHardwareProgram').then((m) => m.MonadHardwareProgram),
  },
  {
    id: 'validators',
    label: 'Network Neighborhood',
    load: () => import('../network/NetworkProgram').then((m) => m.NetworkProgram),
  },
  { id: 'quests', label: 'Quests', load: () => import('../labs/QuestsProgram').then((m) => m.QuestsProgram) },
  { id: 'auction', label: 'Auction', load: () => import('../labs/AuctionProgram').then((m) => m.AuctionProgram) },
  { id: 'bin', label: 'Recycle Bin', load: () => import('./programs/RecycleBin').then((m) => m.RecycleBin) },
  { id: 'raffle', label: 'RAFFLE.EXE', load: () => import('../raffle/RaffleProgram').then((m) => m.RaffleProgram) },
  { id: 'status', label: 'r3OS Status', load: () => import('../status/StatusProgram').then((m) => m.StatusProgram) },
  {
    id: 'dxdiag',
    label: 'DXDIAG',
    load: () => import('../diagnostics/DxDiagProgram').then((m) => m.DxDiagProgram),
  },
  { id: 'xray', label: 'Monad X-ray', load: () => import('../xray/XRayProgram').then((m) => m.XRayProgram) },
  { id: 'live-wizard', label: 'Live Mode', load: () => import('../live/LiveWizard').then((m) => m.LiveWizard) },
  { id: 'help', label: 'Help', load: () => import('./programs/HelpProgram').then((m) => m.HelpProgram) },
]

const preloadPromises = new Map<string, Promise<unknown>>()

function preloadEntry(entry: ProgramPreload) {
  const existing = preloadPromises.get(entry.id)
  if (existing) return existing
  // Loading the raw ES module is not enough to warm React.lazy itself: the lazy wrapper still suspends
  // once on its first render, which can trigger React's ~300ms Suspense retry throttle. Replace the
  // registry entry with the already-resolved component as soon as boot/hover preload finishes so the
  // first real open renders synchronously.
  const pending = entry.load().then((component) => {
    const program = programs.find((item) => item.id === entry.id)
    if (program) program.component = component
    return component
  })
  preloadPromises.set(entry.id, pending)
  return pending
}

/** Warm one program on hover/focus as a fallback for anything the boot pass did not finish. */
export function preloadProgram(id: string) {
  const entry = launchPreloads.find((item) => item.id === id)
  return entry ? preloadEntry(entry).then(() => undefined) : Promise.resolve()
}

/**
 * Download the launch-critical program chunks while the boot screen is already occupying the user.
 * Dynamic imports are module-loader deduplicated; completed preloads also replace the lazy registry entry so first open renders synchronously.
 */
export async function preloadLaunchPrograms(
  onProgress?: (done: number, total: number, label: string) => void,
) {
  if (typeof window === 'undefined') return
  let done = 0
  const total = launchPreloads.length
  onProgress?.(done, total, 'starting')
  const results = await Promise.allSettled(
    launchPreloads.map(async (entry) => {
      try {
        await preloadEntry(entry)
      } finally {
        done += 1
        onProgress?.(done, total, entry.label)
      }
    }),
  )
  const failed = results.filter((result) => result.status === 'rejected').length
  if (failed) throw new Error(`${failed} program chunk${failed === 1 ? '' : 's'} failed to preload`)
}

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
      : program.placement === 'top-left'
        ? clampRect({ x: 8, y: 44, ...program.defaultSize }, undefined, undefined, program.minSize)
        : nextWindowPosition(program.defaultSize, program.minSize)
  const alreadyOpen = getWindows().windows.some((win) => win.id === program.id)
  if (!alreadyOpen) markProgramOpen(program.id)
  openWindow(program.id, rect, program.minSize, program.alwaysOnTop, program.placement === 'cascade' || !program.placement)
  const hash = hashOverride ?? program.hash
  // Paint is the home surface. Normal opens should not make it the next boot route; explicit deep links still work.
  const shouldUpdateHash = updateHash && (program.id !== 'paint' || hashOverride != null)
  if (shouldUpdateHash && location.hash !== hash) location.hash = hash
  return true
}
