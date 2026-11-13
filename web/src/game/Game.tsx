"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { CasinoLayout } from "./Hud";
import { MobileLayout } from "./MobileLayout";
import { useRoundMusic } from "./music";
import { sfx } from "./sfx";
import { useGame, type GameState } from "./store";
import { restoreWallet } from "./wallet";

const Scene = dynamic(() => import("./Scene"), { ssr: false });

function guestId() {
  try {
    let id = localStorage.getItem("nearreserve:guest");
    if (!id) {
      id = `guest-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem("nearreserve:guest", id);
    }
    return id;
  } catch {
    return `guest-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** Plays sound cues for things that just happened. */
function useCues(data: GameState | null) {
  const seen = useRef<{ round?: number; lines: number; clues: number; revealed: boolean }>({ lines: 0, clues: 0, revealed: false });
  useEffect(() => {
    const r = data?.round;
    if (!r) return;
    const s = seen.current;
    const clues = r.clues.filter((c) => c.text).length;
    if (s.round !== r.id) {
      seen.current = { round: r.id, lines: r.lines.length, clues, revealed: Boolean(r.result) };
      return;
    }
    if (!r.result && clues > s.clues) sfx("clue");
    s.clues = clues;
    const fresh = r.lines.slice(s.lines);
    if (!r.result && fresh.length) sfx(fresh.some((l) => l.approved) ? "approve" : "blip");
    s.lines = r.lines.length;
    if (r.result && !s.revealed) {
      s.revealed = true;
      const delay = Math.max(0, r.revealAt + 1500 - Date.now());
      setTimeout(() => sfx("reveal"), delay);
      if (r.result.requests.some((q) => q.status === "RejectedImpostor")) setTimeout(() => sfx("reject"), delay + 1200);
      if (Number(r.result.clientPaid) > 0) setTimeout(() => sfx("coins"), delay + 3000);
    }
  }, [data]);
}

const DESKTOP = "(min-width: 1024px)";
const subscribeDesktop = (cb: () => void) => {
  const m = window.matchMedia(DESKTOP);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
/** Phones and tablets get the app-shell layout; the server renders that one first (mobile first). */
function useDesktop() {
  return useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP).matches, () => false);
}

export default function Game() {
  const desktop = useDesktop();
  const data = useGame((s) => s.data);
  const setData = useGame((s) => s.setData);
  const setAccount = useGame((s) => s.setAccount);
  useCues(data);
  useRoundMusic();

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/game", { cache: "no-store" });
        if (res.ok && alive) setData(await res.json());
      } catch {
        // transient; next poll retries
      }
    };
    void load();
    const t = setInterval(load, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [setData]);

  // Practice mode gets a guest identity; on-chain mode restores a connected wallet.
  // A connected wallet is the player's profile in both modes; practice mode falls back to a guest.
  const mode = data?.mode;
  const account = useGame((s) => s.account);
  useEffect(() => {
    if (!mode) return;
    void restoreWallet(mode === "mainnet" ? "mainnet" : "testnet").then((a) => {
      if (a) setAccount(a, "wallet");
      else if (mode === "practice") setAccount(guestId(), "practice");
    });
  }, [mode, setAccount]);
  useEffect(() => {
    if (mode === "practice" && !account) setAccount(guestId(), "practice");
  }, [mode, account, setAccount]);

  return desktop ? <CasinoLayout scene={<Scene />} /> : <MobileLayout scene={<Scene />} />;
}
