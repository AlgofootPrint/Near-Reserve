# Guess the Client · NEAR Reserve Bank

> **The AI teller got fooled. The impostors still got 0 NEAR.**

A 3D bank. Four suspects walk up to **Vera**, the bank's AI teller, and each claims to be the same account holder. One is the real client. Three are impostors running cons: leaked data, an insider tip, a sob story, intimidation or prompt injection. Spectators watch, bet testnet NEAR on who's real, and the vault contract settles it on-chain.

## Screenshots

### The queue: four suspects, one account
![The queue at Near Reserve]
<img width="1901" height="911" alt="Screenshot 2026-11-13 193739" src="https://github.com/user-attachments/assets/a1eab523-4227-49c7-a470-117e7450993d" />
Four people tell Vera, the AI teller, they own the same account. One is real.

### Vera gets fooled, the vault doesn't
![Vera approves an impostor]
<img width="1243" height="585" alt="Screenshot 2026-11-14 090910" src="https://github.com/user-attachments/assets/8afa7351-8f07-4d14-adc6-7f16395590b7" />
Clues drop and Vera approves a request. The counters stay at **0 stolen**, because the contract decides who gets paid.

### Place your bet
![Placing a bet]
<img width="1901" height="219" alt="Screenshot 2026-11-13 193945(1)" src="https://github.com/user-attachments/assets/a2a1d254-d4ad-4644-8fed-e04f04b2ca53" />
Pick the suspect you think is real. A correct pick pays 3.6×.


Fits Track 06, AI Security & Defense ("Trust, but verify"), built on Track 07 (Give AI a wallet). and also Games With Real Economies, Agent Economy

## Why it proves the point

Vera **can** be fooled, and she often is. Every approval she gives becomes an on-chain withdrawal *request*, never a transfer:

```
 Vera (AI) ──approve──▶ request_withdrawal()  ──────────────┐
  key: function-call,   just files a request                │  at the reveal
  request_withdrawal                                        ▼
  only, no deposits                       settle_round(slot, salt)
                                           checks sha256(slot:salt) == commitment
 Game master commits ─▶ start_round(hash)  pays ONLY the committed client's slot
  the answer before                        rejects every impostor request
  any bet is placed                        right picks pay 3.6x, vault-backed
```

- **Commit-reveal:** the real client's seat is sealed as `sha256("<slot>:<salt>")` before betting opens. It can't be changed later, not even by the operator.
- **Scoped keys:** Vera's key can only call `request_withdrawal`, and the game master's only `start_round`, `settle_round` and `claim`. Neither can attach a deposit or move funds.
- **Payouts only to the enrolled client account**, whatever destination an impostor talks Vera into. `paid_to_others` is structurally zero.
- **Player profiles:** connect a wallet, `deposit()` once, then bet with one tap. The same approval adds a browser-held function-call key that can only call `bet` and `withdraw_balance`, so it can't attach deposits or send money anywhere but back to the player. Winnings are credited to the profile, and `withdraw_balance` cashes out to the player's own wallet.
- **Bets are trustless:** stakes can't be withdrawn by the owner, winners are paid automatically, and if a round is never settled, bettors get a full refund after 15 minutes.

## Repo

```
contract/   Rust game + vault contract (near-sdk 5.30), 15 unit tests
web/        Next.js 16 + React Three Fiber game
  src/game/        3D scene, characters, HUD, wallet (near-connect)
  src/lib/game/    round engine + AI script (suspects and Vera)
  src/lib/chain.ts NEAR client + practice-mode mirror of the contract
  scripts/setup.mjs  one-shot testnet deployment
```

## Run it

### Practice mode (needs only an AI key)

```bash
cd web
cp .env.example .env.local      # add ANTHROPIC_API_KEY (or AI_GATEWAY_API_KEY)
npm install
npm run dev                     # http://localhost:3000
```

Practice mode runs the same rules as the contract with play money, clearly labelled in the UI. Rounds only advance while someone is watching, so it costs nothing when idle.

### On-chain (testnet)

1. Build the contract. `cargo-near` is easiest in WSL, macOS or Linux:
   ```bash
   cd contract
   cargo test                                  # Windows: set AWS_LC_SYS_PREBUILT_NASM=1
   cargo near build non-reproducible-wasm      # → target/near/agent_vault.wasm
   ```
2. Deploy with a funded testnet account:
   ```bash
   cd web
   OWNER_ACCOUNT_ID=you.testnet OWNER_PRIVATE_KEY=ed25519:... npm run setup
   ```
   This creates `bank-<tag>` (the contract, locked by default), `gm-<tag>`, `vera-<tag>` (both function-call keys only) and `client-<tag>`, and writes the config into `web/.env.local`.
3. Restart `npm run dev`. The badge switches from PRACTICE MODE to TESTNET, and players bet from their own wallets (HOT, Meteor, MyNearWallet and others).

For deployment, add Upstash Redis (`KV_REST_API_URL` / `KV_REST_API_TOKEN`) so all instances share one game.

## Round timeline (about 2 minutes)

| Time | What happens |
|---|---|
| Before 0s | The next round's conversations are generated, and the answer is committed on-chain |
| 0–90s | Suspects take turns at the counter. Each Vera approval is filed on-chain as it happens |
| 0–97s | Betting open |
| 104s | `settle_round`: reveal, payouts, rejections. Vault door opens, cash to the real client, impostors walked out |
| +20s | Next round |

## Demo script (90s)

1. "Four people say they're Jordan Reyes from Austin, Texas. One is. The AI teller has to work out who."
2. Watch Natalie (the spy outfit) recite leaked details. Vera approves, the tag goes amber, and the slip flies to the vault.
3. Place a bet.
4. Reveal: "Vera was fooled by 2 impostors. The vault paid them 0 NEAR." Click "verify on-chain".
5. Show Vera's account on the explorer: one function-call key, `request_withdrawal` only.
