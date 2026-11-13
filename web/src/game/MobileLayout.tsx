"use client";

import { useRef, useState } from "react";
import { PAYOUT_MULTIPLIER } from "@/lib/game/odds";
import { COUNTDOWN_SECS } from "@/lib/game/pacing";
import { CHIPS, ClueButton, ClueInline, fmt, GLASS, Help, HistoryPanel, IconButton, LogPanel, secsToClose, Splash, Stage, SusMeter, TimerRing, useClueToggle, useHudClock, useProfile, Wallet, WHITE_CARD, type Profile } from "./Hud";
import { LOOKS, serverNow, useGame, type GameState } from "./store";

type Tab = "bet" | "chat" | "chips" | "rounds";

/**
 * Phone/tablet layout: a full-height app shell that never scrolls as a page.
 *   header (brand · balance · sound · help) → round strip → game stage (fills the rest)
 *   → fixed-height dock (bet / counter / chips / rounds) → bottom tab bar in the thumb zone.
 * The dock keeps one height for every tab, so live updates and tab switches never resize the game.
 * Short landscape phones put the stage on the left and everything else in a column on the right.
 */
export function MobileLayout({ scene }: { scene: React.ReactNode }) {
  const data = useGame((s) => s.data);
  const account = useGame((s) => s.account);
  const [help, setHelp] = useState(false);
  const [tab, setTab] = useState<Tab>("bet");
  useHudClock(data);
  const profile = useProfile(data, account);

  // A failed bet that needs funds opens the funding form: take the player to it.
  const [fundWasOpen, setFundWasOpen] = useState(false);
  if (profile.fundOpen !== fundWasOpen) {
    setFundWasOpen(profile.fundOpen);
    if (profile.fundOpen) setTab("chips");
  }

  // Unread counter lines while the Counter tab is closed.
  const lines = data?.round?.lines.length ?? 0;
  const roundId = data?.round?.id;
  const [seen, setSeen] = useState({ round: roundId, lines });
  if (tab === "chat" && (seen.round !== roundId || seen.lines !== lines)) setSeen({ round: roundId, lines });
  const unread = seen.round === roundId ? Math.max(0, lines - seen.lines) : lines;

  return (
    <main className="casino-bg font-sans grid h-dvh grid-cols-1 grid-rows-[auto_auto_minmax(0,1fr)_auto_auto] gap-2 overflow-hidden px-[max(10px,env(safe-area-inset-left))] pt-[max(8px,env(safe-area-inset-top))] short:grid-cols-[minmax(0,1fr)_minmax(300px,42%)] short:grid-rows-[auto_auto_minmax(0,1fr)_auto] short:gap-x-3">
      <MobileHeader data={data} profile={profile} onHelp={() => setHelp(true)} onChips={() => setTab("chips")} />
      {/* Reads the clock, so it renders only on the client once game data arrives. */}
      {data ? <RoundStrip data={data} /> : <div className={`${GLASS} h-[52px] short:col-start-2 short:row-start-2`} />}

      <section className="marquee !rounded-[18px] !p-[7px] min-h-[150px] short:col-start-1 short:row-span-4 short:row-start-1 short:mb-[max(8px,env(safe-area-inset-bottom))]" aria-label="Game">
        <div className="screen h-full !rounded-[12px]">
          {scene}
          <div className="pointer-events-none absolute inset-0 z-40">{data ? <Stage data={data} my={profile.data} /> : <Splash title="Opening the bank" />}</div>
        </div>
      </section>

      <div className="h-[188px] min-h-0 squat:h-[172px] short:col-start-2 short:row-start-3 short:h-auto">
        {data && tab === "bet" && <MobileBetDock data={data} profile={profile} />}
        {data && tab === "chat" && <LogPanel data={data} className="h-full" />}
        {data && tab === "chips" && (
          <div className="scroll-modern h-full overflow-y-auto">
            <Wallet data={data} profile={profile} inline />
          </div>
        )}
        {data && tab === "rounds" && (
          <div className="scroll-modern flex h-full flex-col gap-2 overflow-y-auto">
            <Scoreboard data={data} />
            <HistoryPanel data={data} className="min-h-[150px] flex-1" />
          </div>
        )}
      </div>

      <TabBar tab={tab} setTab={setTab} unread={tab === "chat" ? 0 : unread} />

      {help && data && <Help data={data} onClose={() => setHelp(false)} />}
    </main>
  );
}

// ------------------------------------------------------------------ top

function MobileHeader({ data, profile, onHelp, onChips }: { data: GameState | null; profile: Profile; onHelp: () => void; onChips: () => void }) {
  const muted = useGame((s) => s.muted);
  const toggleMute = useGame((s) => s.toggleMute);
  const practice = data?.mode === "practice";
  const balance = profile.data?.balance ?? (practice ? "10" : null);

  return (
    <header className="flex items-center justify-between gap-2 short:col-start-2 short:row-start-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-game grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#f6d77a] to-[#b8861f] text-[18px] text-[#3a2600] shadow-[0_3px_0_#5a3d00]">N</span>
        <div className="hidden min-w-0 leading-none min-[380px]:block short:!hidden">
          <p className="font-game truncate text-[17px] tracking-wide text-[#f6d77a]">NEAR RESERVE</p>
          <p className="mt-0.5 hidden truncate text-[9px] font-bold tracking-[0.15em] text-white/50 min-[420px]:block squat:hidden">
            GUESS THE CLIENT · {practice ? "PRACTICE" : (data?.mode ?? "").toUpperCase()}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {data && (
          <button onClick={onChips} className="panel btn-3d flex h-11 items-center gap-1.5 rounded-2xl pr-3 pl-1.5" aria-label="Your chips">
            <span className="font-game grid size-7 place-items-center rounded-full bg-[#ffd23f] text-[13px] text-[#5a3d00] shadow-[0_2px_0_#b8860b]">N</span>
            <span className="font-game text-[16px] tabular-nums">{balance === null ? "Wallet" : fmt(Number(balance))}</span>
          </button>
        )}
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
    </header>
  );
}

/** Timer, round number and the question, in one compact strip above the stage. The bulb swaps the question for the clues. */
function RoundStrip({ data }: { data: GameState }) {
  const r = data.round;
  const now = serverNow();
  const clues = useClueToggle(r);
  const status = !r ? "Suspects arriving" : r.result ? "Reveal" : now < r.bettingClosesAt ? "Bets open" : "Bets closed · settling";
  return (
    <div className={`${GLASS} relative flex items-center gap-2.5 px-2.5 py-1.5 short:col-start-2 short:row-start-2`}>
      <div className="shrink-0 scale-[0.85]">
        <TimerRing round={r} />
      </div>
      {r && clues.showing ? (
        <ClueInline round={r} />
      ) : (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[10.5px] font-bold tracking-widest text-white/55 uppercase">
            Round {r ? r.id + 1 : "—"} · {status}
          </p>
          <p className="truncate text-[16px] font-extrabold tracking-tight">
            {r ? (
              <>
                Who&apos;s the real <span className="text-[#7ff5ff]">{r.holderName}</span>?
              </>
            ) : (
              "Get ready"
            )}
          </p>
        </div>
      )}
      {r && <ClueButton round={r} showing={clues.showing} onClick={clues.toggle} />}
    </div>
  );
}

function Scoreboard({ data }: { data: GameState }) {
  const cell = (v: React.ReactNode, label: string, color = "") => (
    <div className="text-center leading-none">
      <p className={`font-game text-[20px] tabular-nums ${color}`}>{v}</p>
      <p className="mt-1 text-[9.5px] font-bold tracking-widest text-black/60">{label}</p>
    </div>
  );
  return (
    <div className={`${WHITE_CARD} flex shrink-0 items-center justify-around px-3 py-2`}>
      {cell(data.stats.fooled, "AI FOOLED", "text-[#8a5f12]")}
      <div className="h-7 w-px bg-black/15" />
      {cell(0, "STOLEN", "text-[#15803d]")}
      <div className="h-7 w-px bg-black/15" />
      {cell(data.stats.rounds, "ROUNDS")}
    </div>
  );
}

// ------------------------------------------------------------------ bet dock

/** Four suspect cards in one row, then the stake rack and a full-width bet button in thumb reach. */
function MobileBetDock({ data, profile }: { data: GameState; profile: Profile }) {
  const { data: my, bet: onBet, error, busy } = profile;
  const selected = useGame((s) => s.selected);
  const select = useGame((s) => s.select);
  const [amount, setAmount] = useState(CHIPS[0].amount);
  const r = data.round;
  const left = secsToClose(r);
  const open = left > 0;
  const closing = open && left <= COUNTDOWN_SECS;
  const stake = Number(amount) || 0;
  const balance = Number(my?.balance ?? 0);
  const pick = selected !== null && selected !== undefined ? data.suspects[selected] : null;
  const input = useRef<HTMLInputElement>(null);
  const setStake = (raw: string) => setAmount(raw.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").replace(/^(\d{0,5})(\.\d{0,4})?.*$/, "$1$2"));
  const placeBet = () => {
    if (!pick) return;
    input.current?.blur();
    onBet(pick.slot, stake >= 0.01 ? String(Math.floor(stake * 10_000) / 10_000) : "");
  };

  const sub = error ? (
    <span className="text-[#b3261e]">{error}</span>
  ) : !open ? (
    r?.result ? "round settled · next round soon" : "next round soon"
  ) : pick ? (
    `${stake ? fmt(stake) : "?"} Ⓝ on ${pick.name}${closing ? ` · ${left}s left` : ""}`
  ) : (
    `tap a suspect first${closing ? ` · ${left}s left` : ""}`
  );

  return (
    <div className="felt flex h-full flex-col gap-1.5 !rounded-[20px] !border-4 p-1.5 !shadow-[0_0_0_4px_#b8861f,0_0_0_6px_#3a2600,0_10px_30px_rgba(0,0,0,0.5)]">
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-1.5">
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
              className={`${WHITE_CARD} relative flex min-w-0 flex-col items-center justify-center overflow-hidden !rounded-xl px-1 py-1 transition ${
                picked ? "!border-[#86efac] !bg-[#dcfce7] !shadow-[0_0_0_2px_#86efac,0_0_18px_rgba(134,239,172,0.55)]" : ""
              }`}
            >
              <span className="relative grid size-7 shrink-0 place-items-center rounded-full ring-2 ring-white/70" style={{ background: LOOKS[key].color }}>
                <span className="font-game text-[14px] text-white">{name[0]}</span>
                {talking && <span className="absolute -top-0.5 -right-0.5 size-2.5 animate-ping rounded-full bg-[#7ff5ff]" />}
              </span>
              {approved && !res && (
                <span title="Vera approved this one" className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-[#ffb224] text-[10px] font-black text-[#2a1a00]">
                  ✓
                </span>
              )}
              <p className="font-game mt-0.5 w-full truncate text-center text-[13px] leading-none">{name}</p>
              <p className="font-game text-[15px] leading-tight text-[#8a5f12] tabular-nums">×{odds.toFixed(1)}</p>
              <SusMeter value={sus} label={false} />
              {mine > 0 && <p className="mt-0.5 text-[9.5px] leading-none font-bold text-[#007580] tabular-nums">you {fmt(mine)}</p>}
              {res && (
                <div className="absolute inset-0 grid place-items-center bg-black/40">
                  <span className={`stamp font-game rounded-md border-[3px] px-1.5 text-[15px] tracking-wider ${isClient ? "border-[#4ade80] text-[#4ade80]" : "border-[#ff5a4d] text-[#ff5a4d]"}`}>
                    {isClient ? "REAL" : "FAKE"}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className={`flex shrink-0 items-center gap-1.5 transition-opacity ${open ? "" : "pointer-events-none opacity-45"}`} aria-disabled={!open}>
        <div className="flex items-center gap-1">
          {CHIPS.map((c) => (
            <button
              key={c.amount}
              onClick={() => setAmount(c.amount)}
              className={`chip btn-3d font-game grid size-10 place-items-center rounded-full text-[11px] text-white ${amount === c.amount ? "ring-[3px] ring-[#ffd23f]" : "opacity-70"}`}
              style={{ "--chip": c.color } as React.CSSProperties}
              aria-label={`Stake ${c.amount} NEAR`}
            >
              {c.amount}
            </button>
          ))}
          <input
            ref={input}
            inputMode="decimal"
            enterKeyHint="go"
            value={amount}
            onChange={(e) => setStake(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => e.key === "Enter" && placeBet()}
            // 16px keeps iOS Safari from zooming the page on focus.
            className={`font-game h-10 w-[52px] rounded-lg bg-black/35 px-1 text-center text-[16px] tabular-nums outline-none focus:ring-2 focus:ring-[#ffd23f] ${CHIPS.some((c) => c.amount === amount) ? "text-white/60" : "text-[#ffd23f]"}`}
            aria-label="Custom stake in NEAR"
          />
          <button
            onClick={() => balance > 0 && setAmount(String(Math.floor(balance * 100) / 100))}
            disabled={!(balance > 0)}
            className={`btn-3d font-game h-10 rounded-lg px-1.5 text-[11px] disabled:opacity-40 ${stake > 0 && stake === Math.floor(balance * 100) / 100 ? "bg-[#ffd23f] text-[#3a2600]" : "bg-white/15"}`}
            title="Stake your whole balance"
          >
            MAX
          </button>
        </div>
        <button
          onClick={placeBet}
          disabled={!open || !pick || busy}
          className={`btn-3d font-game h-11 min-w-0 flex-1 rounded-xl bg-gradient-to-b from-[#ffe27a] to-[#e0a91e] px-1.5 text-[#3a2600] disabled:from-white/20 disabled:to-white/10 disabled:text-white/50 ${closing && pick ? "animate-pulse" : ""}`}
        >
          <span className="block truncate text-[15px] leading-none">{!open ? "CLOSED" : busy ? "PLACING…" : "BET"}</span>
          <span className="mt-0.5 block truncate text-[9.5px] leading-none tracking-wide">{sub}</span>
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tab bar

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "bet",
    label: "Bet",
    icon: <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeDasharray="3 2.3" />,
  },
  {
    id: "chat",
    label: "Counter",
    icon: <path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />,
  },
  {
    id: "chips",
    label: "Chips",
    icon: <path d="M3 8h18v11H3zM3 8l3-3h12l3 3M16 13.5h2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />,
  },
  {
    id: "rounds",
    label: "Rounds",
    icon: <path d="M12 7v5l3 2M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
  },
];

function TabBar({ tab, setTab, unread }: { tab: Tab; setTab: (t: Tab) => void; unread: number }) {
  return (
    <nav
      className="-mx-[max(10px,env(safe-area-inset-left))] grid grid-cols-4 border-t border-white/10 bg-[#24040a]/90 px-[max(10px,env(safe-area-inset-left))] pb-[env(safe-area-inset-bottom)] backdrop-blur-md short:col-start-2 short:row-start-4 short:mx-0 short:mb-[max(8px,env(safe-area-inset-bottom))] short:rounded-2xl short:border short:px-0 short:pb-0"
      aria-label="Panels"
    >
      {TABS.map((t) => {
        const on = t.id === tab;
        return (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={on ? "page" : undefined}
            className={`relative flex h-[52px] flex-col items-center justify-center gap-0.5 text-[10.5px] font-bold tracking-wide transition-colors squat:h-12 ${on ? "text-[#ffd23f]" : "text-white/55"}`}
          >
            {on && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-[#ffd23f]" />}
            <svg viewBox="0 0 24 24" className="size-[22px]">
              {t.icon}
            </svg>
            {t.label}
            {unread > 0 && t.id === "chat" && (
              <span className="absolute top-1.5 left-1/2 ml-2 min-w-[18px] rounded-full bg-[#ff5a4d] px-1 text-center text-[10px] leading-[18px] text-white tabular-nums">{unread > 9 ? "9+" : unread}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
