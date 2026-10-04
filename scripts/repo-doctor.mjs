import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const problems = []

const forbiddenRootFiles = [
  'APPLY_PHASE6_CLEANUP.sh',
  'APPLY_R3OS_REBRAND.sh',
  'APPLY_PHASE7_5_CONTRACT_REBRAND.sh',
  'APPLY_PHASE7_6_SUBMISSION_CLEANUP.sh',
  'APPLY.txt',
  'CLAUDE_SNAPSHOT_28_REVIEW.md',
  'DELETIONS.txt',
  'PATCH.diff',
  'PATCH_NOTES.txt',
  'README.txt',
  'REVIEW_WITH_CLAUDE.md',
  'ddd',
  'PHASE_4_NOTES.md',
  'PHASE_4_1_NOTES.md',
  'PHASE_4_2_NOTES.md',
  'PHASE_4_3_NOTES.md',
  'PHASE_5B_NOTES.md',
]

const retiredUiFiles = [
  'src/defrag/DefragProgram.tsx',
  'src/defrag/defrag.css',
  'src/defrag/defrag.test.ts',
  'src/defrag/defrag.ts',
  'src/labs/BlockDNAProgram.tsx',
  'src/labs/FlipbookProgram.tsx',
  'src/labs/ForksProgram.tsx',
  'src/labs/SleepwalkerProgram.tsx',
  'src/labs/WeedsProgram.tsx',
  'src/labs/blockDNA.test.ts',
  'src/labs/sleepwalker.css',
  'src/labs/sleepwalker.test.ts',
  'src/labs/sleepwalker.ts',
  'src/labs/sleepwalkerDraft.ts',
  'src/labs/weeds.test.ts',
  'src/labs/weeds.ts',
  'src/lanes/LanesProgram.tsx',
  'src/lanes/lanesView.test.ts',
  'src/lanes/lanesView.ts',
  'src/lib/brushes.test.ts',
  'src/lib/brushes.ts',
  'src/lib/flipbook.test.ts',
  'src/lib/flipbook.ts',
  'src/lib/forks.test.ts',
  'src/lib/forks.ts',
  'src/lib/lanes.test.ts',
  'src/lib/lanes.ts',
  'src/monadhw/CardMemProgram.tsx',
  'src/monadhw/KernelDebuggerProgram.tsx',
  'src/monadhw/PageExeProgram.tsx',
  'src/monadhw/kernel.test.ts',
  'src/monadhw/kernel.ts',
  'src/monadhw/page.test.ts',
  'src/monadhw/page.ts',
  'src/monadhw/processKey.ts',
  'src/router/RouterProgram.tsx',
  'src/router/router.css',
]

const deadFiles = [
  'src/labs/LabCanvas.tsx',
  'src/lib/genesis.ts',
  'src/os/programs/Placeholder.tsx',
]

const requiredSubmissionFiles = [
  'contracts/src/R3OSPaint.sol',
  'contracts/src/R3OSPainterPass.sol',
  'contracts/src/R3OSLabs.sol',
  'contracts/src/monadhw/R3OSPageExe.sol',
  'contracts/src/monadhw/R3OSBlockCamera.sol',
  'contracts/src/monadcard/R3OSCardMemory.sol',
  'contracts/src/operator/R3OSOperatorRecord.sol',
  'contracts/src/operator/R3OSSystemEvent.sol',
  'contracts/src/router/R3OSRouterLab.sol',
  'contracts/script/Deploy.s.sol',
  'contracts/script/DeployMonadCard.s.sol',
  'contracts/script/DeployMonadHW.s.sol',
  'contracts/script/DeployOperator.s.sol',
  'contracts/script/DeployRouterLab.s.sol',
  'docs/specs/ROUTER_LAB.md',
  'docs/specs/MONAD_CARD.md',
]

const removedSubmissionFiles = [
  'contracts/src/interfaces/IR3OSSleepwalkerCore.sol',
  'contracts/src/labs/R3OSBrushes.sol',
  'contracts/src/labs/R3OSFlipbook.sol',
  'contracts/src/labs/R3OSForks.sol',
  'contracts/src/labs/R3OSSleepwalker.sol',
  'contracts/src/labs/SleepwalkerKey.sol',
  'contracts/src/labs/R3OSWeeds.sol',
  'contracts/src/lib/BrushDNA.sol',
  'contracts/src/monadhw/R3OSKernelDebugger.sol',
  'contracts/test/Brushes.t.sol',
  'contracts/test/Flipbook.t.sol',
  'contracts/test/Forks.t.sol',
  'contracts/test/Sleepwalker.t.sol',
  'contracts/test/Weeds.t.sol',
  'contracts/script/flipbook-genesis.hex',
  'scripts/export-flipbook-genesis.mjs',
  'docs/specs/BRUSHES.md',
  'docs/specs/FLIPBOOK.md',
  'docs/specs/FORKS.md',
  'docs/specs/KERNEL_DEBUGGER.md',
  'docs/specs/LANES.md',
  'docs/specs/SLEEPWALKER.md',
  'docs/specs/WEEDS.md',
  'docs/specs/ROUTER_EXE.md',
  'public/os/badges/q05_animator.png',
  'public/os/badges/q06_reel_maker.png',
  'public/os/badges/q07_green_thumb.png',
  'public/os/badges/q08_timelines.png',
  'public/os/badges/q09_dna_hunter.png',
  'public/os/badges/q10_lab_rat.png',
]

const legacyContractSources = [
  'contracts/src/R3tardsPaint.sol',
  'contracts/src/R3tardsPainterPass.sol',
  'contracts/src/R3tardsLabs.sol',
  'contracts/src/interfaces/IR3tardsPaintData.sol',
  'contracts/src/interfaces/IR3tardsSleepwalkerCore.sol',
  'contracts/src/labs/R3tardsBrushes.sol',
  'contracts/src/labs/R3tardsCDBurner.sol',
  'contracts/src/labs/R3tardsFinaleAuction.sol',
  'contracts/src/labs/R3tardsFlipbook.sol',
  'contracts/src/labs/R3tardsForks.sol',
  'contracts/src/labs/R3tardsQuests.sol',
  'contracts/src/labs/R3tardsRecycleBin.sol',
  'contracts/src/labs/R3tardsSleepwalker.sol',
  'contracts/src/labs/R3tardsWeeds.sol',
  'contracts/src/monadcard/R3tardsCardMemory.sol',
  'contracts/src/monadhw/R3tardsBlockCamera.sol',
  'contracts/src/monadhw/R3tardsKernelDebugger.sol',
  'contracts/src/monadhw/R3tardsPageExe.sol',
  'contracts/src/operator/R3tardsOperatorRecord.sol',
  'contracts/src/operator/R3tardsSystemEvent.sol',
  'contracts/src/router/R3tardsRouterLab.sol',
]


function allFiles(path = '.') {
  const absolute = resolve(root, path)
  if (!existsSync(absolute)) return []
  if (!statSync(absolute).isDirectory()) return [path]
  const out = []
  for (const entry of readdirSync(absolute)) {
    if (['.git', 'node_modules', 'dist', 'out', 'cache'].includes(entry)) continue
    const child = path === '.' ? entry : `${path}/${entry}`
    out.push(...allFiles(child))
  }
  return out
}

for (const file of allFiles()) {
  const base = file.split('/').at(-1) ?? file
  if (/\.(?:patch|diff)$/i.test(base)) problems.push(`patch artifact in submission tree: ${file}`)
  if (/(?:^|[_-])PROMPT(?:[_-]|\.)/i.test(base)) problems.push(`prompt artifact in submission tree: ${file}`)
  if (/^PHASE[_-].*(?:NOTES?|HANDOFF).*\.md$/i.test(base)) problems.push(`phase note in submission tree: ${file}`)
  if (/^Pasted text.*\.txt$/i.test(base)) problems.push(`chat paste artifact in submission tree: ${file}`)
}

for (const file of forbiddenRootFiles) {
  if (existsSync(resolve(root, file))) problems.push(`stale root artifact: ${file}`)
}
for (const file of retiredUiFiles) {
  if (existsSync(resolve(root, file))) problems.push(`retired frontend source still present: ${file}`)
}
for (const file of deadFiles) {
  if (existsSync(resolve(root, file))) problems.push(`dead frontend source still present: ${file}`)
}
for (const file of removedSubmissionFiles) {
  if (existsSync(resolve(root, file))) problems.push(`pruned submission artifact still present: ${file}`)
}
for (const file of requiredSubmissionFiles) {
  if (!existsSync(resolve(root, file))) problems.push(`required submission dependency missing: ${file}`)
}
for (const file of legacyContractSources) {
  if (existsSync(resolve(root, file))) problems.push(`legacy pre-mainnet contract source still present: ${file}`)
}
if (existsSync(resolve(root, 'contracts/contracts'))) {
  problems.push('duplicate stale Foundry tree: contracts/contracts')
}

const read = (file) => readFileSync(resolve(root, file), 'utf8')
const readme = read('README.md')

// Product rename guard: r3tards remains a collection/onchain namespace, but the old OS product name must not return.
const brandingFiles = [
  'README.md',
  'THREAT_MODEL.md',
  'index.html',
  'vite.config.ts',
  'contracts/README.md',
  ...markdownUnder('docs'),
]
for (const file of brandingFiles) {
  if (new RegExp('r3tard' + 'OS', 'i').test(read(file))) problems.push(`legacy product brand in ${file}`)
}
const legacyShellPath = ['src/os/R3tard', 'OS.tsx'].join('')
if (existsSync(resolve(root, legacyShellPath))) problems.push(`legacy shell component still present: ${legacyShellPath}`)

for (const placeholder of ['LIVE_APP_URL', 'DEMO_VIDEO_URL', 'MAINNET_ADDRESSES']) {
  if (readme.includes(placeholder)) problems.push(`README placeholder: ${placeholder}`)
}

const deployEnv = read('contracts/.env.example')
for (const [name, value] of [
  ['BASE_PIXELS_PER_HOUR', '512'],
  ['PIXELS_PER_ACTIVE_DAY', '32'],
  ['MAX_PIXELS_PER_HOUR', '2048'],
  ['MIN_PIXELS_FOR_ACTIVE_DAY', '16'],
  ['HOLDER_PIXELS_PER_DAY', '512'],
]) {
  if (!new RegExp(`^${name}=${value}$`, 'm').test(deployEnv)) {
    problems.push(`contracts/.env.example launch budget mismatch: ${name} must be ${value}`)
  }
}
if (!/^FINAL_OWNER=/m.test(deployEnv)) problems.push('contracts/.env.example missing FINAL_OWNER')

// Asset inventory is intentionally curated: every declared icon ships in 1x/2x form and no retired/spare masks linger.
const iconSource = read('src/os/icons.ts')
const declaredIcons = [...iconSource.matchAll(/^\s*'([^']+)',/gm)].map((match) => match[1])
const iconDir = resolve(root, 'public/os/icons')
const iconFiles = readdirSync(iconDir).filter((file) => file.endsWith('.png'))
for (const name of declaredIcons) {
  for (const file of [`${name}.png`, `${name}@2x.png`]) {
    if (!iconFiles.includes(file)) problems.push(`declared icon asset missing: public/os/icons/${file}`)
  }
}
for (const file of iconFiles) {
  const name = file.replace(/@2x(?=\.png$)/, '').replace(/\.png$/, '')
  if (!declaredIcons.includes(name)) problems.push(`unregistered icon asset in submission tree: public/os/icons/${file}`)
}

const abiExporter = read('scripts/export-abi.mjs')
for (const id of [
  'R3OS_PAGE_EXE_ABI',
  'R3OS_BLOCK_CAMERA_ABI',
  'R3OS_CARD_MEMORY_ABI',
  'R3OS_OPERATOR_RECORD_ABI',
  'R3OS_SYSTEM_EVENT_ABI',
  'R3OS_ROUTER_LAB_ABI',
]) {
  if (!abiExporter.includes(id)) problems.push(`active backend ABI missing from exporter: ${id}`)
}

const programs = read('src/os/programs.ts')
for (const id of [
  'FlipbookProgram',
  'WeedsProgram',
  'ForksProgram',
  'BlockDNAProgram',
  'SleepwalkerProgram',
  'LanesProgram',
  'DefragProgram',
  'PageExeProgram',
  'CardMemProgram',
  'KernelDebuggerProgram',
  'RouterProgram',
]) {
  if (programs.includes(id)) problems.push(`retired program is still bundled: ${id}`)
}

function markdownUnder(path) {
  const absolute = resolve(root, path)
  if (!existsSync(absolute)) return []
  if (!statSync(absolute).isDirectory()) return path.endsWith('.md') ? [path] : []
  const out = []
  for (const entry of readdirSync(absolute)) {
    const child = `${path}/${entry}`
    out.push(...markdownUnder(child))
  }
  return out
}

const markdownFiles = [
  'README.md',
  'THREAT_MODEL.md',
  'contracts/README.md',
  ...markdownUnder('docs'),
]

const removedContractIdentifiers = [
  'R3OSFlipbook',
  'R3OSWeeds',
  'R3OSForks',
  'R3OSBrushes',
  'R3OSSleepwalker',
  'SleepwalkerKey',
  'IR3OSSleepwalkerCore',
  'BrushDNA',
  'R3OSKernelDebugger',
]
const submissionWiringFiles = [
  'contracts/script/Deploy.s.sol',
  'contracts/script/DeployMonadHW.s.sol',
  'contracts/script/DeployOperator.s.sol',
  'scripts/export-abi.mjs',
]
for (const file of submissionWiringFiles) {
  const source = read(file)
  for (const id of removedContractIdentifiers) {
    if (source.includes(id)) problems.push(`pruned contract is still wired in ${file}: ${id}`)
  }
}

for (const file of markdownFiles) {
  const source = read(file)
  const link = /!?\[[^\]]*\]\(([^)]+)\)/g
  for (const match of source.matchAll(link)) {
    let target = match[1].trim()
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
    if (/^(?:https?:|mailto:|data:|#)/i.test(target)) continue
    target = target.split(/\s+["']/)[0].split('#')[0].split('?')[0]
    if (!target) continue
    try {
      target = decodeURIComponent(target)
    } catch {
      problems.push(`invalid encoded markdown link in ${file}: ${match[1]}`)
      continue
    }
    const destination = resolve(root, dirname(file), target)
    if (!existsSync(destination)) {
      problems.push(`broken markdown link in ${file}: ${target}`)
    }
  }
}

if (problems.length) {
  console.error('repo doctor: FAIL')
  for (const problem of problems) console.error(`- ${problem}`)
  process.exitCode = 1
} else {
  console.log('repo doctor: OK — source, docs, links, branding and submission surface are clean')
}
