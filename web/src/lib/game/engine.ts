import "server-only";
import { after } from "next/server";
import { chain, practice, toNear, type ChainRound, type RequestStatus } from "../chain";
import { getJson, setJson, tryLock, unlock } from "../kv";
import { hasAiKey } from "../llm";
import { DIALOGUE_SECS, LIVE_SECS, REVEAL_SECS } from "./pacing";
import { generateScript, SUSPECTS, type Line, type Script } from "./script";

/** Grace after betting closes before settling, to absorb clock skew with block time. */
const SETTLE_GRACE_SECS = 4;

/** Each round's betting window fits its own conversation: it closes a few seconds after the last line. */
const liveSecsOf = (s: Script) => s.liveSecs ?? LIVE_SECS;

export { LIVE_SECS, REVEAL_SECS } from "./pacing";

const STATE_KEY = "game:state";
const NEXT_KEY = "game:next";
const TICK_LOCK = "game:tick";
const PREP_LOCK = "game:prep";
const PREP_ERROR_KEY = "game:prep-error";
const STARTING_KEY = "game:starting";
const bettorsKey = (round: number) => `game:bettors:${round}`;

type Filed = { line: number; hash?: string; error?: string };

type LiveRound = {
  id: number;
  script: Script;
  startedAt: number;
  startTx?: string;
  filed: Filed[];
  settled?: { at: number; tx?: string; requests: { slot: number; amountNear: string; status: RequestStatus }[]; clientPaid: string; pools: string[] };
};

type Stats = { rounds: number; fooled: number; impostorRejected: number; clientPaid: string };
type HistoryItem = { id: number; clientSlot: number; fooled: number; settleTx?: string };

type State = {
  phase: "idle" | "live" | "reveal";
  round?: LiveRound;
  error?: string;
  stats: Stats;
  history: HistoryItem[];
};

const initial: State = { phase: "idle", stats: { rounds: 0, fooled: 0, impostorRejected: 0, clientPaid: "0" }, history: [] };

// ------------------------------------------------------------------ driver

/** Advances the game. Called on every poll; cheap when there's nothing to do. */
export async function tick() {
  // Long enough to cover slow on-chain calls (start, file approvals, settle), so two ticks never overlap.
  if (!(await tryLock(TICK_LOCK, 90_000))) return;
  try {
    const s = (await getJson<State>(STATE_KEY)) ?? structuredClone(initial);
    await advance(s);
    await setJson(STATE_KEY, s);
  } finally {
    await unlock(TICK_LOCK);
  }
}

async function advance(s: State) {
  const now = Date.now();

  if (s.phase === "live" && s.round) {
    const r = s.round;
    const elapsed = (now - r.startedAt) / 1000;
    const closed = elapsed >= liveSecsOf(r.script) + SETTLE_GRACE_SECS;
    // File Vera's approvals on-chain as they play out (or all at once if we're catching up).
    for (const [i, line] of r.script.lines.entries()) {
      if (!line.approval || r.filed.some((f) => f.line === i)) continue;
      if (line.t > elapsed && !closed) continue;
      try {
        const tx = await chain().requestWithdrawal(r.id, line.slot, line.approval.amountNear, line.approval.destination || clientAccount(), `Approved by Vera for ${SUSPECTS[line.slot].name}`);
        r.filed.push({ line: i, hash: tx.hash });
      } catch (e) {
        r.filed.push({ line: i, error: errMsg(e) });
      }
    }
    if (closed) {
      try {
        await settle(s, r);
      } catch (e) {
        // Keep state (filed approvals are already on-chain); the next tick retries.
        s.error = `Settlement failed, retrying: ${errMsg(e)}`;
      }
    }
    return;
  }

  if (s.phase === "reveal" && s.round?.settled && now - s.round.settled.at < REVEAL_SECS * 1000) {
    ensurePrep();
    return;
  }

  // idle, or reveal finished: start the next round if a script is ready.
  const next = await getJson<Script>(NEXT_KEY);
  if (!next) {
    s.phase = s.phase === "reveal" ? "reveal" : "idle";
    ensurePrep();
    return;
  }
  // Remember which script we're about to start, so a start that lands on-chain but gets lost
  // here (slow RPC, overlapping tick) can still be recognised and adopted below.
  await setJson(STARTING_KEY, next, 600);
  try {
    const { id, hash } = await chain().startRound(next.commitment, liveSecsOf(next));
    await setJson(NEXT_KEY, null);
    s.round = { id, script: next, startedAt: Date.now(), startTx: hash, filed: [] };
    s.phase = "live";
    s.error = undefined;
    ensurePrep();
  } catch (e) {
    // The start may have landed on-chain even though this call failed (e.g. a slow RPC, or a
    // concurrent tick that started it first). If the open on-chain round carries this script's
    // sealed answer, it's ours: adopt it instead of getting stuck on "Previous round still open".
    const open = await chain()
      .getLatestRound()
      .catch(() => null);
    const starting = await getJson<Script>(STARTING_KEY);
    const ours = [next, starting].find((sc) => sc && open && !open.settled && open.commitment === sc.commitment);
    if (open && ours) {
      if (ours === next) await setJson(NEXT_KEY, null);
      s.round = { id: open.id, script: ours, startedAt: Math.floor(open.started_ns / 1e6), filed: [] };
      s.phase = "live";
      s.error = undefined;
      ensurePrep();
      return;
    }
    s.error = `Could not start round: ${errMsg(e)}`;
  }
}

async function settle(s: State, r: LiveRound) {
  const { round, hash } = await chain().settleRound(r.id, r.script.clientSlot, r.script.salt);
  const approvedImpostors = r.script.lines.filter((l) => l.approval && l.slot !== r.script.clientSlot).length;
  r.settled = {
    at: Date.now(),
    tx: hash,
    requests: round.requests.map((q) => ({ slot: q.slot, amountNear: toNear(q.amount), status: q.status })),
    clientPaid: toNear(round.client_paid),
    pools: round.pools.map((p) => toNear(p)),
  };
  s.phase = "reveal";
  s.stats.rounds++;
  s.stats.fooled += approvedImpostors;
  s.stats.impostorRejected += round.requests.filter((q) => q.status === "RejectedImpostor").length;
  s.stats.clientPaid = (Number(s.stats.clientPaid) + Number(r.settled.clientPaid)).toFixed(3);
  s.history = [{ id: r.id, clientSlot: r.script.clientSlot, fooled: approvedImpostors, settleTx: hash }, ...s.history].slice(0, 10);
  payWinners(r.id);
  recycle(round.client_paid);
  ensurePrep();
}

/** Winners are paid automatically: claim() is permissionless and pays the bettor. */
function payWinners(roundId: number) {
  after(async () => {
    const p = practice();
    const bettors = p ? await p.practiceBets(roundId) : ((await getJson<string[]>(bettorsKey(roundId))) ?? []);
    for (const b of bettors) {
      try {
        await chain().claim(roundId, b);
      } catch {
        // Already claimed or no bet: the bettor can still claim from the UI.
      }
    }
  });
}

/** Returns the client's winnings to the vault after the payout lands, so it never runs dry. */
function recycle(amountYocto: string) {
  const c = chain();
  console.info(`[recycle] payout ${toNear(amountYocto)} NEAR, supported=${Boolean(c.recyclePayout)}, key=${Boolean(process.env.CLIENT_PRIVATE_KEY)}`);
  if (!c.recyclePayout || BigInt(amountYocto) <= 0n) return;
  // Not deferred with after(): this already runs inside a background tick, and a nested after()
  // isn't guaranteed to run. Fire-and-forget keeps settlement fast.
  void (async () => {
    // Give the payout receipt a moment to land in the client account first.
    await new Promise((res) => setTimeout(res, 4000));
    try {
      const { hash } = await c.recyclePayout!(amountYocto);
      console.info(`[recycle] returned ${toNear(amountYocto)} NEAR to the vault${hash ? `: ${hash}` : " (skipped: no client key)"}`);
    } catch (e) {
      console.error("[recycle] failed", e);
    }
  })();
}

/** Generates the next round's script in the background, once. */
function ensurePrep() {
  if (!hasAiKey()) return;
  after(async () => {
    if (await getJson<Script>(NEXT_KEY)) return;
    if (!(await tryLock(PREP_LOCK, 120_000))) return;
    try {
      await setJson(NEXT_KEY, await generateScript(DIALOGUE_SECS));
      await setJson(PREP_ERROR_KEY, null);
    } catch (e) {
      console.error("script generation failed", e);
      // Surface it to viewers (e.g. AI provider out of credit) instead of an endless "arriving" screen.
      await setJson(PREP_ERROR_KEY, "AI provider error: " + errMsg(e), 600);
    } finally {
      await unlock(PREP_LOCK);
    }
  });
}

export async function registerBettor(roundId: number, account: string) {
  const list = (await getJson<string[]>(bettorsKey(roundId))) ?? [];
  if (!list.includes(account) && list.length < 500) await setJson(bettorsKey(roundId), [...list, account], 86_400);
}

// ------------------------------------------------------------------ public view

export type PublicLine = Omit<Line, "approval"> & { approved?: string; filedTx?: string | null };

export type PublicState = {
  mode: "testnet" | "mainnet" | "practice";
  aiReady: boolean;
  serverNow: number;
  phase: State["phase"];
  error?: string;
  contractId: string;
  stats: Stats;
  history: (HistoryItem & { settleUrl: string | null })[];
  suspects: { slot: number; key: string; name: string }[];
  round: null | {
    id: number;
    holderName: string;
    startedAt: number;
    bettingClosesAt: number;
    revealAt: number;
    order: number[];
    lines: PublicLine[];
    /** `text` is null until the clue's time comes. */
    clues: { t: number; text: string | null }[];
    pools: string[];
    startUrl: string | null;
    result: null | {
      clientSlot: number;
      roles: string[];
      settleUrl: string | null;
      requests: { slot: number; amountNear: string; status: RequestStatus }[];
      clientPaid: string;
    };
  };
};

let poolCache: { id: number; at: number; pools: string[] } | undefined;

async function livePools(id: number): Promise<string[]> {
  if (poolCache?.id === id && Date.now() - poolCache.at < 2500) return poolCache.pools;
  const r: ChainRound | null = await chain().getRound(id).catch(() => null);
  const pools = r ? r.pools.map((p) => toNear(p)) : SUSPECTS.map(() => "0");
  poolCache = { id, at: Date.now(), pools };
  return pools;
}

export async function publicState(): Promise<PublicState> {
  const s = (await getJson<State>(STATE_KEY)) ?? initial;
  const c = chain();
  const now = Date.now();
  const r = s.round;

  let round: PublicState["round"] = null;
  if (r) {
    const elapsed = (now - r.startedAt) / 1000;
    const revealed = Boolean(r.settled);
    round = {
      id: r.id,
      holderName: r.script.holderName,
      startedAt: r.startedAt,
      bettingClosesAt: r.startedAt + (liveSecsOf(r.script) - 3) * 1000,
      // When settlement actually happened, so a late settle still gets its full reveal.
      revealAt: r.settled?.at ?? r.startedAt + (liveSecsOf(r.script) + SETTLE_GRACE_SECS) * 1000,
      order: r.script.order,
      // Only lines that have already played. Future lines would leak the round.
      lines: r.script.lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => revealed || l.t <= elapsed)
        .map(({ l, i }) => {
          const filed = r.filed.find((f) => f.line === i);
          return {
            t: l.t,
            slot: l.slot,
            speaker: l.speaker,
            text: l.text,
            risk: l.risk,
            approved: l.approval?.amountNear,
            filedTx: filed?.hash ? c.explorer(filed.hash) : null,
          };
        }),
      // Clue times are public (so the bulb can count down); a clue's text only once it's due.
      clues: (r.script.clues ?? []).map((k) => ({ t: k.t, text: revealed || k.t <= elapsed ? k.text : null })),
      pools: r.settled ? r.settled.pools : await livePools(r.id),
      startUrl: r.startTx ? c.explorer(r.startTx) : null,
      result: r.settled
        ? {
            clientSlot: r.script.clientSlot,
            roles: r.script.roles,
            settleUrl: r.settled.tx ? c.explorer(r.settled.tx) : null,
            requests: r.settled.requests,
            clientPaid: r.settled.clientPaid,
          }
        : null,
    };
  }

  return {
    mode: c.mode,
    aiReady: hasAiKey(),
    serverNow: now,
    phase: s.phase,
    error: s.error ?? (await getJson<string>(PREP_ERROR_KEY)) ?? undefined,
    contractId: c.contractId,
    stats: s.stats,
    history: s.history.map((h) => ({ ...h, settleUrl: h.settleTx ? c.explorer(h.settleTx) : null })),
    suspects: SUSPECTS.map((x, slot) => ({ slot, key: x.key, name: x.name })),
    round,
  };
}

const clientAccount = () => process.env.CLIENT_ACCOUNT_ID ?? "client.practice";
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);
