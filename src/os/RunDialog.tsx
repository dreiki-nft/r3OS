import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { openProgram } from './programs'
import { RUN_EXAMPLES, parseRunCommand } from './run'
import { playSound } from './sound'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { MessageBox } from './ui/MessageBox'
import { closeWindow } from './windows'

/** Win98 Run… dialog. Opens allowlisted r3OS destinations only, always through openProgram. */
export function RunDialog() {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  const close = () => closeWindow('run')

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    const parsed = parseRunCommand(value)
    if (!parsed.ok) {
      playSound('error')
      setError(parsed.error)
      return
    }
    close()
    // openProgram enforces the release schedule; an unreleased program shows "not installed yet".
    openProgram(parsed.target.program, true, parsed.target.hash)
  }

  const keyboard = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !error) {
      event.preventDefault()
      close()
    }
  }

  return (
    <>
      <form className="run-dialog" onSubmit={submit} onKeyDown={keyboard}>
        <div className="run-dialog-body">
          <Icon name="rocket" size={32} colour="#FEC343" />
          <p>
            Type the name of a program, folder, document, or r3OS resource, and it will open it for you.
          </p>
        </div>
        <label className="run-dialog-field">
          <span>
            <u>O</u>pen:
          </span>
          <input
            ref={input}
            value={value}
            maxLength={90}
            spellCheck={false}
            autoComplete="off"
            aria-label="Open"
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <small className="run-dialog-examples">{RUN_EXAMPLES}</small>
        <div className="dialog-actions">
          <Button primary type="submit">
            OK
          </Button>
          <Button type="button" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
      {error && (
        <MessageBox
          kind="error"
          title="Run"
          message={error}
          onClose={() => {
            setError('')
            input.current?.focus()
            input.current?.select()
          }}
        />
      )}
    </>
  )
}
