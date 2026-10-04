# Live Mode demo

Live Mode is the hero path for the Metropolis demo. The point is not that r3tardOS can submit a transaction. The point is that a fully onchain shared canvas on Monad can feel continuous enough for two people to draw together.

## What to show

Use two independent browser profiles or two devices, with different wallets, both on the same Paint canvas.

1. **Browser A:** open Paint while disconnected. The canvas and recent painters are already visible.
2. Press **Start Live Mode**. Choose the wallet once if needed. The quick path then:
   - asks for the EIP-712 session signature;
   - funds the browser-held burner once if it needs MON, never above the 1 MON app cap;
   - waits for the funded state to settle across the action RPC pool;
   - lets the burner register the session without another wallet prompt.
3. Point out the global taskbar **LIVE** indicator and the Paint hero strip. They show session time, units and burner balance. The strip says **no Undo** before and during Live Mode.
4. Draw a short stroke in Browser A. No wallet popup should appear for the stroke.
5. The hero strip shows Browser A's block/receipt proof. Open **X-ray** or the explorer link if needed.
6. **Browser B:** keep Paint visible. Browser A's live stroke should appear from the contract event stream and flash cyan on the canvas. The hero strip labels it **REMOTE** with wallet, pixel count, block and transaction link.
7. Draw from Browser B. Browser A should now show the reciprocal remote stroke.
8. Open **DXDIAG.EXE → Performance** on either browser. The useful proof rows are:
   - `burner-sign`;
   - `burner-broadcast`;
   - `paint-preflight`;
   - `tx-receipt` / `tx-total`;
   - `ui-settle`;
   - `remote-paint · websocket event → canvas store` and `remote-paint · websocket event → rendered canvas` on the observing browser.

## What each proof means

- **burner-sign** is local signing time. It should normally be around a millisecond because no wallet extension is involved per stroke.
- **burner-broadcast** is the browser handing one signed raw transaction to the action RPC pool. Redundant broadcast uses the same serialized transaction/hash; it is not multiple blockchain transactions.
- **tx-receipt** is how long this browser waited after RPC acceptance until it held a receipt.
- **ui-settle** is how long r3tardOS took to apply its own receipt logs to the canvas after this browser observed inclusion.
- **remote-paint** reports websocket-event → shared-store apply and websocket-event → the actual canvas draw effect completing. Both begin when this browser receives the live WebSocket event. On Monad, standard `logs` subscriptions fire at the proposed/speculative stage, so these rows measure local observing-browser propagation only; canonical reconciliation follows and neither row is labelled chain finality or end-to-end network latency.
- **X-ray commit states** come from one shared `monadLogs` feed started during boot when the RPC exposes it, so X-ray can be opened after the stroke without inventing missing states. A normal transaction receipt is shown separately and is never silently relabelled as `Finalized`.

## Recording choreography

For the cleanest recording, arrange Browser A and Browser B side by side with Paint already open and zoomed to the same area. Start Live Mode before the main take so the recording can focus on interaction rather than wallet chrome.

Recommended sequence:

1. show the active **LIVE** strip and taskbar indicator on A;
2. paint `A` or a small shape on A;
3. let the cyan remote outline land on B;
4. paint `B` or a second shape on B;
5. let it land on A;
6. click A's **X-ray** proof and show the transaction hash / explorer link;
7. open DXDIAG Performance and show the local-sign, broadcast, receipt, UI-settle and remote-paint rows;
8. return to the two canvases for the final shot.

Keep claims literal. Receipt timing is receipt timing, not finality. Standard live log subscriptions may be speculative. Monad commitment timing is shown only when the RPC actually supplies `Proposed`, `Voted` or `Finalized` notifications.

## Failure fallback

If a websocket provider drops during the demo, the canvas store falls back to bounded polling/catch-up and canonical reconciliation. That is a resilience path, not the preferred hero path. If the Paint status does not say `websocket live`, fix the connection before recording the hero take.
