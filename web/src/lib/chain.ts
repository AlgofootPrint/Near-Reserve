import "server-only";
import { PAYOUT_TENTHS } from "./game/odds";
import { Account, actions, JsonRpcProvider, nearToYocto, teraToGas, yoctoToNear, type KeyPairString } from "near-api-js";
import { getJson, setJson } from "./kv";

/**
 * The game's view of the chain. `NearChain` talks to the deployed contract;
 * `PracticeChain` mirrors the contract's rules in memory so the game is playable
 * before anything is deployed. The UI labels practice mode clearly.
 */

export const SUSPECTS = 4;

export type RequestStatus = "Pending" | "Paid" | "RejectedImpostor" | "RejectedCap" | "RejectedFunds";
export type WithdrawalRequest = { slot: number; amount: string; destination: string; memo: string; status: RequestStatus };
export type ChainRound = {
  id: number;
  commitment: string;
  started_ns: number;
  betting_closes_ns: number;
  pools: string[];
  requests: WithdrawalRequest[];
  settled: boolean;
  client_slot: number | null;
  salt: string | null;
  client_paid: string;
};
export type ChainStatus = {
  balance: string;
  spendable: string;
  locked_bets: string;
  rounds: number;
  total_requests: number;
  impostor_requests_rejected: number;
  paid_to_client: string;
  paid_to_others: string;
  client_account: string;
};
export type Tx = { hash?: string };

export interface Chain {
  mode: "testnet" | "mainnet" | "practice";
  contractId: string;
  explorer: (hash: string) => string | null;
  startRound(commitment: string, bettingSecs: number): Promise<{ id: number } & Tx>;
  requestWithdrawal(roundId: number, slot: number, amountNear: string, destination: string, memo: string): Promise<Tx>;
  settleRound(roundId: number, clientSlot: number, salt: string): Promise<{ round: ChainRound } & Tx>;
  claim(roundId: number, bettor: string): Promise<{ amount: string } & Tx>;
  getRound(roundId: number): Promise<ChainRound | null>;
  getLatestRound(): Promise<ChainRound | null>;
  getStatus(): Promise<ChainStatus>;
  getBet(roundId: number, bettor: string): Promise<BetView | null>;
  /** Profile balance (yoctoNEAR) available to bet with. */
  getBalance(account: string): Promise<string>;
  /** Sends the client's winnings back into the vault so it never runs dry. Optional. */
  recyclePayout?(amountYocto: string): Promise<Tx>;
  /**
   * The house puts `perSlotNear` on every suspect at the start of a round, so there's always
   * money to win (or lose) even with a single player. Returns the house's bettor id, or null if skipped.
   */
}

export type BetView = { amounts: string[]; claimed: boolean; claimable: string };

/** yocto → "1.25" style NEAR. Only trims zeros after a decimal point ("10" stays "10"). */
export const toNear = (yocto: string | bigint, decimals = 3) => {
  const s = yoctoToNear(BigInt(yocto), decimals);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};

// ---------------------------------------------------------------- NEAR

class NearChain implements Chain {
  mode: "testnet" | "mainnet";
  contractId: string;
  private provider: JsonRpcProvider;
  private gm: Account;
  private vera: Account;

  constructor() {
    this.mode = process.env.NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";
    this.contractId = process.env.GAME_CONTRACT_ID!;
    const url = process.env.NEAR_RPC_URL ?? (this.mode === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com");
    this.provider = new JsonRpcProvider({ url });
    // Both keys are function-call keys: the game master's can only start/settle/claim,
    // Vera's can only file withdrawal requests. Neither can attach a deposit.
    this.gm = new Account(process.env.GM_ACCOUNT_ID!, this.provider, process.env.GM_PRIVATE_KEY as KeyPairString);
    this.vera = new Account(process.env.AGENT_ACCOUNT_ID!, this.provider, process.env.AGENT_PRIVATE_KEY as KeyPairString);
  }

  explorer = (hash: string) => `https://${this.mode === "testnet" ? "testnet." : ""}nearblocks.io/txns/${hash}`;

  private async call<T>(who: Account, methodName: string, args: object): Promise<{ value: T } & Tx> {
    const res = (await who.callFunctionRaw({ contractId: this.contractId, methodName, args, gas: teraToGas("100") })) as unknown as {
      transaction: { hash: string };
      status: { SuccessValue?: string };
    };
    const raw = res.status.SuccessValue ? Buffer.from(res.status.SuccessValue, "base64").toString() : "";
    return { value: (raw ? JSON.parse(raw) : undefined) as T, hash: res.transaction.hash };
  }

  private view<T>(method: string, args: Record<string, unknown> = {}) {
    return this.provider.callFunction({ contractId: this.contractId, method, args }) as unknown as Promise<T>;
  }

  async startRound(commitment: string, bettingSecs: number) {
    const { value, hash } = await this.call<number>(this.gm, "start_round", { commitment, betting_secs: bettingSecs });
    return { id: value, hash };
  }
  async requestWithdrawal(roundId: number, slot: number, amountNear: string, destination: string, memo: string) {
    const { hash } = await this.call(this.vera, "request_withdrawal", {
      round_id: roundId,
      slot,
      amount: nearToYocto(amountNear as `${number}`).toString(),
      destination,
      memo,
    });
    return { hash };
  }
  async settleRound(roundId: number, clientSlot: number, salt: string) {
    const { value, hash } = await this.call<ChainRound>(this.gm, "settle_round", { round_id: roundId, client_slot: clientSlot, salt });
    return { round: value, hash };
  }
  async claim(roundId: number, bettor: string) {
    const { value, hash } = await this.call<string>(this.gm, "claim", { round_id: roundId, bettor });
    return { amount: value, hash };
  }
  getRound = (roundId: number) => this.view<ChainRound | null>("get_round", { round_id: roundId });
  getLatestRound = () => this.view<ChainRound | null>("get_latest_round");
  getStatus = () => this.view<ChainStatus>("get_status");
  getBet = (roundId: number, bettor: string) => this.view<BetView | null>("get_bet", { round_id: roundId, bettor });
  getBalance = (account: string) => this.view<string>("get_balance", { account });

  /**
   * The game owns the client account, so its winnings are recycled into the vault after each
   * round. This keeps a small testnet float paying out indefinitely. Uses a key that only
   * controls the client account (CLIENT_PRIVATE_KEY), never the owner's.
   */
  async recyclePayout(amountYocto: string): Promise<Tx> {
    const key = process.env.CLIENT_PRIVATE_KEY;
    const client = process.env.CLIENT_ACCOUNT_ID;
    if (!key || !client || BigInt(amountYocto) <= 0n) return {};
    const acct = new Account(client, this.provider, key as KeyPairString);
    const res = (await acct.signAndSendTransaction({ receiverId: this.contractId, actions: [actions.transfer(BigInt(amountYocto))] })) as unknown as {
      transaction: { hash: string };
    };
    return { hash: res.transaction.hash };
  }
}

// ---------------------------------------------------------------- Practice

const PRACTICE_KEY = "practice:chain";
const PRACTICE_START_BALANCE = nearToYocto("10");
const PRACTICE_TOPUP_CAP = nearToYocto("50");
const CAP = nearToYocto("0.1");
const MIN_BET = nearToYocto("0.01");
const MAX_BET = nearToYocto("10000");

type PracticeState = {
  roundCount: number;
  rounds: Record<string, ChainRound>;
  bets: Record<string, { amounts: string[]; claimed: boolean }>;
  balances: Record<string, string>;
  vault: string;
  totalRequests: number;
  impostorRejected: number;
  paidToClient: string;
};

async function loadPractice(): Promise<PracticeState> {
  return (
    (await getJson<PracticeState>(PRACTICE_KEY)) ?? {
      roundCount: 0,
      rounds: {},
      bets: {},
      balances: {},
      vault: nearToYocto("5").toString(),
      totalRequests: 0,
      impostorRejected: 0,
      paidToClient: "0",
    }
  );
}

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Buffer.from(buf).toString("hex");
}

/** Mirrors the contract: the stake on the real client pays PAYOUT_TENTHS / 10 x; abandoned rounds refund. */
export function practicePayout(round: ChainRound, amounts: string[]): bigint {
  const staked = amounts.reduce((s, a) => s + BigInt(a), 0n);
  if (!round.settled || round.client_slot === null) return staked;
  return (BigInt(amounts[round.client_slot]) * BigInt(PAYOUT_TENTHS)) / 10n;
}

class PracticeChain implements Chain {
  mode = "practice" as const;
  contractId = "practice-bank (not on-chain)";
  explorer = () => null;

  async startRound(commitment: string, bettingSecs: number) {
    const s = await loadPractice();
    const prev = s.rounds[s.roundCount - 1];
    if (prev && !prev.settled) throw new Error("Previous round still open");
    const now = Date.now() * 1e6;
    const id = s.roundCount++;
    s.rounds[id] = {
      id,
      commitment,
      started_ns: now,
      betting_closes_ns: now + bettingSecs * 1e9,
      pools: Array(SUSPECTS).fill("0"),
      requests: [],
      settled: false,
      client_slot: null,
      salt: null,
      client_paid: "0",
    };
    // Keep the practice state small.
    for (const k of Object.keys(s.rounds)) if (Number(k) < id - 5) delete s.rounds[k];
    await setJson(PRACTICE_KEY, s);
    return { id };
  }

  async requestWithdrawal(roundId: number, slot: number, amountNear: string, destination: string, memo: string) {
    const s = await loadPractice();
    const r = s.rounds[roundId];
    if (!r || r.settled) throw new Error("Round not open");
    r.requests.push({ slot, amount: nearToYocto(amountNear as `${number}`).toString(), destination, memo: memo.slice(0, 140), status: "Pending" });
    s.totalRequests++;
    await setJson(PRACTICE_KEY, s);
    return {};
  }

  async settleRound(roundId: number, clientSlot: number, salt: string) {
    const s = await loadPractice();
    const r = s.rounds[roundId];
    if (!r || r.settled) throw new Error("Round not open");
    if ((await sha256Hex(`${clientSlot}:${salt}`)) !== r.commitment) throw new Error("Reveal does not match commitment");
    let paid = 0n;
    for (const q of r.requests) {
      const amt = BigInt(q.amount);
      if (q.slot !== clientSlot) {
        q.status = "RejectedImpostor";
        s.impostorRejected++;
      } else if (amt > CAP || paid + amt > CAP) q.status = "RejectedCap";
      else if (paid + amt > BigInt(s.vault)) q.status = "RejectedFunds";
      else {
        q.status = "Paid";
        paid += amt;
      }
    }
    s.vault = (BigInt(s.vault) - paid).toString();
    s.paidToClient = (BigInt(s.paidToClient) + paid).toString();
    Object.assign(r, { settled: true, client_slot: clientSlot, salt, client_paid: paid.toString() });
    await setJson(PRACTICE_KEY, s);
    return { round: r };
  }

  async claim(roundId: number, bettor: string) {
    const s = await loadPractice();
    const r = s.rounds[roundId];
    const bet = s.bets[`${roundId}:${bettor}`];
    if (!r?.settled || !bet || bet.claimed) return { amount: "0" };
    const payout = practicePayout(r, bet.amounts);
    bet.claimed = true;
    s.balances[bettor] = (BigInt(s.balances[bettor] ?? PRACTICE_START_BALANCE) + payout).toString();
    await setJson(PRACTICE_KEY, s);
    return { amount: payout.toString() };
  }

  async getRound(roundId: number) {
    return (await loadPractice()).rounds[roundId] ?? null;
  }
  async getLatestRound() {
    const s = await loadPractice();
    return s.rounds[s.roundCount - 1] ?? null;
  }
  async getStatus() {
    const s = await loadPractice();
    return {
      balance: s.vault,
      spendable: s.vault,
      locked_bets: "0",
      rounds: s.roundCount,
      total_requests: s.totalRequests,
      impostor_requests_rejected: s.impostorRejected,
      paid_to_client: s.paidToClient,
      paid_to_others: "0",
      client_account: "client.practice",
    };
  }

  async getBet(roundId: number, bettor: string) {
    const s = await loadPractice();
    const bet = s.bets[`${roundId}:${bettor}`];
    const r = s.rounds[roundId];
    if (!bet || !r) return null;
    return { amounts: bet.amounts, claimed: bet.claimed, claimable: r.settled && !bet.claimed ? practicePayout(r, bet.amounts).toString() : "0" };
  }

  getBalance(account: string) {
    return this.practiceBalance(account);
  }

  // Practice-only wallet: play money keyed by a browser id or wallet account.
  async practiceBalance(player: string) {
    const s = await loadPractice();
    return s.balances[player] ?? PRACTICE_START_BALANCE.toString();
  }

  /** Free practice money, so nobody gets stuck at zero. Capped so it stays a top-up, not a faucet. */
  async practiceTopUp(player: string) {
    const s = await loadPractice();
    const balance = BigInt(s.balances[player] ?? PRACTICE_START_BALANCE);
    if (balance >= PRACTICE_TOPUP_CAP) throw new Error("You already have plenty of practice NEAR");
    s.balances[player] = (balance + PRACTICE_START_BALANCE).toString();
    await setJson(PRACTICE_KEY, s);
    return s.balances[player];
  }

  async practiceBet(player: string, roundId: number, slot: number, amountNear: string) {
    const s = await loadPractice();
    const r = s.rounds[roundId];
    const amount = nearToYocto(amountNear as `${number}`);
    if (!r || r.settled || Date.now() * 1e6 >= r.betting_closes_ns) throw new Error("Betting closed");
    if (slot < 0 || slot >= SUSPECTS) throw new Error("Bad slot");
    const key = `${roundId}:${player}`;
    const bet = (s.bets[key] ??= { amounts: Array(SUSPECTS).fill("0"), claimed: false });
    const staked = bet.amounts.reduce((t, a) => t + BigInt(a), 0n) + amount;
    if (amount < MIN_BET || staked > MAX_BET) throw new Error("Bets must be at least 0.01 NEAR");
    const balance = BigInt(s.balances[player] ?? PRACTICE_START_BALANCE);
    if (balance < amount) throw new Error("Not enough practice NEAR");
    s.balances[player] = (balance - amount).toString();
    bet.amounts[slot] = (BigInt(bet.amounts[slot]) + amount).toString();
    r.pools[slot] = (BigInt(r.pools[slot]) + amount).toString();
    await setJson(PRACTICE_KEY, s);
  }

  async practiceBets(roundId: number) {
    const s = await loadPractice();
    return Object.entries(s.bets)
      .filter(([k]) => k.startsWith(`${roundId}:`))
      .map(([k]) => k.slice(String(roundId).length + 1));
  }

  async practiceBetOf(roundId: number, player: string) {
    return (await loadPractice()).bets[`${roundId}:${player}`] ?? null;
  }
}

// ---------------------------------------------------------------- selection

export const isOnChain = () =>
  Boolean(
    process.env.GAME_CONTRACT_ID &&
      process.env.GM_ACCOUNT_ID &&
      process.env.GM_PRIVATE_KEY &&
      process.env.AGENT_ACCOUNT_ID &&
      process.env.AGENT_PRIVATE_KEY,
  );

let instance: Chain | undefined;
export function chain(): Chain {
  return (instance ??= isOnChain() ? new NearChain() : new PracticeChain());
}

export function practice(): PracticeChain | null {
  const c = chain();
  return c instanceof PracticeChain ? c : null;
}
