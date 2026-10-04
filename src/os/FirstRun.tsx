import { useEffect, useState, useSyncExternalStore } from 'react'
import { isBooting, subscribeBooting } from './bootState'
import {
  FIRST_RUN_CHOICES,
  rememberFirstRun,
  setFirstRunOpen,
  shouldShowFirstRun,
  type FirstRunChoice,
} from './firstRunState'
import { helpHash } from './helpTopics'
import { openProgram } from './programs'
import { playSound } from './sound'
import { Icon } from './ui/Icon'

function storage() {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** First visit only: what r3OS is in one line, and three ways in. No wallet, no steps. */
export function FirstRun() {
  const [show, setShow] = useState(() =>
    shouldShowFirstRun(storage(), typeof location === 'undefined' ? '' : location.hash),
  )
  const [dontShow, setDontShow] = useState(true)
  const booting = useSyncExternalStore(subscribeBooting, isBooting)

  const close = (choice?: FirstRunChoice) => {
    rememberFirstRun(storage(), dontShow)
    setShow(false)
    playSound('select')
    if (choice === 'help') openProgram('help', true, helpHash('getting-started'))
    else if (choice) openProgram(choice)
  }

  useEffect(() => {
    setFirstRunOpen(show)
    return () => setFirstRunOpen(false)
  }, [show])

  useEffect(() => {
    if (!show) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBooting()) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!show || booting) return null

  return (
    <div className="first-run-shade">
      <section className="first-run window" role="dialog" aria-modal="true" aria-labelledby="first-run-title">
        <header className="titlebar">
          <Icon name="computer" size={20} />
          <strong id="first-run-title">Welcome</strong>
          <span className="titlebar-spacer" />
          <button aria-label="Close welcome" onClick={() => close()}>
            ×
          </button>
        </header>
        <div className="first-run-body">
          <h2>Welcome to r3OS 98</h2>
          <p>One shared computer on Monad. Watch it live first; connect only when you want to write onchain.</p>
          <div className="first-run-choices">
            {FIRST_RUN_CHOICES.map((choice, index) => (
              <button
                key={choice.id}
                className={`r3-button raised ${index === 0 ? 'primary' : ''}`}
                autoFocus={index === 0}
                onClick={() => close(choice.id)}
              >
                <Icon
                  name={choice.id === 'paint' ? 'paint' : choice.id === 'help' ? 'help' : 'lightning'}
                  size={24}
                  colour={choice.id === 'monad-hw' ? '#5FEDDF' : undefined}
                />
                <span>
                  <b>{choice.label}</b>
                  <small>{choice.hint}</small>
                </span>
              </button>
            ))}
          </div>
          <label className="first-run-check">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(event) => setDontShow(event.target.checked)}
            />
            Don’t show this again
          </label>
        </div>
      </section>
    </div>
  )
}
