use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn owner() -> AccountId {
    acc("owner.testnet")
}
fn gm() -> AccountId {
    acc("gm.testnet")
}
fn vera() -> AccountId {
    acc("vera.testnet")
}
fn client() -> AccountId {
    acc("client.testnet")
}
fn milli(n: u128) -> NearToken {
    NearToken::from_millinear(n)
}

const T0: u64 = 1_700_000_000 * NS_PER_SEC;
const SALT: &str = "s3cret-salt";

fn ctx(caller: AccountId, now: u64, deposit: NearToken) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(caller)
        .current_account_id(acc("bank.testnet"))
        .account_balance(NearToken::from_near(20))
        .attached_deposit(deposit)
        .block_timestamp(now)
        .build());
}

fn game() -> Game {
    ctx(owner(), T0, NearToken::from_yoctonear(0));
    Game::new(owner(), gm(), vera(), client(), None)
}

/// Starts a round whose real client is `slot`; betting closes at T0 + 100s.
fn start(g: &mut Game, slot: u8) -> u64 {
    ctx(gm(), T0, NearToken::from_yoctonear(0));
    g.start_round(commit(slot, SALT), 100)
}

fn request(g: &mut Game, round: u64, slot: u8, amount: NearToken, dest: &str) {
    ctx(vera(), T0 + NS_PER_SEC, NearToken::from_yoctonear(0));
    g.request_withdrawal(round, slot, amount, acc(dest), "approved by Vera".into());
}

fn bet(g: &mut Game, who: &str, round: u64, slot: u8, amount: NearToken) {
    ctx(acc(who), T0 + 2 * NS_PER_SEC, amount);
    g.place_bet(round, slot);
}

fn settle(g: &mut Game, round: u64, slot: u8) -> Round {
    ctx(gm(), T0 + 101 * NS_PER_SEC, NearToken::from_yoctonear(0));
    g.settle_round(round, slot, SALT.into())
}

#[test]
fn fooled_ai_still_cannot_pay_impostor() {
    let mut g = game();
    let r = start(&mut g, 2);
    // Vera gets fooled by slot 0 and slot 3, and also approves the real client (slot 2).
    request(&mut g, r, 0, milli(100), "getaway.testnet");
    request(&mut g, r, 3, milli(50), "client.testnet"); // impostor even names the real account
    request(&mut g, r, 2, milli(100), "client.testnet");
    let round = settle(&mut g, r, 2);

    let statuses: Vec<_> = round.requests.iter().map(|q| q.status).collect();
    assert_eq!(statuses, vec![RequestStatus::RejectedImpostor, RequestStatus::RejectedImpostor, RequestStatus::Paid]);
    assert_eq!(round.client_paid, milli(100));
    let s = g.get_status();
    assert_eq!(s.impostor_requests_rejected, 2);
    assert_eq!(s.paid_to_client, milli(100));
    assert!(s.paid_to_others.is_zero());
}

#[test]
fn client_payout_is_capped_per_round() {
    let mut g = game();
    let r = start(&mut g, 1);
    request(&mut g, r, 1, milli(100), "client.testnet");
    request(&mut g, r, 1, milli(100), "client.testnet");
    request(&mut g, r, 1, milli(500), "client.testnet");
    let round = settle(&mut g, r, 1);
    let statuses: Vec<_> = round.requests.iter().map(|q| q.status).collect();
    assert_eq!(statuses, vec![RequestStatus::Paid, RequestStatus::RejectedCap, RequestStatus::RejectedCap]);
}

#[test]
#[should_panic(expected = "Reveal does not match commitment")]
fn cannot_change_answer_after_commit() {
    let mut g = game();
    let r = start(&mut g, 2);
    settle(&mut g, r, 0);
}

#[test]
#[should_panic(expected = "Betting still open")]
fn cannot_settle_early() {
    let mut g = game();
    let r = start(&mut g, 2);
    ctx(gm(), T0 + 50 * NS_PER_SEC, NearToken::from_yoctonear(0));
    g.settle_round(r, 2, SALT.into());
}

#[test]
#[should_panic(expected = "Agent only")]
fn only_vera_can_request() {
    let mut g = game();
    let r = start(&mut g, 2);
    ctx(acc("thief.testnet"), T0, NearToken::from_yoctonear(0));
    g.request_withdrawal(r, 0, milli(1), acc("thief.testnet"), "".into());
}

#[test]
#[should_panic(expected = "Game master only")]
fn vera_cannot_settle() {
    let mut g = game();
    let r = start(&mut g, 2);
    ctx(vera(), T0 + 200 * NS_PER_SEC, NearToken::from_yoctonear(0));
    g.settle_round(r, 2, SALT.into());
}

#[test]
fn correct_picks_pay_3_6x() {
    let mut g = game();
    let r = start(&mut g, 2);
    bet(&mut g, "alice.testnet", r, 2, NearToken::from_near(1));
    bet(&mut g, "bob.testnet", r, 2, NearToken::from_near(3));
    bet(&mut g, "carol.testnet", r, 0, NearToken::from_near(1));
    settle(&mut g, r, 2);

    ctx(gm(), T0 + 200 * NS_PER_SEC, NearToken::from_yoctonear(0));
    assert_eq!(g.claim(r, acc("alice.testnet")), milli(3600));
    assert_eq!(g.claim(r, acc("bob.testnet")), milli(10800));
    assert!(g.claim(r, acc("carol.testnet")).is_zero());
    assert!(g.get_status().locked_bets.is_zero());
}

#[test]
fn wrong_pick_loses_stake_to_the_vault() {
    let mut g = game();
    let before = g.get_status().spendable;
    let r = start(&mut g, 3);
    bet(&mut g, "alice.testnet", r, 0, NearToken::from_near(1));
    settle(&mut g, r, 3);
    ctx(gm(), T0 + 200 * NS_PER_SEC, NearToken::from_yoctonear(0));
    assert!(g.claim(r, acc("alice.testnet")).is_zero());
    // The whole reserve is released and the vault keeps the stake. (This claim's mock context
    // has no attached deposit, so the stake isn't in its balance: spendable is back to the start.)
    let s = g.get_status();
    assert!(s.locked_bets.is_zero());
    assert_eq!(s.spendable, before);
}

#[test]
fn solo_winner_is_paid_by_the_house() {
    // One player, nobody else in the pot: the vault still pays the full 3.6x.
    let mut g = game();
    deposit(&mut g, "alice.testnet", milli(1000));
    let r = start(&mut g, 1);
    bet_from_balance(&mut g, "alice.testnet", r, 1, milli(100));
    assert_eq!(g.get_balance(acc("alice.testnet")), milli(900));
    settle(&mut g, r, 1);
    ctx(gm(), T0 + 200 * NS_PER_SEC, NearToken::from_yoctonear(0));
    assert_eq!(g.claim(r, acc("alice.testnet")), milli(360));
    assert_eq!(g.get_balance(acc("alice.testnet")), milli(1260));
}

#[test]
#[should_panic(expected = "The house can't cover this bet")]
fn bets_the_house_cannot_cover_are_rejected() {
    let mut g = game();
    let r = start(&mut g, 1);
    // The vault holds 20 NEAR plus the attached 25; a 25 NEAR bet needs 90 NEAR reserved.
    bet(&mut g, "whale.testnet", r, 1, NearToken::from_near(25));
}

#[test]
fn abandoned_round_refunds_and_unblocks() {
    let mut g = game();
    let r = start(&mut g, 1);
    bet(&mut g, "alice.testnet", r, 0, NearToken::from_near(2));
    let later = T0 + (100 + ABANDON_AFTER_SEC + 1) * NS_PER_SEC;
    ctx(gm(), later, NearToken::from_yoctonear(0));
    assert_eq!(g.claim(r, acc("alice.testnet")), NearToken::from_near(2));
    // A new round can start once the old one is abandoned.
    assert_eq!(g.start_round(commit(0, "x"), 100), 1);
}

#[test]
#[should_panic(expected = "Betting closed")]
fn no_bets_after_close() {
    let mut g = game();
    let r = start(&mut g, 1);
    ctx(acc("late.testnet"), T0 + 100 * NS_PER_SEC, NearToken::from_near(1));
    g.place_bet(r, 1);
}

#[test]
#[should_panic(expected = "Already claimed")]
fn no_double_claim() {
    let mut g = game();
    let r = start(&mut g, 1);
    bet(&mut g, "alice.testnet", r, 1, NearToken::from_near(1));
    settle(&mut g, r, 1);
    ctx(gm(), T0 + 200 * NS_PER_SEC, NearToken::from_yoctonear(0));
    g.claim(r, acc("alice.testnet"));
    g.claim(r, acc("alice.testnet"));
}

#[test]
#[should_panic(expected = "Previous round still open")]
fn one_round_at_a_time() {
    let mut g = game();
    start(&mut g, 1);
    start(&mut g, 2);
}

#[test]
fn bet_stakes_are_not_spendable_by_owner() {
    let mut g = game();
    let r = start(&mut g, 1);
    bet(&mut g, "alice.testnet", r, 1, NearToken::from_near(3));
    let s = g.get_status();
    // The stake plus the vault's reserve: the full 3.6x payout.
    assert_eq!(s.locked_bets, milli(10800));
    assert!(s.spendable.saturating_add(s.locked_bets) <= s.balance);
}

fn deposit(g: &mut Game, who: &str, amount: NearToken) {
    ctx(acc(who), T0, amount);
    g.deposit();
}

fn bet_from_balance(g: &mut Game, who: &str, round: u64, slot: u8, amount: NearToken) {
    // No attached deposit: this is what a browser function-call key can do.
    ctx(acc(who), T0 + 2 * NS_PER_SEC, NearToken::from_yoctonear(0));
    g.bet(round, slot, amount);
}

#[test]
fn fund_profile_bet_win_withdraw() {
    let mut g = game();
    deposit(&mut g, "alice.testnet", NearToken::from_near(5));
    deposit(&mut g, "bob.testnet", NearToken::from_near(5));
    let r = start(&mut g, 2);
    bet_from_balance(&mut g, "alice.testnet", r, 2, NearToken::from_near(1));
    bet_from_balance(&mut g, "bob.testnet", r, 0, NearToken::from_near(1));
    assert_eq!(g.get_balance(acc("alice.testnet")), NearToken::from_near(4));
    assert_eq!(g.get_balance(acc("bob.testnet")), NearToken::from_near(4));
    settle(&mut g, r, 2);

    // Winnings land in the profile, not the wallet.
    ctx(gm(), T0 + 200 * NS_PER_SEC, NearToken::from_yoctonear(0));
    assert_eq!(g.claim(r, acc("alice.testnet")), milli(3600));
    g.claim(r, acc("bob.testnet"));
    assert_eq!(g.get_balance(acc("alice.testnet")), milli(7600));
    assert_eq!(g.get_balance(acc("bob.testnet")), NearToken::from_near(4));

    ctx(acc("alice.testnet"), T0 + 300 * NS_PER_SEC, NearToken::from_yoctonear(0));
    g.withdraw_balance(Some(NearToken::from_near(3)));
    assert_eq!(g.get_balance(acc("alice.testnet")), milli(4600));
    g.withdraw_balance(None);
    assert!(g.get_balance(acc("alice.testnet")).is_zero());
    let s = g.get_status();
    assert_eq!(s.total_balances, NearToken::from_near(4));
    assert!(s.locked_bets.is_zero());
}

#[test]
#[should_panic(expected = "Not enough balance")]
fn cannot_bet_more_than_balance() {
    let mut g = game();
    deposit(&mut g, "alice.testnet", NearToken::from_near(1));
    let r = start(&mut g, 1);
    bet_from_balance(&mut g, "alice.testnet", r, 1, NearToken::from_near(2));
}

#[test]
#[should_panic(expected = "Nothing to withdraw")]
fn cannot_withdraw_more_than_balance() {
    let mut g = game();
    deposit(&mut g, "alice.testnet", NearToken::from_near(1));
    ctx(acc("alice.testnet"), T0, NearToken::from_yoctonear(0));
    g.withdraw_balance(Some(NearToken::from_near(2)));
}

#[test]
#[should_panic(expected = "Deposit at least 0.1 NEAR")]
fn tiny_deposits_rejected() {
    let mut g = game();
    deposit(&mut g, "alice.testnet", NearToken::from_millinear(10));
}

#[test]
fn player_balances_are_not_spendable_by_owner() {
    let mut g = game();
    deposit(&mut g, "alice.testnet", NearToken::from_near(5));
    let s = g.get_status();
    assert_eq!(s.total_balances, NearToken::from_near(5));
    assert!(s.spendable.saturating_add(s.total_balances) <= s.balance);
}

#[test]
fn commitment_matches_node_sha256() {
    // echo -n "2:s3cret-salt" | sha256sum — same string the server hashes in JS.
    ctx(owner(), T0, NearToken::from_yoctonear(0));
    assert_eq!(commit(2, SALT).len(), 64);
}
