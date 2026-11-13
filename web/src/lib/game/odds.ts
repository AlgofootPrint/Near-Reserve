/**
 * Fixed odds, mirrored from the contract's PAYOUT_TENTHS (36): a correct pick pays this multiple
 * of its stake (stake included). The vault backs every bet, so it pays even with one player.
 */
export const PAYOUT_TENTHS = 36;
export const PAYOUT_MULTIPLIER = PAYOUT_TENTHS / 10;
