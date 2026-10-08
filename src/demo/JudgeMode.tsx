import { useState, useSyncExternalStore } from 'react'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { config } from '../chain/config'
import { getMonadTraceFeedSnapshot, subscribeMonadTraceFeed } from '../chain/monadLogs'
import { openProgram } from '../os/programs'
import { Button } from '../os/ui/Button'
import { closeWindow, focusWindow } from '../os/windows'
import { JUDGE_STEPS, judgeStepProgram, moveJudgeStep, type JudgeStepIndex } from './judgeSteps'
import './judgeGuide.css'

function observerUrl() {
  // A link is only a convenience; this does NOT create an independent browser session by itself.
  return `${location.origin}${location.pathname}#/paint`
}

export function JudgeMode() {
  const [step, setStep] = useState<JudgeStepIndex>(0)
  const [copyStatus, setCopyStatus] = useState('')
  const blockMode = useSyncExternalStore(subscribeBlocks, () => getBlockSnapshot().mode)
  const traceFeed = useSyncExternalStore(subscribeMonadTraceFeed, getMonadTraceFeedSnapshot)
  const current = JUDGE_STEPS[step]

  function openStage(index: number) {
    const program = judgeStepProgram(index)
    if (!program) return
    // Always use the existing program/window route. Never sign, quote, send or synthesize events.
    openProgram(program, false)
    // Desktop: keep the guide in front. Refocusing it on the next click would reorder the windows mid-click
    // and swallow that click, so judges had to press Next twice. Phones show one full-screen window at a
    // time, so there the opened program stays in front.
    if (!matchMedia('(max-width: 640px)').matches) focusWindow('demo')
  }

  function navigate(direction: -1 | 1) {
    const next = moveJudgeStep(step, direction)
    setStep(next)
    setCopyStatus('')
    openStage(next)
  }

  async function copyObserverLink() {
    try {
      await navigator.clipboard.writeText(observerUrl())
      setCopyStatus('Link copied. Paste into a separate browser profile.')
    } catch {
      setCopyStatus('Clipboard unavailable. Open this site with #/paint in a separate browser profile.')
    }
  }

  return (
    <div className="judge-mode">
      <div className="judge-heading">
        <span>r3OS / JUDGE PATH</span>
        <strong>{String(step + 1).padStart(2, '0')} / {String(JUDGE_STEPS.length).padStart(2, '0')}</strong>
      </div>
      <div className="judge-connection" aria-label="Actual local connection status">
        <span>CONFIGURED CHAIN: {config.chainId}</span>
        <span>BLOCK FEED: {blockMode}</span>
        <span>monadLogs: {traceFeed.mode}</span>
      </div>
      <h2>{current.title}</h2>
      <p className="judge-question">{current.question}</p>
      <p className="judge-detail">{current.detail}</p>
      <p className="judge-cue"><b>NOTICE</b> {current.cue}</p>
      {(step === 1 || step === 2) && (
        <div className="judge-observer">
          <Button onClick={() => void copyObserverLink()}>Copy observer URL</Button>
          <small>Separate browser PROFILE, not another tab in this profile.</small>
          {copyStatus && <small role="status">{copyStatus}</small>}
        </div>
      )}
      {current.action && (
        <Button primary onClick={() => openStage(step)}>{current.action}</Button>
      )}
      <div className="judge-footer">
        <Button disabled={step === 0} onClick={() => navigate(-1)}>◂ Back</Button>
        {step < JUDGE_STEPS.length - 1 ? (
          <Button primary onClick={() => navigate(1)}>Next ▸</Button>
        ) : (
          <Button primary onClick={() => closeWindow('demo')}>Finish</Button>
        )}
      </div>
      <small className="judge-legal">Guide only. No simulated metrics or automated transactions.</small>
    </div>
  )
}
