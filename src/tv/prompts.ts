/**
 * Paint-party prompts for the broadcast view. Static on purpose: nothing typed into a URL or a chat ever
 * appears on the big screen. The host steps through them with ← / → (they also rotate every 5 minutes).
 */
export const PARTY_PROMPTS: readonly { title: string; hint: string }[] = [
  { title: 'give the face a hat', hint: 'any hat. the worse the better.' },
  { title: 'sign your corner', hint: 'a tag, an initial, a tiny logo. claim a spot.' },
  { title: 'everyone adds one star', hint: 'one star each. count them at the end.' },
  { title: 'gm, somewhere', hint: 'write gm anywhere on the canvas. small counts.' },
  { title: 'paint the sky purple', hint: 'top of the canvas. go wide, not careful.' },
  { title: 'fix the last thing you saw', hint: 'find the newest flash on screen and improve it.' },
  { title: 'draw the bag you never sold', hint: 'chart, coin, jpeg. no names needed.' },
  { title: 'one colour only', hint: 'pick a colour together. nothing else for 5 minutes.' },
  { title: 'tiny house in your region', hint: 'the canvas is 16 regions. build a home in one.' },
  { title: 'make the face cry', hint: 'tears, rain, a leak. then make it laugh next round.' },
  { title: 'connect two drawings', hint: 'draw a road, a cable or a hand between two things.' },
  { title: 'draw what Monad feels like', hint: 'fast? purple? loud? no wrong answers.' },
  { title: 'border patrol', hint: 'everyone works on the edges of the canvas.' },
  { title: 'hide something', hint: 'a tiny thing only you know is there. show the room later.' },
  { title: 'portrait of the person next to you', hint: '16 colours. no likeness required.' },
  { title: 'free paint', hint: 'no rules this round. just keep the flashes coming.' },
]
