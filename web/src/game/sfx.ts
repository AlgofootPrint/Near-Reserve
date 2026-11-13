"use client";

import { useGame } from "./store";

let ctx: AudioContext | null = null;

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.08) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ctx.currentTime + start);
  g.gain.setValueAtTime(0, ctx.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.05);
}

/** Synthesized cues, so the game ships without audio files. */
export function sfx(kind: "blip" | "approve" | "reject" | "coins" | "reveal" | "bet" | "tick" | "clue") {
  if (useGame.getState().muted || typeof window === "undefined") return;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  switch (kind) {
    case "blip":
      tone(660, 0, 0.06, "triangle", 0.03);
      break;
    case "approve":
      tone(523, 0, 0.12, "triangle");
      tone(784, 0.1, 0.18, "triangle");
      break;
    case "reject":
      tone(180, 0, 0.25, "square", 0.05);
      tone(140, 0.2, 0.35, "square", 0.05);
      break;
    case "coins":
      [0, 0.06, 0.12, 0.2, 0.28].forEach((t, i) => tone(1200 + i * 180, t, 0.09, "triangle", 0.05));
      break;
    case "reveal":
      [392, 494, 587, 784].forEach((f, i) => tone(f, i * 0.12, 0.3, "sawtooth", 0.035));
      break;
    case "tick":
      tone(1500, 0, 0.05, "square", 0.025);
      break;
    case "clue":
      // A soft "ding" with a shimmer: the bulb lighting up.
      tone(1047, 0, 0.35, "sine", 0.06);
      tone(1568, 0.08, 0.45, "sine", 0.04);
      tone(2093, 0.16, 0.5, "sine", 0.025);
      break;
    case "bet":
      tone(880, 0, 0.08, "triangle", 0.05);
      tone(1320, 0.07, 0.1, "triangle", 0.05);
      break;
  }
}
