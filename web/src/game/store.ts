"use client";

import { create } from "zustand";
import type { PublicState } from "@/lib/game/engine";

export type GameState = PublicState;
export type Round = NonNullable<PublicState["round"]>;
export type Line = Round["lines"][number];

type Store = {
  data: GameState | null;
  /** serverNow - Date.now(), so every viewer sees the same moment of the round. */
  offset: number;
  account: string | null;
  walletKind: "practice" | "wallet" | null;
  selected: number | null;
  muted: boolean;
  setData: (d: GameState) => void;
  setAccount: (a: string | null, kind: Store["walletKind"]) => void;
  select: (slot: number | null) => void;
  toggleMute: () => void;
};

export const useGame = create<Store>((set) => ({
  data: null,
  offset: 0,
  account: null,
  walletKind: null,
  selected: null,
  muted: false,
  setData: (d) => set({ data: d, offset: d.serverNow - Date.now() }),
  setAccount: (account, walletKind) => set({ account, walletKind }),
  select: (selected) => set({ selected }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
}));

export const serverNow = () => Date.now() + useGame.getState().offset;

/** Seconds since the current round went live. */
export const elapsedOf = (round: Round | null | undefined) => (round ? (serverNow() - round.startedAt) / 1000 : 0);

/** How long a line needs on screen; the same rule the server schedules with. */
export { readSeconds as lineDuration } from "@/lib/game/pacing";

export const LOOKS: Record<string, { label: string; color: string }> = {
  suit: { label: "Navy suit, briefcase", color: "#2b3a67" },
  mask: { label: "Ski mask, hoodie", color: "#22252b" },
  spy: { label: "Trench coat, fedora", color: "#c9a46a" },
  tourist: { label: "Floral shirt, camera", color: "#e8634a" },
};
