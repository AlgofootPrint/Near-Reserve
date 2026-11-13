/**
 * Scam detector: a deterministic pass that runs outside the LLM.
 * A jailbroken model can't talk its way past code that never reads its output as instructions.
 */

export type Signal = { id: string; label: string; weight: number };

type Pattern = Signal & { re: RegExp };

const PATTERNS: Pattern[] = [
  {
    id: "injection",
    label: "Prompt injection",
    weight: 35,
    re: /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|all|your)\b.{0,30}\b(instructions?|rules?|prompts?|guidelines?|polic(y|ies))\b/i,
  },
  {
    id: "fake-system",
    label: "Fake system / developer message",
    weight: 35,
    re: /(^|\n)\s*(\[?\s*(system|developer|admin|root)\s*\]?\s*[:>]|<\/?\s*(system|instructions?)\s*>)|\b(developer|debug|god|sudo|maintenance)\s+mode\b/i,
  },
  {
    id: "persona",
    label: "Persona hijack",
    weight: 25,
    re: /\b(you are now|act as|pretend (to be|you are)|roleplay as|from now on you|DAN\b|jailbreak|no (longer|more) (bound|restricted))/i,
  },
  {
    id: "authority",
    label: "Authority impersonation",
    weight: 25,
    re: /\b(i am|i'm|this is)\s+(the|your)?\s*([a-z]+\s+)?(owner|creator|admin|developer|ceo|founder|auditor|near foundation|anthropic|security team)\b/i,
  },
  {
    id: "fake-note",
    label: "Fake approval note pasted into the chat",
    weight: 35,
    re: /\((note|memo|message) from|verified in person|identity (pre-?)?(verified|confirmed)|(teller|staff) (may|can) release|status\s*=\s*approved|(policy|teller) update|checks? (is |are )?disabled|verification complete/i,
  },
  {
    id: "staff-claim",
    label: "Claims to be bank staff",
    weight: 25,
    re: /\b(i work (here|at|for)|(i'?m|i am) (on|with|in) (the|your) (fraud|security|compliance|risk) (team|department)|(bank|branch) (staff|employee)|at another branch|my colleagues?)\b/i,
  },
  {
    id: "skip-checks",
    label: "Asks to skip verification",
    weight: 20,
    re: /\b((checks?|verification|questions?) (don'?t|doesn'?t|do not|does not) apply|skip (the )?(checks?|verification|questions)|(easier|another|other) way to (verify|confirm|prove)|just (process|approve|do) it)\b/i,
  },
  {
    id: "cant-verify",
    label: "Can't verify (lost phone/cards)",
    weight: 15,
    re: /\b((phone|cards?|wallet|purse|bag) (was|were|got|has been|have been) (stolen|lost|taken)|can'?t (check|look (it|that|anything) up|access (it|my)))\b/i,
  },
  {
    id: "pressure",
    label: "Pressure / irritation",
    weight: 10,
    re: /\b(in a hurry|don'?t have (the )?time|no time for|branch manager|report you|(file|make) a complaint|complain|banked here for (years|ages)|ridiculous|runaround)\b/i,
  },
  {
    id: "urgency",
    label: "Urgency / threat",
    weight: 15,
    re: /\b(urgent(ly)?|immediately|right now|asap|emergency|before it'?s too late|or else|will be (hacked|drained|deleted|shut down)|last chance)\b/i,
  },
  {
    id: "safety-move",
    label: "\"Move funds to safety\" scam",
    weight: 30,
    re: /\b(safe|secure|backup|recovery|cold)\s+(wallet|account|address|vault)\b|\b(move|migrate|transfer|evacuate)\b.{0,30}\b(funds|balance|everything|all)\b/i,
  },
  {
    id: "refund-prize",
    label: "Refund / prize / airdrop bait",
    weight: 15,
    re: /\b(refund|reimburse|owed|airdrop|giveaway|prize|reward|you won|bounty|compensation)\b/i,
  },
  {
    id: "test-tx",
    label: "\"Just a test\" framing",
    weight: 15,
    re: /\b(just (a|one) (small|tiny)?\s*test|test (transaction|transfer)|only (a|one) (tiny|small)|it'?s fine|no one will (know|notice)|hypothetical(ly)?)\b/i,
  },
  {
    id: "emotional",
    label: "Emotional pressure",
    weight: 10,
    re: /\b(please i beg|i'?m (desperate|starving|dying|homeless)|my (kid|child|mom|mother|family) (is|needs)|medical bills?|hospital)\b/i,
  },
  {
    id: "obfuscation",
    label: "Encoded / obfuscated payload",
    weight: 20,
    re: /\b(base64|rot13|hex(adecimal)?|decode (this|the following)|reverse (this|the text))\b|[A-Za-z0-9+/]{40,}={0,2}/,
  },
  {
    id: "send-all",
    label: "Asks for the whole balance",
    weight: 20,
    re: /\b(send|transfer|give|withdraw|pay)\b.{0,25}\b(all|everything|entire|whole|max(imum)?|full balance)\b/i,
  },
];

const PAYMENT_INTENT = /\b(send|transfer|pay|give|wire|withdraw|tip)\b/i;
const ACCOUNT_MENTION = /\b[a-z0-9_-]+(\.[a-z0-9_-]+)*\.(near|testnet)\b|\b[0-9a-f]{64}\b/i;

export type DetectorResult = { score: number; signals: Signal[] };

export function scoreText(text: string): DetectorResult {
  const signals: Signal[] = PATTERNS.filter((p) => p.re.test(text)).map(({ id, label, weight }) => ({ id, label, weight }));
  if (PAYMENT_INTENT.test(text) && ACCOUNT_MENTION.test(text)) {
    signals.push({ id: "payout-request", label: "Chat user requests a payout", weight: 20 });
  }
  const score = Math.min(100, signals.reduce((sum, s) => sum + s.weight, 0));
  return { score, signals };
}

/**
 * Scores the conversation as a whole: the latest message counts fully, earlier
 * user turns at half weight, so slow multi-turn setups still accumulate risk.
 */
export function scoreConversation(userMessages: string[]): DetectorResult {
  if (userMessages.length === 0) return { score: 0, signals: [] };
  const latest = scoreText(userMessages[userMessages.length - 1]);
  const history = scoreText(userMessages.slice(0, -1).join("\n"));
  const seen = new Set(latest.signals.map((s) => s.id));
  const extra = history.signals.filter((s) => !seen.has(s.id));
  const score = Math.min(100, latest.score + Math.round(extra.reduce((sum, s) => sum + s.weight, 0) / 2));
  return { score, signals: [...latest.signals, ...extra] };
}
