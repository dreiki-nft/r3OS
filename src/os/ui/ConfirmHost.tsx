import { useSyncExternalStore } from 'react'
import { answerConfirm, getConfirm, subscribeConfirm } from '../confirm'
import { MessageBox } from './MessageBox'

/** Renders the head of the `osConfirm` queue as an r3tardOS message box. Mounted once by the shell. */
export function ConfirmHost() {
  const request = useSyncExternalStore(subscribeConfirm, getConfirm)
  if (!request) return null
  return (
    <MessageBox
      key={request.id}
      kind={request.kind}
      title={request.title}
      message={request.message}
      details={request.details}
      defaultLabel={request.okLabel}
      cancelLabel={request.cancelLabel}
      onDefault={() => answerConfirm(request.id, true)}
      onCancel={() => answerConfirm(request.id, false)}
      onClose={() => answerConfirm(request.id, false)}
    />
  )
}
