"use client";

import { useEffect, useRef, useState } from "react";
import { PAYOUT_MULTIPLIER } from "@/lib/game/odds";
import { COUNTDOWN_SECS, REVEAL_SECS } from "@/lib/game/pacing";
import { sfx } from "./sfx";
import { elapsedOf, LOOKS, serverNow, useGame, type GameState, type Round } from "./store";
import { betFromProfile, cashOut as cashOutProfile, connectWallet, disconnectWallet, fundProfile, hasSessionKey } from "./wallet";

export const CHIPS = [
  { amount: "0.1", color: "#2f9e6b" },
  { amount: "0.5", color: "#3b6fe0" },
  { amount: "1", color: "#d9363e" },
];

export type MyBet = { bet: { amounts: string[]; claimed: boolean; claimable: string } | null; balance: string | null };

/** The next round starts this long after settlement (shared with the server). */
const NEXT_ROUND_SECS = REVEAL_SECS;

export const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * Casino layout: the 3D game sits in a gold marquee frame; everything else lives in its own
 * panel around it, with the betting table along the bottom.
 */
export function CasinoLayout({ scene }: { scene: React.ReactNode }) {
  const data = useGame((s) => s.data);
  const account = useGame((s) => s.account);
  const [help, setHelp] = useState(false);
  useHudClock(data);
  const profile = useProfile(data, account);

  return (
    <main className="casino-bg font-sans flex min-h-dvh flex-col gap-3 p-3 sm:gap-4 sm:p-4 lg:h-dvh lg:min-h-0">
      <Header data={data} onHelp={() => setHelp(true)} />

      {/* Fixed rows on desktop: the game row takes all remaining height, the table row is its natural
          (fixed) height. Side panels scroll inside their column, so no content change can resize the game. */}
      {/* Phones/tablets: one column ordered round → game → bets → chips → log → history (the side
          columns use `contents`, so their panels are placed individually). Desktop: fixed 3-column
          grid where the game row takes the remaining height and side panels scroll inside. */}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[230px_minmax(0,1fr)_260px] lg:grid-rows-[minmax(0,1fr)_auto]">
        <section className="marquee order-2 min-h-0 min-w-0 lg:order-2" aria-label="Game">
          <div className="screen h-[56vh] max-h-[560px] min-h-[300px] lg:h-full lg:max-h-none">
            {scene}
            {/* Above the 3D name tags and speech bubbles. */}
            <div className="pointer-events-none absolute inset-0 z-40">{data ? <Stage data={data} my={profile.data} /> : <Splash title="Opening the bank" />}</div>
          </div>
        </section>

        <aside className="contents lg:order-1 lg:flex lg:min-h-0 lg:min-w-0 lg:flex-col lg:gap-4 lg:overflow-y-auto scroll-modern">
          <div className="order-1 min-w-0 lg:order-none">{data && <RoundCard data={data} />}</div>
          <div className="order-4 min-w-0 lg:order-none">{data && <Wallet data={data} profile={profile} />}</div>
        </aside>

        <aside className="contents lg:order-3 lg:flex lg:min-h-0 lg:min-w-0 lg:flex-col lg:gap-4 lg:overflow-hidden">
          <div className="order-5 flex min-h-0 min-w-0 flex-col lg:order-none lg:flex-1">{data && <LogPanel data={data} />}</div>
          <div className="order-6 min-w-0 lg:order-none">{data && <HistoryPanel data={data} />}</div>
        </aside>

        {data && (
          <section className="order-3 min-w-0 lg:order-4 lg:col-span-3" aria-label="Betting table">
            <BetBoard data={data} profile={profile} />
          </section>
        )}
      </div>

      {help && data && <Help data={data} onClose={() => setHelp(false)} />}
    </main>
  );
}

/** Re-renders twice a second (timers) and ticks during the "bets close in" countdown. */
export function useHudClock(data: GameState | null) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const left = secsToClose(data?.round);
  useEffect(() => {
    if (left > 0 && left <= COUNTDOWN_SECS) sfx("tick");
  }, [left]);
}

// ------------------------------------------------------------------ top

export function TimerRing({ round }: { round: Round | null }) {
  const now = serverNow();
  const total = round ? round.bettingClosesAt - round.startedAt : 1;
  const left = round && !round.result ? Math.max(0, round.bettingClosesAt - now) : 0;
  const k = left / total;
  const secs = Math.ceil(left / 1000);
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid size-[52px] place-items-center">
      <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="5" />
        <circle cx="24" cy="24" r={r} fill="none" stroke={secs <= 10 ? "#ff5a4d" : "#ffd23f"} strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - k)} />
      </svg>
      <span className="font-game text-[17px] tabular-nums">{left > 0 ? secs : round?.result ? "✓" : "…"}</span>
    </div>
  );
}

export function IconButton({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={`${WHITE_CARD} btn-3d grid size-11 place-items-center hover:brightness-110`}>
      {children}
    </button>
  );
}

function Header({ data, onHelp }: { data: GameState | null; onHelp: () => void }) {
  const muted = useGame((s) => s.muted);
  const toggleMute = useGame((s) => s.toggleMute);

  return (
    // Phones: logo + buttons on the first row, the scoreboard full-width on a second row.
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
        <span className="font-game grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#f6d77a] to-[#b8861f] text-[20px] text-[#3a2600] shadow-[0_3px_0_#5a3d00] sm:size-11 sm:text-[22px]">
          N
        </span>
        <div className="min-w-0 leading-none">
          <p className="font-game truncate text-[20px] tracking-wide text-[#f6d77a] sm:text-[26px]">NEAR RESERVE</p>
          <p className="mt-1 truncate text-[9.5px] font-bold tracking-[0.15em] text-white/50 sm:text-[10.5px] sm:tracking-[0.25em]">
            GUESS THE CLIENT · {data?.mode === "practice" ? "PRACTICE" : (data?.mode ?? "").toUpperCase()}
          </p>
        </div>
      </div>

      {/* The free space in the middle of the header, right above the game: the clue bulb. */}
      <div className="flex min-w-0 flex-1 justify-center">{data?.round && <ClueBulb round={data.round} />}</div>

      <div className="contents sm:flex sm:items-center sm:gap-2">
        {data && (
          <div className={`${WHITE_CARD} order-last flex w-full items-center justify-around gap-4 px-4 py-2 sm:order-none sm:w-auto sm:justify-start`}>
            <div className="text-center leading-none">
              <p className="font-game text-[22px] text-[#8a5f12] tabular-nums">{data.stats.fooled}</p>
              <p className="mt-1 text-[10px] font-bold tracking-widest text-black/60">AI FOOLED</p>
            </div>
            <div className="h-8 w-px bg-black/15" />
            <div className="text-center leading-none">
              <p className="font-game text-[22px] text-[#15803d]">0</p>
              <p className="mt-1 text-[10px] font-bold tracking-widest text-black/60">STOLEN</p>
            </div>
            <div className="h-8 w-px bg-black/15" />
            <div className="text-center leading-none">
              <p className="font-game text-[22px] tabular-nums">{data.stats.rounds}</p>
              <p className="mt-1 text-[10px] font-bold tracking-widest text-black/60">ROUNDS</p>
            </div>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-2">
        <IconButton onClick={toggleMute} label={muted ? "Unmute" : "Mute"}>
          {muted ? (
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor"><path d="M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor"><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M16 8a5 5 0 0 1 0 8M18.5 5.5a8.5 8.5 0 0 1 0 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          )}
        </IconButton>
        <IconButton onClick={onHelp} label="How to play">
          <span className="font-game text-[20px]">?</span>
        </IconButton>
        </div>
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ clue bulb

function BulbIcon({ lit, fresh, size = "size-10", light = false }: { lit: boolean; fresh: boolean; size?: string; light?: boolean }) {
  const off = light ? "rgba(29,29,31,0.35)" : "rgba(255,255,255,0.45)";
  const on = light ? "#d49a0c" : "#ffd23f";
  return (
    <span className={`relative grid ${size} shrink-0 place-items-center rounded-full ${lit ? "bg-[#ffd23f]/20" : light ? "bg-black/5" : "bg-white/5"} ${fresh ? "bulb-glow" : ""}`}>
      <svg viewBox="0 0 24 24" className="size-[60%]" aria-hidden>
        <path
          d="M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.6.5.9 1.1.9 1.8v.4h5.8v-.4c0-.7.3-1.3.9-1.8A6.5 6.5 0 0 0 12 2.5z"
          fill={lit ? "#ffd23f" : "none"}
          stroke={lit ? on : off}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M9.5 19h5M10.5 21.5h3" stroke={lit ? on : off} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** The clue card: white, with a gold edge, so it stands apart from the dark game panels. */
export const WHITE_CARD = "rounded-2xl border-2 border-[#ffd23f] bg-white text-[#1d1d1f] shadow-[0_6px_0_rgba(10,8,30,0.4),0_14px_30px_rgba(10,8,30,0.35)]";

/** Clues released so far, the next one's countdown, and whether one just dropped. */
function useClues(round: Round) {
  const clues = round.clues ?? [];
  const elapsed = (serverNow() - round.startedAt) / 1000;
  const shown = clues.filter((c): c is { t: number; text: string } => Boolean(c.text));
  const next = round.result ? undefined : clues.find((c) => !c.text);
  const nextIn = next ? Math.max(0, Math.ceil(next.t - elapsed)) : 0;
  const latest = shown[shown.length - 1];
  const fresh = Boolean(latest && !round.result && elapsed - latest.t < 8);
  return { clues, shown, next, nextIn, fresh };
}

function ClueList({ round }: { round: Round }) {
  const { clues, shown, next, nextIn } = useClues(round);
  const lit = shown.length > 0;
  const status = next ? (lit ? `Next clue in ${nextIn}s` : `First clue in ${nextIn}s`) : round.result ? "Round over" : "All clues out";
  return (
    <div className="min-w-0 leading-tight">
      <p className="text-[10px] font-bold tracking-[0.18em] text-[#b7791f] uppercase">
        Clue {shown.length}/{clues.length} <span className="text-black/40">· {status}</span>
      </p>
      {lit ? (
        shown.map((c, i) => (
          <p key={i} className={`reveal-pop mt-0.5 text-[13px] font-semibold ${i === shown.length - 1 ? "text-[#1d1d1f]" : "text-black/45"}`}>
            {c.text}
          </p>
        ))
      ) : (
        <p className="mt-0.5 text-[13px] text-black/55">Listen closely: a clue is on its way.</p>
      )}
    </div>
  );
}

/**
 * The clue bulb: two true hints per round, released while the suspects talk. The first is a fact
 * from the account file (check it against what they said); the second is about the real client
 * or about whether Vera's ✓ can be trusted.
 */
export function ClueBulb({ round }: { round: Round }) {
  const { clues, shown, fresh } = useClues(round);
  if (!clues.length) return null;
  return (
    <div className={`${WHITE_CARD} flex max-w-[600px] min-w-0 items-center gap-3 px-3 py-2`} aria-live="polite">
      <BulbIcon lit={shown.length > 0} fresh={fresh} light />
      <ClueList round={round} />
    </div>
  );
}

/**
 * Phones: whether the clues are showing in place of the question. They show by themselves for a few
 * seconds when a clue drops (unless the player already closed that clue), and on tap.
 */
export function useClueToggle(round: Round | null | undefined) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(0);
  const [roundId, setRoundId] = useState(round?.id);
  if (round?.id !== roundId) {
    setRoundId(round?.id);
    setOpen(false);
    setDismissed(0);
  }
  const shownCount = round ? (round.clues ?? []).filter((c) => c.text).length : 0;
  const elapsed = round ? (serverNow() - round.startedAt) / 1000 : 0;
  const latest = round ? (round.clues ?? []).filter((c) => c.text).at(-1) : undefined;
  const fresh = Boolean(round && latest && !round.result && elapsed - latest.t < 8);
  const has = Boolean(round?.clues?.length);
  const showing = has && (open || (fresh && dismissed < shownCount));
  const toggle = () => {
    if (showing) {
      setOpen(false);
      setDismissed(shownCount);
    } else setOpen(true);
  };
  return { has, showing, toggle };
}

/** Phones: the bulb button that swaps the question for the clues. */
export function ClueButton({ round, showing, onClick }: { round: Round; showing: boolean; onClick: () => void }) {
  const { clues, shown, fresh } = useClues(round);
  if (!clues.length) return null;
  const lit = shown.length > 0;
  return (
    <button
      onClick={onClick}
      aria-expanded={showing}
      aria-label={showing ? "Hide clues" : `Show clues: ${shown.length} of ${clues.length}`}
      className={`relative ml-auto shrink-0 rounded-full ${showing ? "ring-2 ring-[#ffd23f]" : ""}`}
    >
      <BulbIcon lit={lit} fresh={fresh && !showing} size="size-10" />
      {lit && <span className="absolute -top-0.5 -right-0.5 grid size-[18px] place-items-center rounded-full bg-[#ffd23f] text-[10px] font-black text-[#3a2600]">{shown.length}</span>}
    </button>
  );
}

/** Phones: the clue card that takes the question's place in the round strip. */
export function ClueInline({ round }: { round: Round }) {
  return (
    <div className={`${WHITE_CARD} reveal-pop min-w-0 flex-1 !rounded-xl !border px-2.5 py-1 !shadow-none`} aria-live="polite">
      <ClueList round={round} />
    </div>
  );
}

/**
 * Look for the four side panels: dark frosted glass with a thin lime border and small corners.
 * Written as utility classes (not a globals.css class) so it always compiles with the component.
 */
export const GLASS =
  "rounded-[10px] border border-[#a3e635]/65 bg-gradient-to-b from-[#1c1c1c]/70 to-[#0c0c0c]/60 text-white backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_30px_rgba(0,0,0,0.35)]";

function RoundCard({ data }: { data: GameState }) {
  const r = data.round;
  const now = serverNow();
  const status = !r
    ? "Suspects arriving"
    : r.result
      ? "Reveal"
      : now < r.bettingClosesAt
        ? "Bets open"
        : "Bets closed · settling on-chain";
  return (
    <div className={`${GLASS} p-4`}>
      <div className="flex items-center gap-3">
        <TimerRing round={r} />
        <div className="leading-none">
          <p className="text-[13px] font-bold text-white/55">ROUND {r ? r.id + 1 : "—"}</p>
          <p className="mt-1 text-[11px] font-bold tracking-widest text-white/55 uppercase">{status}</p>
        </div>
      </div>
      <p className="mt-3 text-[22px] leading-tight font-extrabold tracking-tight">
        {r ? (
          <>
            Who&apos;s the real <span className="text-[#7ff5ff]">{r.holderName}</span>?
          </>
        ) : (
          "Get ready"
        )}
      </p>
      <p className="mt-1.5 text-[12.5px] leading-snug text-white/75">Four suspects claim the account. One is real. Vera, the AI teller, can be fooled. The vault can&apos;t.</p>
    </div>
  );
}

/** Who was real in recent rounds, with on-chain proof. */
export function HistoryPanel({ data, className = "h-[178px]" }: { data: GameState; className?: string }) {
  // Fixed height from the start (room for 5 rows), so the column never resizes as rounds finish.
  return (
    <div className={`${GLASS} ${className} shrink-0 overflow-hidden p-4`}>
      {!data.history.length && <p className="mt-2 text-[12.5px] text-white/50">Results appear here after each round.</p>}
      <p className="text-[16px] font-extrabold tracking-tight">
        Last rounds <span className="text-[11px] font-bold tracking-wide text-white/45">· who was real</span>
      </p>
      <ul className="mt-2 space-y-1.5">
        {data.history.slice(0, 5).map((h) => {
          const s = data.suspects[h.clientSlot];
          return (
            <li key={h.id} className="flex items-center gap-2 text-[12.5px]">
              <span className="w-9 font-bold text-white/45 tabular-nums">#{h.id + 1}</span>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: LOOKS[s.key].color === "#22252b" ? "#9aa0a6" : LOOKS[s.key].color }} />
              <span className="font-semibold">{s.name}</span>
              {h.fooled > 0 && <span className="rounded-full bg-[#ffb224]/20 px-1.5 text-[10.5px] font-bold whitespace-nowrap text-[#ffb224]">fooled ×{h.fooled}</span>}
              {h.settleUrl && (
                <a href={h.settleUrl} target="_blank" rel="noreferrer" className="ml-auto text-[11px] font-bold text-[#7ff5ff] underline">
                  tx
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ bet board

/** Seconds until betting closes this round (0 when closed or no round). */
export function secsToClose(r: Round | null | undefined) {
  if (!r || r.result) return 0;
  return Math.max(0, Math.ceil((r.bettingClosesAt - serverNow()) / 1000));
}

/**
 * The betting table. Pick a suspect (their card lights up), choose a stake, then PLACE BET.
 * Clicking a character in the 3D bank picks them too.
 */
function BetBoard({ data, profile }: { data: GameState; profile: Profile }) {
  const { data: my, bet: onBet, error, busy } = profile;
  const selected = useGame((s) => s.selected);
  const select = useGame((s) => s.select);
  // Any stake: a quick chip, MAX (the whole profile balance) or a typed amount.
  const [amount, setAmount] = useState(CHIPS[0].amount);
  const r = data.round;
  const left = secsToClose(r);
  const open = left > 0;
  const closing = open && left <= COUNTDOWN_SECS;
  const pools = r?.pools.map(Number) ?? [0, 0, 0, 0];
  const stake = Number(amount) || 0;
  const balance = Number(my?.balance ?? 0);
  const pick = selected !== null && selected !== undefined ? data.suspects[selected] : null;
  const setStake = (raw: string) => setAmount(raw.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").replace(/^(\d{0,5})(\.\d{0,4})?.*$/, "$1$2"));
  const placeBet = () => {
    if (!pick) return;
    onBet(pick.slot, stake >= 0.01 ? String(Math.floor(stake * 10_000) / 10_000) : "");
  };

  return (
    <div className="felt relative px-2.5 pt-1.5 pb-2 sm:px-3">
      <div className="mb-1 flex h-6 items-center justify-between gap-2 overflow-hidden px-1">
        <p className="font-game text-[12px] tracking-[0.2em] whitespace-nowrap text-[#f6d77a]/90">PLACE YOUR BETS</p>
        {error ? (
          <p className="rounded-full bg-black/40 px-3 py-0.5 text-[12px] font-bold text-[#ff8a80]">{error}</p>
        ) : closing ? (
          <p className="animate-pulse rounded-full bg-[#ff5a4d] px-3 py-0.5 text-[12px] font-black tracking-widest text-white tabular-nums">BETS CLOSE IN {left}s</p>
        ) : (
          <p className="truncate text-[10px] font-bold tracking-wider text-white/55 sm:text-[11px] sm:tracking-widest">
            {open ? (pick ? `YOUR PICK: ${pick.name.toUpperCase()}` : "TAP A SUSPECT TO PICK") : r?.result ? "ROUND SETTLED" : "BETS CLOSED"}
          </p>
        )}
      </div>
      {/* Phones: 2×2 cards. Tablets: 4 cards in a row. Both with the stake rack full-width below.
          Desktop: cards and rack side by side. */}
      <div className="flex w-full flex-col gap-2 lg:flex-row lg:items-stretch">
        <div className="scroll-modern grid grid-cols-2 gap-2 px-0.5 pt-1.5 pb-1 sm:grid-cols-4 lg:flex lg:min-w-0 lg:flex-1 lg:overflow-x-auto">
          {data.suspects.map(({ slot, key, name }) => {
            const lines = r?.lines.filter((l) => l.slot === slot) ?? [];
            const approved = lines.some((l) => l.approved);
            const sus = Math.max(0, ...lines.filter((l) => l.speaker === "suspect").map((l) => l.risk ?? 0));
            const odds = PAYOUT_MULTIPLIER;
            const mine = Number(my?.bet?.amounts[slot] ?? 0);
            const res = r?.result;
            const isClient = res?.clientSlot === slot;
            const talking = r && !res && lines.length > 0 && r.lines[r.lines.length - 1]?.slot === slot;
            const picked = selected === slot;

            return (
              <button
                key={slot}
                type="button"
                onClick={() => select(picked ? null : slot)}
                aria-pressed={picked}
                aria-label={`Pick ${name}`}
                className={`${WHITE_CARD} relative min-w-0 flex-1 overflow-hidden rounded-2xl px-2.5 py-2 text-left transition lg:min-w-[140px] ${
                  picked ? "-translate-y-1 !border-[#86efac] !bg-[#dcfce7] !shadow-[0_0_0_3px_#86efac,0_0_28px_rgba(134,239,172,0.6)]" : "hover:brightness-110"
                }`}
              >
                {picked && !res && (
                  <span className="font-game absolute top-1.5 right-1.5 rounded-full bg-[#86efac] px-2 py-0.5 text-[10px] tracking-wider text-[#14532d]">
                    <span className="hidden sm:inline">YOUR </span>PICK
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <span className="relative grid size-8 shrink-0 place-items-center rounded-full ring-2 ring-white/70" style={{ background: LOOKS[key].color }}>
                    <span className="font-game text-[16px] text-white">{name[0]}</span>
                    {talking && <span className="absolute -top-0.5 -right-0.5 size-3 animate-ping rounded-full bg-[#7ff5ff]" />}
                  </span>
                  <div className="min-w-0 leading-none">
                    <p className="font-game truncate text-[15px]">{name}</p>
                    <SusMeter value={sus} />
                  </div>
                  {approved && !res && !picked && (
                    <span title="Vera approved this one" className="ml-auto grid size-6 shrink-0 place-items-center rounded-full bg-[#ffb224] text-[13px] font-black text-[#2a1a00]">
                      ✓
                    </span>
                  )}
                </div>

                <div className="mt-1 flex items-end justify-between">
                  <div className="leading-none">
                    <p className="font-game text-[18px] text-[#8a5f12] tabular-nums">×{odds.toFixed(1)}</p>
                    <p className="mt-0.5 text-[10.5px] font-bold text-black/55 tabular-nums">
                      {fmt(pools[slot])} in pot{mine > 0 && <span className="text-[#007580]"> · you {fmt(mine)}</span>}
                    </p>
                  </div>
                  {approved && !res && picked && <span className="text-[10.5px] font-bold text-[#8a5f12]">✓ Vera approved</span>}
                </div>

                {res && (
                  <div className="absolute inset-0 grid place-items-center bg-black/35">
                    <span
                      className={`stamp font-game rounded-lg border-4 px-3 py-0.5 text-[26px] tracking-wider ${isClient ? "border-[#4ade80] text-[#4ade80]" : "border-[#ff5a4d] text-[#ff5a4d]"}`}
                    >
                      {isClient ? "REAL" : "FAKE"}
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Always rendered (disabled between rounds) so the table never changes size. */}
        <div
          className={`${WHITE_CARD} flex shrink-0 flex-col items-stretch gap-1.5 rounded-[20px] p-2 transition-opacity sm:flex-row sm:items-center sm:justify-center lg:flex-col lg:items-stretch ${open ? "" : "pointer-events-none opacity-45"}`}
          aria-disabled={!open}
        >
            <div className="flex items-center justify-center gap-1.5">
              {CHIPS.map((c) => (
                <button
                  key={c.amount}
                  onClick={() => setAmount(c.amount)}
                  className={`chip btn-3d font-game grid size-8 place-items-center rounded-full text-[10.5px] text-white ${amount === c.amount ? "ring-[3px] ring-[#ffd23f]" : "opacity-70"}`}
                  style={{ "--chip": c.color } as React.CSSProperties}
                  aria-label={`Stake ${c.amount} NEAR`}
                >
                  {c.amount}
                </button>
              ))}
              <button
                onClick={() => balance > 0 && setAmount(String(Math.floor(balance * 100) / 100))}
                disabled={!(balance > 0)}
                className={`btn-3d font-game rounded-full px-2 py-1 text-[11px] disabled:opacity-40 ${stake > 0 && stake === Math.floor(balance * 100) / 100 ? "bg-[#ffd23f] text-[#3a2600]" : "bg-black/10"}`}
                title="Stake your whole balance"
              >
                MAX
              </button>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setStake(e.target.value)}
                onFocus={(e) => e.target.select()}
                className={`font-game w-14 rounded-lg bg-black/5 px-1 py-1 text-center text-[13px] tabular-nums outline-none focus:ring-2 focus:ring-[#ffd23f] ${CHIPS.some((c) => c.amount === amount) ? "text-black/60" : "text-[#8a5f12]"}`}
                aria-label="Custom stake in NEAR"
              />
            </div>
            <button
              onClick={placeBet}
              disabled={!open || !pick || busy}
              className="btn-3d font-game rounded-xl bg-gradient-to-b from-[#ffe27a] to-[#e0a91e] px-3 py-1.5 text-[#3a2600] disabled:from-black/10 disabled:to-black/5 disabled:text-black/50"
            >
              <span className="block text-[16px] leading-none">{!open ? "BETS CLOSED" : busy ? "PLACING…" : "PLACE BET"}</span>
              <span className="mt-0.5 block text-[10.5px] leading-none tracking-wide">
                {!open ? "next round soon" : pick ? `${stake ? fmt(stake) : "?"} Ⓝ on ${pick.name}` : "pick a suspect first"}
              </span>
            </button>
        </div>
      </div>
    </div>
  );
}

export function SusMeter({ value, label = true }: { value: number; label?: boolean }) {
  const level = value >= 60 ? 3 : value >= 25 ? 2 : value > 0 ? 1 : 0;
  return (
    <div className="mt-1 flex items-center gap-1" title={`Scam signals: ${value}`}>
      {label && <span className="text-[9.5px] font-bold tracking-widest text-black/45">SUS</span>}
      {[1, 2, 3].map((i) => (
        <span key={i} className="h-1.5 w-3 rounded-full" style={{ background: i <= level ? (level === 3 ? "#ff5a4d" : level === 2 ? "#ffb224" : "#4ade80") : "rgba(0,0,0,0.15)" }} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ profile (wallet + balance)

const FUND_AMOUNTS = ["1", "5", "10"];

export type Profile = ReturnType<typeof useProfile>;

export function Wallet({ data, profile, inline = false }: { data: GameState; profile: Profile; inline?: boolean }) {
  const account = useGame((s) => s.account);
  const kind = useGame((s) => s.walletKind);
  const setAccount = useGame((s) => s.setAccount);
  const practiceMode = data.mode === "practice";
  const network = data.mode === "mainnet" ? "mainnet" : "testnet";
  const connected = account && kind === "wallet";
  const [customFund, setCustomFund] = useState("");
  const coin = <span className="grid size-7 place-items-center rounded-full bg-[#ffd23f] font-game text-[14px] text-[#5a3d00] shadow-[0_2px_0_#b8860b]">N</span>;

  const connect = async () => {
    const a = await connectWallet(network).catch(() => null);
    if (a) setAccount(a, "wallet");
  };

  if (!practiceMode && !connected) {
    return (
      <div className={`${GLASS} p-4`}>
        <p className="text-[10.5px] font-bold tracking-[0.2em] text-white/50">YOUR CHIPS</p>
        <p className="mt-1 text-[12.5px] leading-snug text-white/70">Connect a NEAR wallet, fund your profile once, then bet with one tap.</p>
        <button onClick={connect} className="btn-3d font-game mt-3 w-full rounded-2xl bg-[#ffd23f] py-3 text-[17px] text-[#3a2600]">
          Connect wallet
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      {profile.fundOpen && !practiceMode && (
        <div className={`${GLASS} reveal-pop p-4 ${inline ? "mb-2" : "absolute top-full left-0 z-30 mt-2 w-full min-w-[230px]"}`}>
          <p className="font-game text-[16px]">Fund your profile</p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-white/60">One wallet approval. After that, bets are one tap. Cash out any time.</p>
          <div className="mt-2.5 flex gap-1.5">
            {FUND_AMOUNTS.map((a) => (
              <button key={a} disabled={profile.busy} onClick={() => profile.fund(a)} className="btn-3d font-game flex-1 rounded-xl bg-[#ffd23f] py-2 text-[15px] text-[#3a2600] disabled:opacity-50">
                {a} Ⓝ
              </button>
            ))}
          </div>
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (Number(customFund) >= 0.1) profile.fund(customFund);
            }}
          >
            <input
              inputMode="decimal"
              placeholder="Other amount"
              value={customFund}
              onChange={(e) => setCustomFund(e.target.value.replace(/[^\d.]/g, "").replace(/^(\d{0,6})(\.\d{0,4})?.*$/, "$1$2"))}
              className="min-w-0 flex-1 rounded-xl bg-black/30 px-2.5 py-2 text-[13px] text-white outline-none placeholder:text-white/40 focus:ring-2 focus:ring-[#ffd23f]"
              aria-label="Custom amount to fund in NEAR"
            />
            <button disabled={profile.busy || !(Number(customFund) >= 0.1)} className="btn-3d font-game rounded-xl bg-[#2f9e6b] px-3 text-[14px] disabled:opacity-40">
              Fund
            </button>
          </form>
        </div>
      )}
      <div className={`${GLASS} flex flex-col gap-2 p-4`}>
        <p className="text-[10.5px] font-bold tracking-[0.2em] text-white/50">YOUR CHIPS</p>
        <div className="flex items-center gap-2">
          {coin}
          <span className="font-game text-[28px] tabular-nums">{profile.data?.balance ?? (practiceMode ? "10" : "0")}</span>
          {!practiceMode && profile.oneTap && (
            <span title="One-tap betting is on: a limited key in this browser can only place bets and cash out to your wallet." className="text-[13px]">
              ⚡
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {practiceMode ? (
            <button disabled={profile.busy} onClick={profile.topUp} className="btn-3d rounded-full bg-[#2f9e6b] px-2.5 py-1 text-[11px] font-bold disabled:opacity-50">
              + Top up
            </button>
          ) : (
            <>
              <button onClick={() => profile.setFundOpen(!profile.fundOpen)} className="btn-3d rounded-full bg-[#2f9e6b] px-2.5 py-1 text-[11px] font-bold">
                + Fund
              </button>
              <button disabled={profile.busy || !Number(profile.data?.balance)} onClick={profile.cashOut} className="btn-3d rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold disabled:opacity-40">
                Cash out
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-white/50">
          {connected ? (
            <>
              <span className="max-w-[92px] truncate" title={account ?? ""}>
                {account}
              </span>
              <button
                onClick={async () => {
                  await disconnectWallet();
                  setAccount(null, null);
                }}
                className="underline hover:text-white"
              >
                out
              </button>
            </>
          ) : (
            <button onClick={connect} className="underline hover:text-white">
              PRACTICE · connect wallet
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The player's balance, bets, and every money action: practice or on-chain. */
export function useProfile(data: GameState | null, account: string | null) {
  const [state, setState] = useState<MyBet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fundOpen, setFundOpen] = useState(false);
  const roundId = data?.round?.id ?? -1;
  const phaseKey = `${roundId}:${Boolean(data?.round?.result)}`;
  const onChain = data && data.mode !== "practice";
  const network = data?.mode === "mainnet" ? "mainnet" : "testnet";
  const oneTap = Boolean(onChain && account && hasSessionKey(network, data!.contractId, account));

  async function refresh() {
    if (!account) return;
    const res = await fetch(`/api/bets?round=${roundId}&account=${encodeURIComponent(account)}`, { cache: "no-store" });
    if (res.ok) setState(await res.json());
  }

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, 4000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [account, phaseKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "").replace(/^.*Smart contract panicked:\s*/i, "").slice(0, 90) : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const post = async (body: object) => {
    const res = await fetch("/api/bets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed");
    return json;
  };

  async function bet(slot: number, amount: string) {
    if (!data?.round) return;
    if (!account) {
      setError("Connect your wallet to bet");
      return;
    }
    if (!(Number(amount) >= 0.01)) {
      setError("Enter a stake of at least 0.01 NEAR");
      return;
    }
    if (Number(state?.balance ?? 0) < Number(amount)) {
      if (onChain) setFundOpen(true);
      setError(onChain ? "Fund your profile to bet" : "Not enough practice NEAR: top up");
      return;
    }
    const round = data.round.id;
    const ok = await run(async () => {
      if (onChain) {
        await betFromProfile(network, data.contractId, account, round, slot, amount);
        await post({ action: "register", round, account });
      } else {
        await post({ action: "bet", round, account, slot, amount });
      }
    });
    if (ok) sfx("bet");
  }

  async function fund(amount: string) {
    if (!data || !account) return;
    const ok = await run(() => fundProfile(network, data.contractId, account, amount));
    if (ok) {
      setFundOpen(false);
      sfx("coins");
    }
  }

  const topUp = async () => {
    if (!account) return;
    if (await run(() => post({ action: "topup", account }))) sfx("coins");
  };

  const cashOut = async () => {
    if (!data || !account) return;
    if (await run(() => cashOutProfile(network, data.contractId, account))) sfx("coins");
  };

  return { data: state, error, busy, oneTap, fundOpen, setFundOpen, bet, fund, topUp, cashOut };
}

// ------------------------------------------------------------------ center stage

export function Splash({ title, sub }: { title: string; sub?: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
      <div className="panel reveal-pop pointer-events-auto max-w-sm rounded-3xl px-7 py-5 text-center">
        <p className="font-game text-[26px]">{title}</p>
        {sub && <div className="mt-1 text-[13.5px] text-white/70">{sub}</div>}
      </div>
    </div>
  );
}

export function Stage({ data, my }: { data: GameState; my: MyBet | null }) {
  const r = data.round;
  if (!data.aiReady && !r) {
    return (
      <Splash
        title="Vera is offline"
        sub={
          <>
            Add <code className="rounded bg-white/10 px-1">ANTHROPIC_API_KEY</code> to <code className="rounded bg-white/10 px-1">web/.env.local</code>, then restart.
          </>
        }
      />
    );
  }
  if (!r) return <Splash title="Suspects arriving…" sub={data.error && <span className="text-[#ff8a80]">{data.error}</span>} />;

  const res = r.result;
  const since = res ? (serverNow() - r.revealAt) / 1000 : -1;

  if (res && since > 1.5 && since < 11) {
    const s = data.suspects[res.clientSlot];
    const fooled = r.lines.filter((l) => l.approved && l.slot !== res.clientSlot).length;
    const amounts = my?.bet?.amounts.map(Number) ?? [];
    const staked = amounts.reduce((a, b) => a + b, 0);
    const payout = (amounts[res.clientSlot] ?? 0) * PAYOUT_MULTIPLIER;
    const net = payout - staked;

    return (
      // Bottom of the screen: the cash flies from the vault to the counter across the top half.
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
        <div className={`${WHITE_CARD} reveal-pop pointer-events-auto max-w-full !rounded-3xl px-4 py-3 text-center sm:px-8 sm:py-4`}>
          <p className="font-game text-[15px] tracking-widest text-black/60">THE REAL {r.holderName.split(" ")[0].toUpperCase()} WAS</p>
          <p className="font-game text-[32px] leading-none sm:text-[44px]" style={{ color: LOOKS[s.key].color }}>
            {s.name.toUpperCase()}
          </p>
          <div className="mt-2 flex flex-wrap items-start justify-center gap-x-4 gap-y-1 sm:mt-3 sm:gap-5">
            <div>
              <p className="font-game text-[22px] text-[#8a5f12] sm:text-[26px]">{fooled}</p>
              <p className="text-[10px] font-bold tracking-widest text-black/55">FOOLED VERA</p>
            </div>
            <div>
              <p className="font-game text-[22px] text-[#15803d] sm:text-[26px]">0</p>
              <p className="text-[10px] font-bold tracking-widest text-black/55">IMPOSTORS PAID</p>
            </div>
            <div>
              <p className="font-game text-[22px] text-[#8a5f12] sm:text-[26px]">{res.clientPaid}</p>
              <p className="text-[10px] font-bold tracking-widest text-black/55">CLIENT PAID Ⓝ</p>
            </div>
            {staked > 0 && (
              <div>
                <p className={`font-game text-[22px] sm:text-[26px] ${net >= 0 ? "text-[#15803d]" : "text-[#b3261e]"}`}>
                  {net >= 0 ? "+" : "−"}
                  {fmt(Math.abs(net))}
                </p>
                <p className="text-[10px] font-bold tracking-widest text-black/55">YOU</p>
              </div>
            )}
          </div>
          {res.settleUrl && (
            <a href={res.settleUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[12px] font-bold text-[#007580] underline">
              Verify on-chain ↗
            </a>
          )}
        </div>
      </div>
    );
  }

  if (res && since >= 11) {
    const left = Math.ceil(NEXT_ROUND_SECS - since);
    return (
      <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-4">
        <div className="panel reveal-pop flex max-w-full items-center gap-3 rounded-full py-1.5 pr-4 pl-1.5 sm:py-2 sm:pr-5 sm:pl-2">
          <span className="font-game grid size-10 place-items-center rounded-full bg-[#ffd23f] text-[18px] text-[#3a2600] tabular-nums">{left > 0 ? left : "…"}</span>
          <div className="leading-tight">
            <p className="font-game text-[18px]">{left > 0 ? "Next round" : "Shuffling suspects"}</p>
            <p className="text-[11.5px] font-semibold text-white/60">New account holder · new real client</p>
          </div>
        </div>
      </div>
    );
  }

  const left = secsToClose(r);
  if (left > 0 && left <= COUNTDOWN_SECS) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-4">
        <div className={`${WHITE_CARD} reveal-pop flex max-w-full items-center gap-3 !rounded-full !border-[#ff5a4d] py-1.5 pr-4 pl-1.5 sm:py-2 sm:pr-6 sm:pl-2`}>
          <span className="font-game grid size-12 shrink-0 animate-pulse place-items-center rounded-full bg-[#ff5a4d] text-[26px] text-white tabular-nums">
            {left}
          </span>
          <div className="leading-tight">
            <p className="font-game text-[17px] sm:text-[20px]">Bets close in {left}s</p>
            <p className="text-[11.5px] font-semibold text-black/65">Pick who&apos;s real and place your bet</p>
          </div>
        </div>
      </div>
    );
  }

  if (!res && elapsedOf(r) < 4) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-4">
        <div className="panel reveal-pop max-w-full rounded-3xl px-5 py-3 text-center sm:px-8 sm:py-4">
          <p className="font-game text-[15px] tracking-widest text-[#ffd23f]">ROUND {r.id + 1}</p>
          <p className="font-game text-[24px] leading-tight sm:text-[30px]">4 suspects · 1 real</p>
          <p className="text-[12.5px] font-semibold text-white/60">Place your bets</p>
        </div>
      </div>
    );
  }
  return null;
}

// ------------------------------------------------------------------ drawers

/** The counter transcript, always visible beside the game screen. */
export function LogPanel({ data, className = "h-[340px] lg:h-auto lg:flex-1" }: { data: GameState; className?: string }) {
  const round = data.round;
  const ref = useRef<HTMLDivElement>(null);
  const count = round?.lines.length ?? 0;
  // Follow new lines only while the reader is at the bottom; if they've scrolled up to read
  // older messages, leave them there and offer a "new messages" pill instead.
  const [following, setFollowing] = useState(true);
  // How many lines there were when the reader scrolled away from the bottom.
  const [readUpTo, setReadUpTo] = useState(0);
  const unseen = following ? 0 : Math.max(0, count - readUpTo);

  // True while we're smooth-scrolling to the bottom ourselves, so those scroll events aren't
  // mistaken for the reader scrolling up.
  const autoScrolling = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!following || !el) return;
    autoScrolling.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    const done = setTimeout(() => (autoScrolling.current = false), 1500);
    return () => clearTimeout(done);
  }, [count, following]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (autoScrolling.current) {
      if (atBottom) autoScrolling.current = false;
      return;
    }
    if (atBottom && !following) setFollowing(true);
    if (!atBottom && following) {
      setFollowing(false);
      setReadUpTo(count);
    }
  };

  return (
    <div className={`${GLASS} relative flex min-h-0 flex-col overflow-hidden ${className}`}>
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <p className="text-[16px] font-extrabold tracking-tight">At the counter</p>
        <span className="text-[10.5px] font-bold tracking-widest text-white/45">{count} LINES</span>
      </div>
      {unseen > 0 && (
        <button
          onClick={() => setFollowing(true)}
          className="reveal-pop absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-[#ffd23f] px-3 py-1 text-[11.5px] font-bold text-[#3a2600] shadow-lg"
        >
          ↓ {unseen} new message{unseen > 1 ? "s" : ""}
        </button>
      )}
      <div
        ref={ref}
        onScroll={onScroll}
        // Real wheel/touch/drag input means the reader is taking control: stop any auto-scroll.
        onWheel={() => (autoScrolling.current = false)}
        onTouchStart={() => (autoScrolling.current = false)}
        onPointerDown={() => (autoScrolling.current = false)}
        className="scroll-modern scroll-fade min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pt-2 pb-4">
        {!round || count === 0 ? <p className="text-[12.5px] text-white/50">The first suspect is walking up…</p> : null}
        {round?.lines.map((l, i) => {
          const s = data.suspects[l.slot];
          const vera = l.speaker === "vera";
          return (
            <div key={i} className={`flex ${vera ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[12.5px] leading-snug ${vera ? "bg-[#103b3b] text-[#dffcfc]" : "bg-white text-[#1d1d1f]"}`}>
                <p className="font-game text-[12px]" style={{ color: vera ? "#7ff5ff" : LOOKS[s.key].color }}>
                  {vera ? "Vera" : s.name}
                </p>
                {l.text}
                {l.approved && (
                  <p className="mt-1 text-[11px] font-bold text-[#ffb224]">
                    ✓ Approved{" "}
                    {l.filedTx && (
                      <a href={l.filedTx} target="_blank" rel="noreferrer" className="underline">
                        tx ↗
                      </a>
                    )}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Help({ data, onClose }: { data: GameState; onClose: () => void }) {
  const steps = [
    ["4 suspects", "All claim the same account. One is real."],
    ["Bet", "Pick who's real before the timer runs out."],
    ["Vera can be fooled", "Her ✓ is a clue, not proof. Sometimes she turns the real client away."],
    ["Watch the bulb 💡", "Two true clues drop while they talk: a fact from the account file, then a hint about the real client."],
    ["The vault decides", `Only the real client gets paid. A right pick pays ${PAYOUT_MULTIPLIER}× your stake.`],
    ["The house backs every bet", "Winnings land in your chips the moment the round settles, even if you're the only player. Cash out any time."],
  ];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="panel reveal-pop w-full max-w-sm rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <p className="font-game text-[18px]">How to play</p>
          <button onClick={onClose} className="grid size-8 place-items-center rounded-full bg-white/10 text-[16px] hover:bg-white/20" aria-label="Close">
            ✕
          </button>
        </div>
      <div className="space-y-3 px-4 pb-4">
        {steps.map(([h, b], i) => (
          <div key={h} className="flex gap-3">
            <span className="font-game grid size-8 shrink-0 place-items-center rounded-full bg-[#ffd23f] text-[16px] text-[#3a2600]">{i + 1}</span>
            <div>
              <p className="font-game text-[16px]">{h}</p>
              <p className="text-[12.5px] text-white/65">{b}</p>
            </div>
          </div>
        ))}
        <p className="rounded-2xl bg-white/8 p-3 text-[12px] text-white/70">
          The answer is sealed on-chain before betting opens. {data.mode === "practice" ? "Practice mode uses play money." : `Contract: ${data.contractId}`}
        </p>
      </div>
      </div>
    </div>
  );
}
