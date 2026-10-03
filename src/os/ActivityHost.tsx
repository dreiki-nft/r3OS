import { useEffect, useRef, useSyncExternalStore } from 'react'
import { getActivityMoment, subscribeActivityMoment } from './activity'
import { setAssistantTip } from './assistantStore'

/**
 * The assistant's reactions to OS activity. The activity store (src/os/activity.ts) decides when something
 * happened and shows the You've Got Paint balloon; this only adds the assistant's short line and hop.
 */
export function ActivityHost() {
  const moment = useSyncExternalStore(subscribeActivityMoment, getActivityMoment)
  const seen = useRef(0)

  useEffect(() => {
    if (!moment || moment.id === seen.current) return
    seen.current = moment.id
    if (moment.kind === 'myPaintConfirmed') {
      // Paint already sets its own tip after a paint; the assistant just hops.
      window.dispatchEvent(new Event('r3os:assistant-hop'))
      return
    }
    setAssistantTip("someone's painting", 5_000)
  }, [moment])

  return null
}
