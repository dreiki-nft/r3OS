/**
 * Phase 9E: a presentation-only route through existing programs.
 * This is deliberately NOT an automation of any onchain action or a source of telemetry.
 */
export const JUDGE_STEPS = [
  {
    title: 'World computer',
    question: 'What is r3OS?',
    detail: 'An operating system for the world computer. The browser talks directly to Monad RPC / WebSocket and reads contracts, storage and logs. No app-owned canonical backend or database.',
    cue: 'The chain sits inside the interaction loop, not behind the application as settlement-only infrastructure.',
    program: undefined,
    action: undefined,
  },
  {
    title: 'Local response',
    question: 'What does the writer see?',
    detail: 'Have the observer open in a separate browser profile first. Then draw a short stroke in Paint and commit with your wallet or an already-authorized Live session.',
    cue: 'The local working canvas responds first. That is user-perceived responsiveness, NOT finality.',
    program: 'paint',
    action: 'Focus Paint',
  },
  {
    title: 'Remote observation',
    question: 'Did another browser see it?',
    detail: 'Watch the Paint view that you opened in a separate browser profile, preferably walletless, BEFORE the writer committed.',
    cue: 'A second client updating from the real Painted event shows propagation. It does not prove settlement.',
    program: undefined,
    action: undefined,
  },
  {
    title: 'Protocol / settlement',
    question: 'What did Monad observe?',
    detail: 'Open X-Ray. Read the real monadLogs Proposed, Voted and Finalized observations. Receipt inclusion is a separate signal.',
    cue: 'Only an observed Finalized stage proves finalization. Missing stages stay missing.',
    program: 'xray',
    action: 'Focus X-Ray',
  },
  {
    title: 'MIP-8 / PAGE.EXE',
    question: 'Why Monad specifically?',
    detail: 'Open Explore Monad → Storage race, then press Run test. It compares reads inside a 4 KiB page with reads scattered across pages.',
    cue: 'This performs read-only eth_calls. Show the measured result, including if no page effect is observed.',
    program: 'monad-hw',
    action: 'Open Storage race',
  },
  {
    title: 'The thesis',
    question: 'Why does this matter?',
    detail: 'r3OS deliberately places blockchain operations in places conventional applications normally reserve for local servers, databases, realtime services, and application backends.',
    cue: 'The desktop is the interface. The experiment is putting Monad in the application interaction loop.',
    program: undefined,
    action: undefined,
  },
] as const

export type JudgeStepIndex = 0 | 1 | 2 | 3 | 4 | 5

export function moveJudgeStep(current: number, direction: -1 | 1): JudgeStepIndex {
  return Math.max(0, Math.min(JUDGE_STEPS.length - 1, current + direction)) as JudgeStepIndex
}

/** Never open programs from untrusted text, and never create a transaction from the guide. */
export function judgeStepProgram(index: number): 'paint' | 'xray' | 'monad-hw' | undefined {
  const step = JUDGE_STEPS[index]
  return step?.program
}
