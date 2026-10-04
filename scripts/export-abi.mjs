import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outPath = path.join(root, 'src/lib/generated/abi.ts')

const contracts = [
  ['R3OS_PAINT_ABI', 'R3OSPaint.sol/R3OSPaint.json'],
  ['R3OS_PAINTER_PASS_ABI', 'R3OSPainterPass.sol/R3OSPainterPass.json'],
  ['R3OS_LABS_ABI', 'R3OSLabs.sol/R3OSLabs.json'],
  ['DIFF_RENDERER_ABI', 'DiffRenderer.sol/DiffRenderer.json'],
  ['SEASON_TIMELAPSE_RENDERER_ABI', 'SeasonTimelapseRenderer.sol/SeasonTimelapseRenderer.json'],
  ['DF1_RENDERER_ABI', 'DF1Renderer.sol/DF1Renderer.json'],
  ['R3OS_FINALE_AUCTION_ABI', 'R3OSFinaleAuction.sol/R3OSFinaleAuction.json'],
  ['R3OS_QUESTS_ABI', 'R3OSQuests.sol/R3OSQuests.json'],
  ['R3OS_RECYCLE_BIN_ABI', 'R3OSRecycleBin.sol/R3OSRecycleBin.json'],
  ['R3OS_CD_BURNER_ABI', 'R3OSCDBurner.sol/R3OSCDBurner.json'],
  ['R3OS_PAGE_EXE_ABI', 'R3OSPageExe.sol/R3OSPageExe.json'],
  ['R3OS_BLOCK_CAMERA_ABI', 'R3OSBlockCamera.sol/R3OSBlockCamera.json'],
  ['R3OS_CARD_MEMORY_ABI', 'R3OSCardMemory.sol/R3OSCardMemory.json'],
  ['R3OS_OPERATOR_RECORD_ABI', 'R3OSOperatorRecord.sol/R3OSOperatorRecord.json'],
  ['R3OS_SYSTEM_EVENT_ABI', 'R3OSSystemEvent.sol/R3OSSystemEvent.json'],
  ['R3OS_ROUTER_LAB_ABI', 'R3OSRouterLab.sol/R3OSRouterLab.json'],
]

const sections = ['// GENERATED FILE. DO NOT EDIT.', '// Sources: contracts/out Foundry artifacts', '']
for (const [exportName, relativeArtifact] of contracts) {
  const artifactPath = path.join(root, 'contracts/out', relativeArtifact)
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Missing ${path.relative(root, artifactPath)}. Run npm run contracts:build first.`)
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  if (!Array.isArray(artifact.abi)) throw new Error(`${relativeArtifact} has no ABI array`)
  sections.push(`export const ${exportName} = ${JSON.stringify(artifact.abi, null, 2)} as const`)
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${sections.join('\n')}\n`)
console.log(`wrote ${path.relative(root, outPath)} (${contracts.length} contract ABIs)`)
