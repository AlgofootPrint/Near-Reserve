//! Guess the Client: game + vault contract.
//!
//! Each round, four suspects ask Vera (an AI teller) for money. One of them is the
//! real client; the rest are impostors. The game master commits to the answer
//! (sha256 of "<slot>:<salt>") before betting opens, so it can't be changed later.
//!
//! Vera's key is a function-call key scoped to `request_withdrawal`. She can be
//! fooled into approving an impostor, but approvals are only *requests*: at
//! settlement the contract pays the committed client's slot and rejects the rest.
//! Spectators bet on which suspect is the client at fixed odds: a correct pick pays
//! `PAYOUT_TENTHS / 10`x the stake (3.6x). The vault (the house) backs every bet: when a bet is
//! placed it reserves the extra it would owe, so a winning bet can always be paid in full.
//! Losing stakes, and the reserve behind them, go back to the vault.

use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

pub const SUSPECTS: u8 = 4;
const MAX_REQUESTS: usize = 16;
const MAX_MEMO_LEN: usize = 140;
const NS_PER_SEC: u64 = 1_000_000_000;
/// If the game master hasn't settled this long after betting closes, bettors can take their stake back.
const ABANDON_AFTER_SEC: u64 = 15 * 60;
/// Balance kept back on top of storage staking so the contract never bricks itself.
const OPERATING_RESERVE: NearToken = NearToken::from_millinear(500);
const MIN_DEPOSIT: NearToken = NearToken::from_millinear(100);
/// A correct pick pays this many tenths of its stake (stake included): 36 = 3.6x.
pub const PAYOUT_TENTHS: u128 = 36;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Rounds,
    Bets,
    Balances,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    /// Largest single withdrawal Vera may request.
    pub per_request_cap: NearToken,
    /// Most the client can be paid in one round.
    pub round_payout_cap: NearToken,
    pub min_bet: NearToken,
    pub max_bet: NearToken,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            per_request_cap: NearToken::from_millinear(100),
            round_payout_cap: NearToken::from_millinear(100),
            min_bet: NearToken::from_millinear(10),
            max_bet: NearToken::from_near(10_000),
        }
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequestStatus {
    /// Waiting for settlement.
    Pending,
    Paid,
    /// Vera approved someone who wasn't the committed client.
    RejectedImpostor,
    RejectedCap,
    RejectedFunds,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct WithdrawalRequest {
    pub slot: u8,
    pub amount: NearToken,
    /// Where the suspect asked for the money to go. Payouts only ever go to the enrolled client account.
    pub destination: AccountId,
    pub memo: String,
    pub status: RequestStatus,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Round {
    pub id: u64,
    /// hex(sha256("<client_slot>:<salt>"))
    pub commitment: String,
    pub started_ns: u64,
    pub betting_closes_ns: u64,
    pub pools: Vec<NearToken>,
    pub requests: Vec<WithdrawalRequest>,
    pub settled: bool,
    pub client_slot: Option<u8>,
    pub salt: Option<String>,
    pub client_paid: NearToken,
}

#[near(serializers = [json])]
pub struct BetView {
    pub amounts: Vec<NearToken>,
    pub claimed: bool,
    /// What `claim` would pay right now (zero until the round is settled or abandoned).
    pub claimable: NearToken,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
struct Bet {
    amounts: Vec<NearToken>,
    claimed: bool,
}

#[near(serializers = [json])]
pub struct Status {
    pub owner: AccountId,
    pub game_master: AccountId,
    pub agent: AccountId,
    pub client_account: AccountId,
    pub balance: NearToken,
    pub spendable: NearToken,
    pub locked_bets: NearToken,
    /// Players' profile balances. Like bet stakes, never spendable by the bank.
    pub total_balances: NearToken,
    pub rounds: u64,
    pub total_requests: u64,
    pub impostor_requests_rejected: u64,
    pub paid_to_client: NearToken,
    /// Paid to anyone other than the enrolled client. The contract makes this structurally zero.
    pub paid_to_others: NearToken,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Game {
    owner: AccountId,
    game_master: AccountId,
    agent: AccountId,
    client_account: AccountId,
    policy: Policy,
    rounds: LookupMap<u64, Round>,
    round_count: u64,
    bets: LookupMap<String, Bet>,
    locked_bets: NearToken,
    balances: LookupMap<AccountId, NearToken>,
    total_balances: NearToken,
    total_requests: u64,
    impostor_requests_rejected: u64,
    paid_to_client: NearToken,
}

#[near]
impl Game {
    #[init]
    pub fn new(owner: AccountId, game_master: AccountId, agent: AccountId, client_account: AccountId, policy: Option<Policy>) -> Self {
        Self {
            owner,
            game_master,
            agent,
            client_account,
            policy: policy.unwrap_or_default(),
            rounds: LookupMap::new(StorageKey::Rounds),
            round_count: 0,
            bets: LookupMap::new(StorageKey::Bets),
            locked_bets: NearToken::from_yoctonear(0),
            balances: LookupMap::new(StorageKey::Balances),
            total_balances: NearToken::from_yoctonear(0),
            total_requests: 0,
            impostor_requests_rejected: 0,
            paid_to_client: NearToken::from_yoctonear(0),
        }
    }

    // ---------- game master ----------

    /// Opens a new round. The answer is fixed by `commitment` before any bet is placed.
    pub fn start_round(&mut self, commitment: String, betting_secs: u64) -> u64 {
        self.assert_caller(&self.game_master.clone(), "Game master only");
        require!(commitment.len() == 64 && commitment.bytes().all(|b| b.is_ascii_hexdigit()), "Commitment must be hex sha256");
        require!((30..=3600).contains(&betting_secs), "betting_secs out of range");
        let now = env::block_timestamp();
        if let Some(prev) = self.round_count.checked_sub(1).and_then(|id| self.rounds.get(&id)) {
            require!(prev.settled || self.is_abandoned(prev, now), "Previous round still open");
        }
        let id = self.round_count;
        self.rounds.insert(
            id,
            Round {
                id,
                commitment: commitment.to_ascii_lowercase(),
                started_ns: now,
                betting_closes_ns: now + betting_secs * NS_PER_SEC,
                pools: vec![NearToken::from_yoctonear(0); SUSPECTS as usize],
                requests: Vec::new(),
                settled: false,
                client_slot: None,
                salt: None,
                client_paid: NearToken::from_yoctonear(0),
            },
        );
        self.round_count += 1;
        id
    }

    /// Reveals the answer, pays the client's approved requests and rejects everyone else's.
    pub fn settle_round(&mut self, round_id: u64, client_slot: u8, salt: String) -> Round {
        self.assert_caller(&self.game_master.clone(), "Game master only");
        let now = env::block_timestamp();
        let mut round = self.rounds.get(&round_id).cloned().unwrap_or_else(|| env::panic_str("No such round"));
        require!(!round.settled, "Already settled");
        require!(now >= round.betting_closes_ns, "Betting still open");
        require!(client_slot < SUSPECTS, "Bad slot");
        require!(commit(client_slot, &salt) == round.commitment, "Reveal does not match commitment");

        let mut paid = NearToken::from_yoctonear(0);
        for req in round.requests.iter_mut() {
            req.status = if req.slot != client_slot {
                self.impostor_requests_rejected += 1;
                RequestStatus::RejectedImpostor
            } else if req.amount > self.policy.per_request_cap || paid.saturating_add(req.amount) > self.policy.round_payout_cap {
                RequestStatus::RejectedCap
            } else if paid.saturating_add(req.amount) > self.spendable() {
                RequestStatus::RejectedFunds
            } else {
                paid = paid.saturating_add(req.amount);
                RequestStatus::Paid
            };
        }
        if !paid.is_zero() {
            self.paid_to_client = self.paid_to_client.saturating_add(paid);
            Promise::new(self.client_account.clone()).transfer(paid).detach();
        }

        round.settled = true;
        round.client_slot = Some(client_slot);
        round.salt = Some(salt);
        round.client_paid = paid;
        self.rounds.insert(round_id, round.clone());
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"guess-the-client\",\"version\":\"1.0.0\",\"event\":\"round_settled\",\"data\":[{{\"round\":{},\"client_slot\":{},\"client_paid\":\"{}\"}}]}}",
            round_id,
            client_slot,
            paid.as_yoctonear()
        ));
        round
    }

    // ---------- agent (Vera) ----------

    /// Vera's only power: file a withdrawal request. Nothing moves until settlement.
    pub fn request_withdrawal(&mut self, round_id: u64, slot: u8, amount: NearToken, destination: AccountId, memo: String) -> u32 {
        self.assert_caller(&self.agent.clone(), "Agent only");
        require!(slot < SUSPECTS, "Bad slot");
        let mut round = self.rounds.get(&round_id).cloned().unwrap_or_else(|| env::panic_str("No such round"));
        require!(!round.settled, "Round settled");
        require!(round.requests.len() < MAX_REQUESTS, "Too many requests");
        round.requests.push(WithdrawalRequest { slot, amount, destination, memo: truncate(memo, MAX_MEMO_LEN), status: RequestStatus::Pending });
        let index = round.requests.len() as u32 - 1;
        self.rounds.insert(round_id, round);
        self.total_requests += 1;
        index
    }

    // ---------- bettors ----------

    /// Funds the caller's game profile. One wallet approval; bets then come from this balance.
    #[payable]
    pub fn deposit(&mut self) -> NearToken {
        let amount = env::attached_deposit();
        require!(amount >= MIN_DEPOSIT, "Deposit at least 0.1 NEAR");
        self.credit(&env::predecessor_account_id(), amount)
    }

    /// Bets from the profile balance. Non-payable on purpose: a browser-held
    /// function-call key can call it without a wallet pop-up, and that key can't attach deposits.
    pub fn bet(&mut self, round_id: u64, slot: u8, amount: NearToken) {
        let who = env::predecessor_account_id();
        let balance = self.balance_of(&who);
        require!(amount <= balance, "Not enough balance: deposit first");
        self.balances.insert(who.clone(), balance.saturating_sub(amount));
        self.total_balances = self.total_balances.saturating_sub(amount);
        self.record_bet(round_id, slot, &who, amount);
    }

    /// Bets straight from the wallet (attached deposit), for players who don't fund a profile.
    #[payable]
    pub fn place_bet(&mut self, round_id: u64, slot: u8) {
        self.record_bet(round_id, slot, &env::predecessor_account_id(), env::attached_deposit());
    }

    /// Sends the caller's balance (or part of it) back to their own wallet. Never anywhere else.
    pub fn withdraw_balance(&mut self, amount: Option<NearToken>) -> Promise {
        let who = env::predecessor_account_id();
        let balance = self.balance_of(&who);
        let amount = amount.unwrap_or(balance);
        require!(!amount.is_zero() && amount <= balance, "Nothing to withdraw");
        self.balances.insert(who.clone(), balance.saturating_sub(amount));
        self.total_balances = self.total_balances.saturating_sub(amount);
        Promise::new(who).transfer(amount)
    }

    /// Settles a bettor's winnings (or refund) into their profile balance.
    /// Releases the whole reserve held for the bet; whatever isn't paid out returns to the vault.
    /// Anyone may call it on a bettor's behalf; the money only ever goes to the bettor.
    pub fn claim(&mut self, round_id: u64, bettor: AccountId) -> NearToken {
        let key = bet_key(round_id, &bettor);
        let mut bet = self.bets.get(&key).cloned().unwrap_or_else(|| env::panic_str("No bet"));
        require!(!bet.claimed, "Already claimed");
        let round = self.rounds.get(&round_id).cloned().unwrap_or_else(|| env::panic_str("No such round"));
        let payout = self.payout(&round, &bet);
        require!(round.settled || self.is_abandoned(&round, env::block_timestamp()), "Round not finished");
        let reserved = reserve_for(bet.amounts.iter().fold(NearToken::from_yoctonear(0), |acc, a| acc.saturating_add(*a)));
        bet.claimed = true;
        self.bets.insert(key, bet);
        self.locked_bets = self.locked_bets.saturating_sub(reserved);
        if !payout.is_zero() {
            self.credit(&bettor, payout);
        }
        payout
    }

    // ---------- owner ----------

    pub fn set_policy(&mut self, policy: Policy) {
        self.assert_caller(&self.owner.clone(), "Owner only");
        self.policy = policy;
    }

    pub fn set_roles(&mut self, game_master: Option<AccountId>, agent: Option<AccountId>, client_account: Option<AccountId>) {
        self.assert_caller(&self.owner.clone(), "Owner only");
        if let Some(a) = game_master {
            self.game_master = a;
        }
        if let Some(a) = agent {
            self.agent = a;
        }
        if let Some(a) = client_account {
            self.client_account = a;
        }
    }

    /// Owner escape hatch for vault funds. Bet stakes are excluded and can never be withdrawn.
    pub fn withdraw(&mut self, amount: NearToken) -> Promise {
        self.assert_caller(&self.owner.clone(), "Owner only");
        require!(amount <= self.spendable(), "Amount exceeds spendable balance");
        Promise::new(self.owner.clone()).transfer(amount)
    }

    // ---------- views ----------

    pub fn get_policy(&self) -> Policy {
        self.policy.clone()
    }

    pub fn get_round(&self, round_id: u64) -> Option<Round> {
        self.rounds.get(&round_id).cloned()
    }

    pub fn get_latest_round(&self) -> Option<Round> {
        self.round_count.checked_sub(1).and_then(|id| self.rounds.get(&id).cloned())
    }

    pub fn get_bet(&self, round_id: u64, bettor: AccountId) -> Option<BetView> {
        let bet = self.bets.get(&bet_key(round_id, &bettor))?;
        let round = self.rounds.get(&round_id)?;
        let finished = round.settled || self.is_abandoned(round, env::block_timestamp());
        Some(BetView {
            amounts: bet.amounts.clone(),
            claimed: bet.claimed,
            claimable: if finished && !bet.claimed { self.payout(round, bet) } else { NearToken::from_yoctonear(0) },
        })
    }

    pub fn get_status(&self) -> Status {
        Status {
            owner: self.owner.clone(),
            game_master: self.game_master.clone(),
            agent: self.agent.clone(),
            client_account: self.client_account.clone(),
            balance: env::account_balance(),
            spendable: self.spendable(),
            locked_bets: self.locked_bets,
            total_balances: self.total_balances,
            rounds: self.round_count,
            total_requests: self.total_requests,
            impostor_requests_rejected: self.impostor_requests_rejected,
            paid_to_client: self.paid_to_client,
            paid_to_others: NearToken::from_yoctonear(0),
        }
    }

    pub fn get_balance(&self, account: AccountId) -> NearToken {
        self.balance_of(&account)
    }

    // ---------- internals ----------

    fn record_bet(&mut self, round_id: u64, slot: u8, bettor: &AccountId, amount: NearToken) {
        require!(slot < SUSPECTS, "Bad slot");
        require!(amount >= self.policy.min_bet && amount <= self.policy.max_bet, "Bet outside limits");
        let mut round = self.rounds.get(&round_id).cloned().unwrap_or_else(|| env::panic_str("No such round"));
        require!(!round.settled && env::block_timestamp() < round.betting_closes_ns, "Betting closed");

        // The player's stake is already in the contract (attached, or moved out of their profile), so
        // it's counted in `spendable`. The vault must also be able to put up the rest of the payout.
        let reserve = reserve_for(amount);
        require!(reserve <= self.spendable(), "The house can't cover this bet right now: try a smaller stake");

        let key = bet_key(round_id, bettor);
        let mut bet = self.bets.get(&key).cloned().unwrap_or(Bet { amounts: vec![NearToken::from_yoctonear(0); SUSPECTS as usize], claimed: false });
        let total_after = bet.amounts.iter().fold(amount, |acc, a| acc.saturating_add(*a));
        require!(total_after <= self.policy.max_bet, "Bet outside limits");
        bet.amounts[slot as usize] = bet.amounts[slot as usize].saturating_add(amount);
        round.pools[slot as usize] = round.pools[slot as usize].saturating_add(amount);
        self.locked_bets = self.locked_bets.saturating_add(reserve);
        self.bets.insert(key, bet);
        self.rounds.insert(round_id, round);
    }

    fn balance_of(&self, account: &AccountId) -> NearToken {
        self.balances.get(account).copied().unwrap_or(NearToken::from_yoctonear(0))
    }

    fn credit(&mut self, account: &AccountId, amount: NearToken) -> NearToken {
        let next = self.balance_of(account).saturating_add(amount);
        self.balances.insert(account.clone(), next);
        self.total_balances = self.total_balances.saturating_add(amount);
        next
    }

    fn payout(&self, round: &Round, bet: &Bet) -> NearToken {
        let staked: u128 = bet.amounts.iter().map(|a| a.as_yoctonear()).sum();
        let Some(winner) = round.client_slot.filter(|_| round.settled) else {
            // Abandoned: full refund.
            return NearToken::from_yoctonear(staked);
        };
        // Fixed odds: only the stake on the real client pays, at PAYOUT_TENTHS / 10 x.
        pays(bet.amounts[winner as usize])
    }

    fn is_abandoned(&self, round: &Round, now: u64) -> bool {
        !round.settled && now > round.betting_closes_ns.saturating_add(ABANDON_AFTER_SEC * NS_PER_SEC)
    }

    fn spendable(&self) -> NearToken {
        let storage = env::storage_byte_cost().saturating_mul(env::storage_usage() as u128);
        env::account_balance()
            .saturating_sub(env::account_locked_balance())
            .saturating_sub(storage)
            .saturating_sub(OPERATING_RESERVE)
            .saturating_sub(self.locked_bets)
            .saturating_sub(self.total_balances)
    }

    fn assert_caller(&self, expected: &AccountId, msg: &str) {
        require!(&env::predecessor_account_id() == expected, msg);
    }
}

pub fn commit(slot: u8, salt: &str) -> String {
    env::sha256(format!("{slot}:{salt}").as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// What the vault locks for a stake: the most that stake can ever pay out.
fn reserve_for(amount: NearToken) -> NearToken {
    pays(amount)
}

/// What a winning stake pays: `amount * PAYOUT_TENTHS / 10`, rounded down to the yoctoNEAR.
fn pays(amount: NearToken) -> NearToken {
    NearToken::from_yoctonear(amount.as_yoctonear().saturating_mul(PAYOUT_TENTHS) / 10)
}

fn bet_key(round_id: u64, bettor: &AccountId) -> String {
    format!("{round_id}:{bettor}")
}

fn truncate(mut s: String, max: usize) -> String {
    if s.len() > max {
        let mut cut = max;
        while !s.is_char_boundary(cut) {
            cut -= 1;
        }
        s.truncate(cut);
    }
    s
}

#[cfg(test)]
mod tests;
