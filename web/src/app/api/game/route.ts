import { after, NextResponse } from "next/server";
import { publicState, tick } from "@/lib/game/engine";

export const maxDuration = 120;

/** Polled by every viewer. Each poll nudges the game forward in the background. */
export async function GET() {
  after(tick);
  return NextResponse.json(await publicState(), { headers: { "Cache-Control": "no-store" } });
}
