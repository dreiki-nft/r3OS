import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outPath = path.join(root, 'src/lib/generated/abi.ts')

const contracts = [
  ['R3TARDS_PAINT_ABI', 'R3tardsPaint.sol/R3tardsPaint.json'],
  ['R3TARDS_PAINTER_PASS_ABI', 'R3tardsPainterPass.sol/R3tardsPainterPass.json'],
  ['R3TARDS_LABS_ABI', 'R3tardsLabs.sol/R3tardsLabs.json'],
  ['R3TARDS_FLIPBOOK_ABI', 'R3tardsFlipbook.sol/R3tardsFlipbook.json'],
  ['DIFF_RENDERER_ABI', 'DiffRenderer.sol/DiffRenderer.json'],
  ['SEASON_TIMELAPSE_RENDERER_ABI', 'SeasonTimelapseRenderer.sol/SeasonTimelapseRenderer.json'],
  ['DF1_RENDERER_ABI', 'DF1Renderer.sol/DF1Renderer.json'],
  ['R3TARDS_WEEDS_ABI', 'R3tardsWeeds.sol/R3tardsWeeds.json'],
  ['R3TARDS_FORKS_ABI', 'R3tardsForks.sol/R3tardsForks.json'],
  ['R3TARDS_BRUSHES_ABI', 'R3tardsBrushes.sol/R3tardsBrushes.json'],
  ['R3TARDS_FINALE_AUCTION_ABI', 'R3tardsFinaleAuction.sol/R3tardsFinaleAuction.json'],
  ['R3TARDS_QUESTS_ABI', 'R3tardsQuests.sol/R3tardsQuests.json'],
  ['R3TARDS_SLEEPWALKER_ABI', 'R3tardsSleepwalker.sol/R3tardsSleepwalker.json'],
  ['R3TARDS_RECYCLE_BIN_ABI', 'R3tardsRecycleBin.sol/R3tardsRecycleBin.json'],
  ['R3TARDS_CD_BURNER_ABI', 'R3tardsCDBurner.sol/R3tardsCDBurner.json'],
  ['R3TARDS_PAGE_EXE_ABI', 'R3tardsPageExe.sol/R3tardsPageExe.json'],
  ['R3TARDS_BLOCK_CAMERA_ABI', 'R3tardsBlockCamera.sol/R3tardsBlockCamera.json'],
  ['R3TARDS_KERNEL_DEBUGGER_ABI', 'R3tardsKernelDebugger.sol/R3tardsKernelDebugger.json'],
  ['R3TARDS_CARD_MEMORY_ABI', 'R3tardsCardMemory.sol/R3tardsCardMemory.json'],
  ['R3TARDS_OPERATOR_RECORD_ABI', 'R3tardsOperatorRecord.sol/R3tardsOperatorRecord.json'],
  ['R3TARDS_SYSTEM_EVENT_ABI', 'R3tardsSystemEvent.sol/R3tardsSystemEvent.json'],
]

const sections = ['// GENERATED FILE. DO NOT EDIT.', '// Sources: contracts/out Foundry artifacts', '']
for (const [exportName, relativeArtifact] of contracts) {
  const artifactPath = path.join(root, 'contracts/out', relativeArtifact)
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Missing ${path.relative(root, artifactPath)}. Run npm run contracts:build first.`)
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  if (!Array.isArray(artifact.abi)) throw new Error(`${relativeArtifact} has no ABI array`)
  sections.push(`export const ${exportName} = ${JSON.stringify(artifact.abi, null, 2)} as const`, '')
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${sections.join('\n')}\n`)
console.log(`wrote ${path.relative(root, outPath)} (${contracts.length} contract ABIs)`)
