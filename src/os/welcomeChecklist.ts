/** First-visit checklist model. Pure: the component reads the chain and passes the facts in. */

/** Help › getting started dispatches this to reopen a closed checklist. */
export const SHOW_WELCOME_EVENT = 'r3os-show-welcome'
export type WelcomeStepId = 'connect' | 'paint' | 'frame' | 'pass'

export interface WelcomeFacts {
  connected: boolean
  paintCount?: bigint
  framesMinted?: bigint
  hasPass?: boolean
}

export interface WelcomeStep {
  id: WelcomeStepId
  label: string
  hint: string
  done: boolean
}

export function welcomeSteps(facts: WelcomeFacts): WelcomeStep[] {
  return [
    {
      id: 'connect',
      label: 'connect a wallet',
      hint: 'you need a little MON for gas.',
      done: facts.connected,
    },
    {
      id: 'paint',
      label: 'paint some pixels',
      hint: 'open Paint, pick a colour, draw, press Paint.',
      done: facts.connected && (facts.paintCount ?? 0n) > 0n,
    },
    {
      id: 'frame',
      label: 'save your first frame',
      hint: 'in Paint: File › Save frame…',
      done: facts.connected && (facts.framesMinted ?? 0n) > 0n,
    },
    {
      id: 'pass',
      label: 'claim your Pass',
      hint: 'free, one per wallet. it collects stamps.',
      done: facts.connected && Boolean(facts.hasPass),
    },
  ]
}

/** The first step that is not done yet; undefined when everything is done. */
export const nextWelcomeStep = (steps: readonly WelcomeStep[]) => steps.find((step) => !step.done)
