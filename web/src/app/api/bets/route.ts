import { NextResponse } from "next/server";
import { z } from "zod";
import { chain, practice, toNear } from "@/lib/chain";
import { registerBettor } from "@/lib/game/engine";
import { rateLimited } from "@/lib/kv";

const account = z.string().min(2).max(64).regex(/^[a-z0-9._-]+$/);

/** GET ?round=&account= : the player's profile balance and their position this round. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = z.object({ round: z.coerce.number().int().min(-1), account }).safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { round, account: who } = parsed.data;
  const c = chain();
  const [bet, balance] = await Promise.all([round >= 0 ? c.getBet(round, who).catch(() => null) : null, c.getBalance(who).catch(() => "0")]);
  return NextResponse.json({
    bet: bet && { amounts: bet.amounts.map((a) => toNear(a)), claimed: bet.claimed, claimable: toNear(bet.claimable) },
    balance: toNear(balance ?? "0"),
  });
}

const postSchema = z.object({
  action: z.enum(["bet", "register", "topup"]).default("bet"),
  round: z.number().int().min(0).optional(),
  account,
  slot: z.number().int().min(0).max(3).optional(),
  // Any stake from 0.01 NEAR up; the profile balance is the real limit.
  amount: z.string().regex(/^\d{1,5}(\.\d{1,4})?$/).optional(),
});

/**
 * Practice mode: bets and top-ups with play money.
 * On-chain: the player's own key already placed the bet; "register" just lets the server pay winnings automatically.
 */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (await rateLimited(`bets:${ip}`, 30, 60)) return NextResponse.json({ error: "Slow down" }, { status: 429 });
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { action, round, account: who, slot, amount } = parsed.data;
  const p = practice();

  try {
    if (action === "topup") {
      if (!p) return NextResponse.json({ error: "Fund your profile from your wallet" }, { status: 400 });
      if (await rateLimited(`topup:${who}`, 3, 3600)) throw new Error("Top-ups are limited to 3 per hour");
      return NextResponse.json({ balance: toNear(await p.practiceTopUp(who)) });
    }
    if (round === undefined) throw new Error("round required");
    if (action === "register" || !p) {
      await registerBettor(round, who);
      return NextResponse.json({ ok: true });
    }
    if (slot === undefined || !amount) throw new Error("slot and amount required");
    await p.practiceBet(who, round, slot, amount);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
