/**
 * Round pacing, shared by the server (scheduling lines) and the client (showing bubbles),
 * so both always agree on how long a line takes to read.
 */

/** Seconds a round is live: dialogue plus betting. Sent on-chain as betting_secs. */
export const LIVE_SECS = 120;
/** Target length of the dialogue (three exchanges per suspect); betting closes shortly after. */
export const DIALOGUE_SECS = 150;
/** Reveal on screen before the next round starts. */
export const REVEAL_SECS = 16;
/** Time to decide after the last suspect's final line, before betting closes. */
export const DECIDE_SECS = 10;
/** The "bets close in" countdown shows for this many seconds. */
export const COUNTDOWN_SECS = 10;

/** Comfortable reading time for a line: about 3 words per second plus a beat to notice it. */
export const readSeconds = (text: string) => Math.min(15, Math.max(2.5, 1.5 + text.split(/\s+/).filter(Boolean).length * 0.3));

/**
 * Trims an over-long line back to its last complete sentence within `max` words.
 * Never cuts mid-sentence: if there's no sentence break to cut at, the line is kept whole.
 */
export function capWords(text: string, max = 32) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= max) return text;
  const head = words.slice(0, max).join(" ");
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  return end > head.length * 0.4 ? head.slice(0, end + 1) : text;
}
