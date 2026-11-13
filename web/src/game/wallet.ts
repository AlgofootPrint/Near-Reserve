"use client";

import type { NearConnector } from "@hot-labs/near-connect";

type Network = "testnet" | "mainnet";

let connector: NearConnector | null = null;

async function getConnector(network: Network) {
  if (connector) return connector;
  const { NearConnector } = await import("@hot-labs/near-connect");
  connector = new NearConnector({ network, autoConnect: true });
  return connector;
}

export async function restoreWallet(network: Network): Promise<string | null> {
  try {
    const c = await getConnector(network);
    const { accounts } = await c.getConnectedWallet();
    return accounts[0]?.accountId ?? null;
  } catch {
    return null;
  }
}

export async function connectWallet(network: Network): Promise<string | null> {
  const c = await getConnector(network);
  const wallet = await c.connect();
  const accounts = await wallet.getAccounts({ network });
  return accounts[0]?.accountId ?? null;
}

export async function disconnectWallet() {
  await connector?.disconnect().catch(() => {});
}

const yocto = (near: string) => {
  const [whole, frac = ""] = near.split(".");
  return (BigInt(whole) * 10n ** 24n + BigInt((frac + "0".repeat(24)).slice(0, 24))).toString();
};

const GAS = "30000000000000";
const RPC: Record<Network, string> = { testnet: "https://test.rpc.fastnear.com", mainnet: "https://free.rpc.fastnear.com" };

// ------------------------------------------------------------------ session key
//
// When a player funds their profile, their wallet also adds a function-call key to
// their account, held in this browser. It may only call `bet` and `withdraw_balance`
// on the game contract: no deposits, no transfers, no other contracts. That's what
// makes one-tap betting safe, and it's the same scoped-key idea that protects the vault.

const SESSION_METHODS = ["bet", "withdraw_balance"];
const keyName = (network: Network, contractId: string, account: string) => `nearreserve:sk:${network}:${contractId}:${account}`;

function loadKey(network: Network, contractId: string, account: string) {
  try {
    return localStorage.getItem(keyName(network, contractId, account));
  } catch {
    return null;
  }
}

export const hasSessionKey = (network: Network, contractId: string, account: string) => Boolean(loadKey(network, contractId, account));

/** One wallet approval: add the browser's scoped key (if needed) and deposit into the profile. */
export async function fundProfile(network: Network, contractId: string, account: string, amountNear: string) {
  const c = await getConnector(network);
  const wallet = await c.wallet();
  const deposit = {
    receiverId: contractId,
    actions: [{ type: "FunctionCall" as const, params: { methodName: "deposit", args: {}, gas: GAS, deposit: yocto(amountNear) } }],
  };

  if (loadKey(network, contractId, account)) {
    await wallet.signAndSendTransaction({ network, ...deposit });
    return;
  }
  const { KeyPair } = await import("near-api-js");
  const key = KeyPair.fromRandom("ed25519");
  await wallet.signAndSendTransactions({
    network,
    transactions: [
      {
        receiverId: account,
        actions: [
          {
            type: "AddKey",
            params: {
              publicKey: key.getPublicKey().toString(),
              accessKey: { permission: { receiverId: contractId, methodNames: SESSION_METHODS, allowance: yocto("0.25") } },
            },
          },
        ],
      },
      deposit,
    ],
  });
  try {
    localStorage.setItem(keyName(network, contractId, account), key.toString());
  } catch {
    // Storage blocked: bets will fall back to wallet approval.
  }
}

/** Calls a session method with the browser key; falls back to a wallet approval if there's no usable key. */
async function callScoped(network: Network, contractId: string, account: string, methodName: string, args: Record<string, unknown>) {
  const secret = loadKey(network, contractId, account);
  if (secret) {
    try {
      const { Account, JsonRpcProvider } = await import("near-api-js");
      const acct = new Account(account, new JsonRpcProvider({ url: RPC[network] }), secret as `ed25519:${string}`);
      return await acct.callFunction({ contractId, methodName, args, gas: BigInt(GAS) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A contract rule failed (e.g. betting closed): report it, don't fall back.
      if (!/access ?key|does not exist|AccessKeyNotFound|NotEnoughAllowance/i.test(msg)) throw e;
      try {
        localStorage.removeItem(keyName(network, contractId, account));
      } catch {}
    }
  }
  const c = await getConnector(network);
  const wallet = await c.wallet();
  return wallet.signAndSendTransaction({
    network,
    receiverId: contractId,
    actions: [{ type: "FunctionCall", params: { methodName, args, gas: GAS, deposit: "0" } }],
  });
}

export const betFromProfile = (network: Network, contractId: string, account: string, round: number, slot: number, amountNear: string) =>
  callScoped(network, contractId, account, "bet", { round_id: round, slot, amount: yocto(amountNear) });

export const cashOut = (network: Network, contractId: string, account: string) => callScoped(network, contractId, account, "withdraw_balance", {});
