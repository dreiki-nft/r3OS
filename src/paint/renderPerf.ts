/** Active-tab propagation excludes browser suspension/resume time from the websocket → canvas metric. */
export function shouldRecordRemoteRender(
  observedAt: number,
  lastVisibilityChangeAt: number,
  documentHidden: boolean,
) {
  return !documentHidden && lastVisibilityChangeAt <= observedAt
}
