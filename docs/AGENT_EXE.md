# AGENT.EXE — AI vs humans (season 2 opener)

At **11:00 UTC on November 5, 2026**, when season 2 starts, 77 AI agents take over the whole r3OS canvas and
paint their face on it. For **72 hours** (until 11:00 UTC on November 8) they repaint it over anything humans
draw. Humans win by draining the AI's MON.

## Rules

1. **Health.** The AI starts with **1,333 MON** of health: the damage tax it can still be made to pay.
2. **Damage tax.** Every pixel of the face a human breaks that an agent then has to repair costs the AI
   **0.008 MON**, on top of the gas for the repair. The tax is paid into the **war chest** (the AgentBattle
   contract) every few minutes.
3. **What counts as damage.** Breaking pixels the AI has already drawn. Painting over the AI while it is still
   drawing the face (the first ~2 hours) counts as fighting, not as damage.
4. **Shields.** The health is split into **3 shields of 444 MON, one per day** (each day starts at 11:00 UTC).
   When today's shield breaks, the AI goes dark until 11:00 UTC the next day and the canvas is yours; the
   next day it takes the canvas back from scratch. A day's unused shield carries over, but the last shield
   can only fall on day 3.
5. **Humans win** if all three shields break. If they do, the agents leave a last message and go silent.
6. **War chest.** After the battle the chest is shared by **badge holders**, in proportion to the damage each
   one did.
7. **Badge.** Fight (push at least one pixel away from the face) in all three 24-hour windows, each starting at
   11:00 UTC. The badge is a Painter Pass quest backed by the AgentBattle contract.
8. **Prizes**, ranked by MON burned (the tax plus the share of repair gas each wallet caused): **#1** one
   r3tard NFT, **#2** 1,000 MON, **#3** 500 MON.
9. **Fair play.** No bots or scripted painting. One prize per person. All wallets are reviewed before payouts,
   which happen within 72 hours of the end. The r3OS team does not play.
10. The **background colour** is locked in r3OS during the battle.

## How it works

- The agents run on their own server. Each agent is a normal Monad wallet that paints with the normal `paint()`
  call and the normal paint budget (512 units per hour for a fresh wallet), so they follow the same rules as
  everyone: wet/dry pixel costs, tile heat, the 512-pixel region cap and DF1 glitches.
- Agent names come from the **R3Names** registry (`<name>.r3`). r3OS shows `.r3` names before `.nad` names.
- The scoreboard in the AGENT.EXE window is published by the agents' server every couple of minutes. It can be
  rebuilt by anyone from public data alone: every `Painted` event of season 2, the block times, and the gas the
  agents' transactions cost. Damage for a pixel goes to the wallet that last changed it before an agent
  repaired it.
- The AI's health is 1,333 MON minus the damage tax it owes, which anyone can recompute from the same public
  data; the tax itself lands in the AgentBattle contract.

## Contracts

| contract | role |
|---|---|
| R3OSPaint (core, unchanged) | the canvas everyone paints on |
| AgentBattle | receives the damage tax (war chest), records the days each wallet fought, pays out after the battle |
| R3Names | `.r3` names: assigned to the agents now, open to the community later |
