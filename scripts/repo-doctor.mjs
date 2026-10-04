import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const problems = []

const forbiddenRootFiles = [
  'APPLY_PHASE6_CLEANUP.sh',
  'APPLY.txt',
  'CLAUDE_SNAPSHOT_28_REVIEW.md',
  'DELETIONS.txt',
  'PATCH.diff',
  'PATCH_NOTES.txt',
  'README.txt',
  'REVIEW_WITH_CLAUDE.md',
  'ddd',
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

for (const file of forbiddenRootFiles) {
  if (existsSync(resolve(root, file))) problems.push(`stale root artifact: ${file}`)
}
for (const file of retiredUiFiles) {
  if (existsSync(resolve(root, file))) problems.push(`retired frontend source still present: ${file}`)
}
for (const file of deadFiles) {
  if (existsSync(resolve(root, file))) problems.push(`dead frontend source still present: ${file}`)
}
if (existsSync(resolve(root, 'contracts/contracts'))) {
  problems.push('duplicate stale Foundry tree: contracts/contracts')
}

const read = (file) => readFileSync(resolve(root, file), 'utf8')
const readme = read('README.md')
for (const placeholder of ['LIVE_APP_URL', 'DEMO_VIDEO_URL', 'MAINNET_ADDRESSES']) {
  if (readme.includes(placeholder)) problems.push(`README placeholder: ${placeholder}`)
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
  'public/os/README.md',
  ...markdownUnder('docs'),
]

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
  console.log('repo doctor: OK — root, docs, links and retired UI reachability are clean')
}
