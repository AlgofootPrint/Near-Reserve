"use client";

import { useEffect, useRef } from "react";
import { COUNTDOWN_SECS } from "@/lib/game/pacing";
import { serverNow, useGame } from "./store";

const TRACK = "/audio/casino-chimes.mp3";
const VOLUME = 0.35;
const FADE_MS = 600;

/**
 * Round music: plays from the top when a round opens, fades out and pauses when the
 * "bets close in" countdown starts, and restarts from the beginning next round.
 * Browsers only allow audio after the visitor interacts with the page, so it starts on
 * their first click, tap or key press. Respects the mute button.
 */
export function useRoundMusic() {
  const audio = useRef<HTMLAudioElement | null>(null);
  // The browser remembers if the page was already interacted with (sticky activation). Checking it
  // means a remount (hot reload, layout switch) doesn't silence the music until the next click.
  const unlocked = useRef(typeof navigator !== "undefined" && Boolean(navigator.userActivation?.hasBeenActive));
  const roundId = useRef<number | null>(null);
  const fade = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const a = new Audio(TRACK);
    a.loop = true;
    a.preload = "auto";
    a.volume = VOLUME;
    audio.current = a;

    const unlock = () => {
      unlocked.current = true;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    const fadeTo = (target: number, then?: () => void) => {
      if (fade.current) clearInterval(fade.current);
      const step = (target - a.volume) / (FADE_MS / 50);
      fade.current = setInterval(() => {
        const next = a.volume + step;
        if ((step <= 0 && next <= target) || (step > 0 && next >= target) || step === 0) {
          a.volume = Math.max(0, Math.min(1, target));
          if (fade.current) clearInterval(fade.current);
          fade.current = null;
          then?.();
        } else {
          a.volume = Math.max(0, Math.min(1, next));
        }
      }, 50);
    };

    // Re-evaluated a few times a second so the pause lands right as the countdown starts.
    const t = setInterval(() => {
      const { data, muted } = useGame.getState();
      const r = data?.round;
      const left = r && !r.result ? (r.bettingClosesAt - serverNow()) / 1000 : 0;
      unlocked.current ||= Boolean(navigator.userActivation?.hasBeenActive);
      const shouldPlay = Boolean(r && !r.result && left > COUNTDOWN_SECS && !muted && unlocked.current);

      // A new round always starts the track from the top.
      if (r && r.id !== roundId.current) {
        roundId.current = r.id;
        if (!r.result) a.currentTime = 0;
      }

      if (shouldPlay && a.paused) {
        a.volume = 0;
        void a.play().then(() => fadeTo(VOLUME)).catch(() => {});
      } else if (!shouldPlay && !a.paused && !fade.current) {
        fadeTo(0, () => a.pause());
      }
    }, 250);

    return () => {
      clearInterval(t);
      if (fade.current) clearInterval(fade.current);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      a.pause();
      audio.current = null;
    };
  }, []);
}
