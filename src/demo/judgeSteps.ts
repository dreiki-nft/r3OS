/**
 * The judge path: a presentation-only route through existing programs, people first, chain proof second.
 * This is deliberately NOT an automation of any onchain action or a source of telemetry.
 */
export const JUDGE_STEPS = [
  {
    title: 'One canvas, everyone',
    question: 'What is r3OS?',
    detail:
      'An onchain operating system where a whole community paints one 256 × 256 canvas together on Monad. Every stroke is a transaction. There is no app-owned backend: the browser reads the canvas, the art and the activity straight from the contracts.',
    cue: 'You can watch without a wallet. Writing needs a wallet or a Live Mode session.',
    program: 'paint',
    action: 'See live canvas',
  },
  {
    title: "Who's here",
    question: 'Is anyone else painting?',
    detail:
      'Open Paint. The side panel shows how many wallets painted recently and the latest strokes; click one to jump to it. When someone else commits, their stroke flashes on your canvas as it lands.',
    cue: 'Everything in that panel comes from real Painted events. Nothing is simulated.',
    program: 'paint',
    action: 'Open Paint',
  },
  {
    title: 'Paint together',
    question: 'What does it feel like with two people?',
    detail:
      'Open the observer link in a separate browser profile (no wallet needed). Draw a short stroke here and commit it. The observer sees it appear within about a second; if the observer is in another program, a "You\'ve got paint" note says where.',
    cue: 'Fast blocks are what make this feel like a shared room instead of turn-based.',
    program: 'paint',
    action: 'Focus Paint',
  },
  {
    title: 'Keep a piece of it',
    question: 'What do painters take home?',
    detail:
      'Save the canvas as a frame NFT, then in My Frames press Burn CD: up to 12 frames become one mix CD. The CD-ROM drive plays it back track by track, straight from contract data.',
    cue: 'Frames and CDs are fully onchain; burning a CD never touches the source frames.',
    program: 'cdrom',
    action: 'Open CD-ROM',
  },
  {
    title: 'Live on Monad',
    question: 'What did the chain actually do?',
    detail:
      'Open Monad X-ray after a paint. It shows the real transaction and the Proposed, Voted and Finalized stages Monad reported, separately from receipt inclusion.',
    cue: 'Only an observed Finalized stage proves finalization. Missing stages stay missing.',
    program: 'xray',
    action: 'Open X-ray',
  },
  {
    title: 'Made by a community',
    question: 'Who made this canvas?',
    detail:
      "Season Replay plays back every paint of the season from the contract's own events, so you can watch the canvas being made, painter by painter. Built by and for the r3tards community, with bonuses for Skrumpeys and Monad Card holders. No token, no points; each season ends in a candle auction and the community decides how the proceeds are spent.",
    cue: 'Attention turns into a shared artwork and its history, not into points.',
    program: 'replay',
    action: 'Open Season Replay',
  },
  {
    title: 'The idea underneath',
    question: 'Why build it this way?',
    detail:
      'r3OS puts the chain where apps normally put their servers, databases and realtime services. On Monad that is fast enough that the chain can sit inside the interaction loop. Explore Monad has the storage and block experiments behind that claim.',
    cue: 'The desktop is the interface; the community canvas is the point.',
    program: undefined,
    action: undefined,
  },
] as const

export type JudgeStepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6

export function moveJudgeStep(current: number, direction: -1 | 1): JudgeStepIndex {
  return Math.max(0, Math.min(JUDGE_STEPS.length - 1, current + direction)) as JudgeStepIndex
}

/** Never open programs from untrusted text, and never create a transaction from the guide. */
export function judgeStepProgram(index: number): 'paint' | 'cdrom' | 'xray' | 'replay' | undefined {
  const step = JUDGE_STEPS[index]
  return step?.program
}
