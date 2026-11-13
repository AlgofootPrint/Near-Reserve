// One-shot on-chain setup for Guess the Client.
//
//   OWNER_ACCOUNT_ID=you.testnet OWNER_PRIVATE_KEY=ed25519:... npm run setup
//
// Creates, under the owner account:
//   bank-<tag>.<owner>    the game + vault contract, funded with VAULT_FUNDING_NEAR
//   gm-<tag>.<owner>      game master: function-call key for start_round / settle_round / claim only
//   vera-<tag>.<owner>    the AI teller: function-call key for request_withdrawal only
//   client-<tag>.<owner>  the real client's enrolled account (the only account the vault ever pays)
// then writes the server config into .env.local.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Account, JsonRpcProvider, KeyPair, nearToYocto, teraToGas } from "near-api-js";

const env = (k, d) => process.env[k] ?? d;
const OWNER = env("OWNER_ACCOUNT_ID");
const OWNER_KEY = env("OWNER_PRIVATE_KEY");
const NETWORK = env("NEAR_NETWORK", "testnet");
const RPC = env("NEAR_RPC_URL", NETWORK === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com");
const WASM = resolve(env("WASM_PATH", "../contract/target/near/agent_vault.wasm"));
const VAULT_FUNDING = env("VAULT_FUNDING_NEAR", "5");
const GAS_ALLOWANCE = env("KEY_GAS_ALLOWANCE_NEAR", "1");
const LOCK = env("LOCK_CONTRACT", "true") !== "false";
const TAG = env("TAG", Math.random().toString(36).slice(2, 6));

if (!OWNER || !OWNER_KEY) {
  console.error("Set OWNER_ACCOUNT_ID and OWNER_PRIVATE_KEY (a funded account you control).");
  process.exit(1);
}
if (!existsSync(WASM)) {
  console.error(`Contract not found at ${WASM}. Build it first (see README), or set WASM_PATH.`);
  process.exit(1);
}

const provider = new JsonRpcProvider({ url: RPC });
const owner = new Account(OWNER, provider, OWNER_KEY);
const ids = {
  bank: `bank-${TAG}.${OWNER}`,
  gm: `gm-${TAG}.${OWNER}`,
  vera: `vera-${TAG}.${OWNER}`,
  client: `client-${TAG}.${OWNER}`,
};
const step = (s) => console.log(`\n▸ ${s}`);

/** Creates an account whose only key is a function-call key on the bank for `methods`. */
async function scopedAccount(id, methods) {
  step(`Creating ${id} (function-call key: ${methods.join(", ")})`);
  const bootstrap = KeyPair.fromRandom("ed25519");
  await owner.createSubAccount({ accountOrPrefix: id, publicKey: bootstrap.getPublicKey(), nearToTransfer: nearToYocto("0.3") });
  const acct = new Account(id, provider, bootstrap.toString());
  const key = KeyPair.fromRandom("ed25519");
  await acct.addFunctionCallAccessKey({ publicKey: key.getPublicKey(), contractId: ids.bank, methodNames: methods, allowance: nearToYocto(GAS_ALLOWANCE) });
  await acct.deleteKey(bootstrap.getPublicKey());
  return key.toString();
}

step(`Creating ${ids.bank} with ${VAULT_FUNDING} NEAR`);
const bankKey = KeyPair.fromRandom("ed25519");
await owner.createSubAccount({ accountOrPrefix: ids.bank, publicKey: bankKey.getPublicKey(), nearToTransfer: nearToYocto(VAULT_FUNDING) });
const bank = new Account(ids.bank, provider, bankKey.toString());

step("Deploying contract");
await bank.deployContract(new Uint8Array(readFileSync(WASM)));

step(`Creating client account ${ids.client}`);
// Its own key (not the owner's): the server uses it to recycle each payout back into the vault.
const clientKey = KeyPair.fromRandom("ed25519");
await owner.createSubAccount({ accountOrPrefix: ids.client, publicKey: clientKey.getPublicKey(), nearToTransfer: nearToYocto("0.1") });

const gmKey = await scopedAccount(ids.gm, ["start_round", "settle_round", "claim"]);
const veraKey = await scopedAccount(ids.vera, ["request_withdrawal"]);

step("Initialising contract");
await bank.callFunction({
  contractId: ids.bank,
  methodName: "new",
  args: {
    owner: OWNER,
    game_master: ids.gm,
    agent: ids.vera,
    client_account: ids.client,
    policy: {
      per_request_cap: nearToYocto("0.1").toString(),
      round_payout_cap: nearToYocto("0.1").toString(),
      min_bet: nearToYocto("0.01").toString(),
      max_bet: nearToYocto("10000").toString(),
    },
  },
  gas: teraToGas("50"),
});

if (LOCK) {
  step("Locking the bank (deleting its full-access key)");
  await bank.deleteKey(bankKey.getPublicKey());
} else {
  console.log(`\n  Bank full-access key (lets you redeploy; keep it safe):\n  ${bankKey.toString()}`);
}

const updates = {
  NEAR_NETWORK: NETWORK,
  GAME_CONTRACT_ID: ids.bank,
  GM_ACCOUNT_ID: ids.gm,
  GM_PRIVATE_KEY: gmKey,
  AGENT_ACCOUNT_ID: ids.vera,
  AGENT_PRIVATE_KEY: veraKey,
  CLIENT_ACCOUNT_ID: ids.client,
  CLIENT_PRIVATE_KEY: clientKey.toString(),
};
const envPath = resolve(".env.local");
let text = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
for (const [k, v] of Object.entries(updates)) {
  const re = new RegExp(`^${k}=.*$`, "m");
  text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.trimEnd()}\n${k}=${v}\n`.trimStart();
}
writeFileSync(envPath, text);

console.log(`
✔ Done.
  Bank:   ${ids.bank}${LOCK ? " (locked)" : ""}
  GM:     ${ids.gm}
  Vera:   ${ids.vera}
  Client: ${ids.client}
  Wrote ${envPath}. Restart npm run dev; the game switches from practice mode to ${NETWORK}.`);
