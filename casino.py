# casino.py
import random
import time
import os
import hmac
import hashlib
import requests
from stellar_sdk import Server, Keypair, TransactionBuilder, Network, Asset
from dotenv import load_dotenv

load_dotenv()

HORIZON_SERVER = "https://horizon.stellar.org"
server = Server(HORIZON_SERVER)
NETWORK_PASSPHRASE = Network.PUBLIC_NETWORK_PASSPHRASE

BANK_PUBLIC_KEY = os.getenv("BANK_PUBLIC_KEY")
BANK_API_URL = os.getenv("BANK_API_URL", "http://127.0.0.1:5000")

KALE_ISSUER = os.getenv("KALE_ISSUER")
KALE_ASSET_CODE = "KALE"
kale_asset = Asset(KALE_ASSET_CODE, KALE_ISSUER)

SIGNING_SECRET = os.getenv("SIGNING_SECRET", "DEFAULT_SECRET_KEY")

player_balance = 0

GREEN = "\033[92m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
RED = "\033[91m"
RESET = "\033[0m"

SPLASH_SCREEN = f"""
{GREEN}   🥬🥬🥬  Welcome to Kale Casino!  🥬🥬🥬{RESET}
{YELLOW}   --------------------------------------{RESET}
{CYAN}         🎰 Scratch! Spin! Win! 🎰{RESET}
{YELLOW}   --------------------------------------{RESET}
"""

def ensure_trustline(player_keypair):
    try:
        account = server.load_account(player_keypair.public_key)
        for balance in account.raw_data.get("balances", []):
            if balance.get("asset_code") == KALE_ASSET_CODE and balance.get("asset_issuer") == KALE_ISSUER:
                return True
        base_fee = server.fetch_base_fee()
        transaction = (
            TransactionBuilder(source_account=account, network_passphrase=NETWORK_PASSPHRASE, base_fee=base_fee)
            .append_change_trust_op(asset=kale_asset)
            .set_timeout(30)
            .build()
        )
        transaction.sign(player_keypair)
        response = server.submit_transaction(transaction)
        print(f"{GREEN}✓ Trustline for KALE established.{RESET}" if response.get("successful") else f"{RED}✗ Trustline failed: {response}{RESET}")
        return response.get("successful")
    except Exception as e:
        print(f"{RED}✗ Error with trustline: {e}{RESET}")
        return False

def fetch_kale_balance(player_keypair):
    global player_balance
    try:
        account = server.load_account(player_keypair.public_key)
        for balance in account.raw_data.get("balances", []):
            if balance.get("asset_code") == KALE_ASSET_CODE and balance.get("asset_issuer") == KALE_ISSUER:
                player_balance = float(balance["balance"])
                return player_balance
        print(f"{YELLOW}⚠ No KALE trustline found.{RESET}")
        player_balance = 0
        return 0
    except Exception as e:
        print(f"{RED}✗ Error fetching balance: {e}{RESET}")
        return 0

def deduct_kale(player_keypair, amount, memo):
    global player_balance
    try:
        account = server.load_account(player_keypair.public_key)
        base_fee = server.fetch_base_fee()
        transaction = (
            TransactionBuilder(source_account=account, network_passphrase=NETWORK_PASSPHRASE, base_fee=base_fee)
            .append_payment_op(destination=BANK_PUBLIC_KEY, asset=kale_asset, amount=str(amount))
            .add_text_memo(memo[:28])
            .set_timeout(30)
            .build()
        )
        transaction.sign(player_keypair)
        response = server.submit_transaction(transaction)
        if response.get("successful"):
            player_balance -= amount
            print(f"{GREEN}✓ {amount} KALE sent to casino.{RESET}")
            return True
        print(f"{RED}✗ Transaction failed: {response}{RESET}")
        return False
    except Exception as e:
        print(f"{RED}✗ Error deducting KALE: {e}{RESET}")
        return False

def add_winnings(player_keypair, game_id, cost, game_type, choices=None, timeout=60):
    global player_balance
    signature = generate_game_signature(game_id, cost)
    payload = {
        "game_id": game_id,
        "cost": cost,
        "signature": signature,
        "destination": player_keypair.public_key,
        "game_type": game_type,
        "choices": choices
    }
    try:
        response = requests.post(f"{BANK_API_URL}/payout", json=payload, timeout=10)
        if response.status_code == 200:
            winnings = response.json().get("amount", 0)
            if winnings > 0:
                print(f"{YELLOW}🏆 You Won {winnings} KALE!{RESET}")
                print(f"{CYAN}Receiving from Bank...{RESET}")
                player_balance += winnings
            elif game_type == "Slots":
                print(f"{RED}✗ You Lose! Try Again!{RESET}")
            else:
                print(f"{RED}✗ No winnings received.{RESET}")
            return True
        print(f"{RED}✗ Bank error: {response.text}{RESET}")
        return False
    except Exception as e:
        print(f"{RED}✗ Failed to contact bank: {e}{RESET}")
        return False

def generate_game_signature(game_id, cost):
    message = f"{game_id}:{cost}"
    signature = hmac.new(SIGNING_SECRET.encode(), message.encode(), hashlib.sha256).hexdigest()[:16]
    return signature

def print_card(card_layout, num_seedlings):
    print(f"{CYAN}=== Scratch Card ==={RESET}")
    if num_seedlings == 3:
        print(f"  {' | '.join(card_layout[:3])}")
    elif num_seedlings == 9:
        print(f"  {' | '.join(card_layout[:3])}")
        print(f"  {' | '.join(card_layout[3:6])}")
        print(f"  {' | '.join(card_layout[6:9])}")
    elif num_seedlings == 12:
        print(f"  {' | '.join(card_layout[:3])}")
        print(f"  {' | '.join(card_layout[3:6])}")
        print(f"  {' | '.join(card_layout[6:9])}")
        print(f"  {' | '.join(card_layout[9:12])}")
    print(f"{CYAN}================={RESET}")

def buy_scratch_off_card():
    global player_balance
    print(f"\n{GREEN}🥬 Kale Casino Scratch-Off 🥬{RESET}")
    print(f"  {CYAN}1.{RESET} 10 KALE - Tiny Plot (3 spots)")
    print(f"  {CYAN}2.{RESET} 100 KALE - Garden Bed (9 spots)")
    print(f"  {CYAN}3.{RESET} 1000 KALE - Farm Field (12 spots)")
    print(f"  {CYAN}4.{RESET} Back to Menu")
    choice = input(f"{YELLOW}➤ Choose (1-4): {RESET}").strip()
    if choice == "4": return None
    cards = {1: (10, 3), 2: (100, 9), 3: (1000, 12)}
    try:
        choice = int(choice)
        if choice not in cards:
            print(f"{RED}✗ Invalid choice!{RESET}")
            return False
        cost, seedlings = cards[choice]
        if player_balance < cost:
            print(f"{RED}✗ Need {cost} KALE, only have {player_balance}!{RESET}")
            return False
        return cost, seedlings
    except ValueError:
        print(f"{RED}✗ Please enter a number (1-4)!{RESET}")
        return False

def scratch_card(player_keypair, card_cost, num_seedlings):
    game_id = str(random.randint(100000, 999999))
    random.seed(str(game_id) + str(card_cost))
    signature = generate_game_signature(game_id, card_cost)
    memo = f"Scratch {game_id} S:{signature}"

    symbols = ["🍅", "🥕", "🥒", "🥔", "🌽", "🥦", "🍆", "🍠", "🥬", "🥬", "🥬", "👩‍🌾"]
    hidden_layout = [random.choice(symbols) for _ in range(num_seedlings)]
    display_layout = ["🌱"] * num_seedlings
    choices = []
    print_card(display_layout, num_seedlings)
    for _ in range(num_seedlings):
        while True:
            try:
                box = int(input(f"{YELLOW}➤ Scratch (1-{num_seedlings}): {RESET}"))
                if 1 <= box <= num_seedlings and box not in choices:
                    choices.append(box)
                    display_layout[box - 1] = hidden_layout[box - 1]
                    break
                print(f"{RED}✗ Invalid or scratched spot!{RESET}")
            except ValueError:
                print(f"{RED}✗ Enter a number!{RESET}")
        print_card(display_layout, num_seedlings)
    if deduct_kale(player_keypair, card_cost, memo):
        add_winnings(player_keypair, game_id, card_cost, "Scratch", choices=choices)
    return False

def play_scratch_offs(player_keypair):
    result = buy_scratch_off_card()
    if result is None:
        return
    if result is False:
        time.sleep(1)
        return
    cost, seedlings = result
    scratch_card(player_keypair, cost, seedlings)
    time.sleep(2)

def buy_slots():
    global player_balance
    print(f"\n{GREEN}🥬 Kale Casino Slots 🥬{RESET}")
    print(f"  {CYAN}1.{RESET} 10 KALE - 3 Reels")
    print(f"  {CYAN}2.{RESET} 100 KALE - 6 Reels")
    print(f"  {CYAN}3.{RESET} 1000 KALE - 9 Reels")
    print(f"  {CYAN}4.{RESET} Back to Menu")
    choice = input(f"{YELLOW}➤ Choose (1-4): {RESET}").strip()
    if choice == "4": return None
    slots = {1: (10, 3), 2: (100, 6), 3: (1000, 9)}
    try:
        choice = int(choice)
        if choice not in slots:
            print(f"{RED}✗ Invalid choice!{RESET}")
            return False
        cost, reels = slots[choice]
        if player_balance < cost:
            print(f"{RED}✗ Need {cost} KALE, only have {player_balance}!{RESET}")
            return False
        return cost, reels
    except ValueError:
        print(f"{RED}✗ Please enter a number (1-4)!{RESET}")
        return False

def print_slots(reels, num_reels):
    if num_reels == 3:
        print(f"  {' | '.join(reels[:3])}")
    elif num_reels == 6:
        print(f"  {' | '.join(reels[:3])}")
        print(f"  {' | '.join(reels[3:6])}")
    elif num_reels == 9:
        print(f"  {' | '.join(reels[:3])}")
        print(f"  {' | '.join(reels[3:6])}")
        print(f"  {' | '.join(reels[6:9])}")

def play_slots(player_keypair):
    result = buy_slots()
    if result is None:
        return
    if result is False:
        time.sleep(1)
        return
    cost, num_reels = result
    game_id = str(random.randint(100000, 999999))
    random.seed(str(game_id) + str(cost))
    signature = generate_game_signature(game_id, cost)
    memo = f"Slots {game_id} S:{signature}"

    if deduct_kale(player_keypair, cost, memo):
        print(f"{CYAN}=== Spinning the Slots ==={RESET}")
        symbols = ["🍅", "🥕", "🥒", "🥔", "🌽", "🥦", "🍆", "🍠", "🥬", "🥬", "🥬", "👩‍🌾"]
        reels = ["🌱"] * num_reels
        final_reels = [random.choice(symbols) for _ in range(num_reels)]
        lines = 1 if num_reels == 3 else 2 if num_reels == 6 else 3
        for _ in range(5):
            for i in range(num_reels):
                reels[i] = random.choice(symbols)
            for _ in range(lines):
                print(f"\033[1A\033[K", end="")
            print_slots(reels, num_reels)
            time.sleep(0.1)
        for _ in range(lines):
            print(f"\033[1A\033[K", end="")
        print_slots(final_reels, num_reels)
        add_winnings(player_keypair, game_id, cost, "Slots", choices=final_reels)
    time.sleep(2)

def buy_monte():
    global player_balance
    print(f"\n{GREEN}🥬 Kale Casino Three Card Monte 🥬{RESET}")
    print(f"  {CYAN}1.{RESET} 10 KALE - 3 Cards")
    print(f"  {CYAN}2.{RESET} 100 KALE - 4 Cards")
    print(f"  {CYAN}3.{RESET} 1000 KALE - 5 Cards")
    print(f"  {CYAN}4.{RESET} Back to Menu")
    choice = input(f"{YELLOW}➤ Choose (1-4): {RESET}").strip()
    if choice == "4": return None
    montes = {1: (10, 3, 5), 2: (100, 4, 10), 3: (1000, 5, 15)}
    try:
        choice = int(choice)
        if choice not in montes:
            print(f"{RED}✗ Invalid choice!{RESET}")
            return False
        cost, num_cards, multiplier = montes[choice]
        if player_balance < cost:
            print(f"{RED}✗ Need {cost} KALE, only have {player_balance}!{RESET}")
            return False
        return cost, num_cards, multiplier
    except ValueError:
        print(f"{RED}✗ Please enter a number (1-4)!{RESET}")
        return False

def play_three_card_monte(player_keypair):
    result = buy_monte()
    if result is None:
        return
    if result is False:
        time.sleep(1)
        return
    cost, num_cards, multiplier = result
    game_id = str(random.randint(100000, 999999))
    random.seed(str(game_id) + str(cost))
    signature = generate_game_signature(game_id, cost)
    memo = f"Monte {game_id} S:{signature}"

    print(f"{CYAN}=== Three Card Monte ==={RESET}")
    cards = ["🥬"] + ["🌱"] * (num_cards - 1)
    random.shuffle(cards)
    kale_position = cards.index("🥬") + 1
    display = ["🌱"] * num_cards
    print(f"  {' | '.join(display)}")
    print(f"{YELLOW}Watch the kale shuffle...{RESET}")
    time.sleep(1)
    for _ in range(5):
        random.shuffle(display)
        display[random.randint(0, num_cards - 1)] = "🥬"
        print(f"\033[1A\033[K  {' | '.join(display)}")
        time.sleep(0.3)
    display = ["🌱"] * num_cards
    print(f"\033[1A\033[K  {' | '.join(display)}")
    while True:
        try:
            guess = int(input(f"{YELLOW}➤ Guess where the kale is (1-{num_cards}): {RESET}"))
            if 1 <= guess <= num_cards:
                break
            print(f"{RED}✗ Invalid choice!{RESET}")
        except ValueError:
            print(f"{RED}✗ Enter a number!{RESET}")
    if deduct_kale(player_keypair, cost, memo):
        print(f"{CYAN}=== Result ==={RESET}")
        print(f"  {' | '.join(cards)}")
        if guess == kale_position:
            print(f"{GREEN}✓ You found the kale at position {kale_position}!{RESET}")
        else:
            print(f"{RED}✗ The kale was at position {kale_position}. You lose!{RESET}")
        add_winnings(player_keypair, game_id, cost, "Monte", choices=[guess])
    time.sleep(2)

def run_game():
    global player_balance
    os.system('cls' if os.name == 'nt' else 'clear')
    print(SPLASH_SCREEN)
    time.sleep(2)
    player_secret = input(f"{YELLOW}➤ Enter your Stellar secret key: {RESET}").strip()
    try:
        player_keypair = Keypair.from_secret(player_secret)
        print(f"{GREEN}✓ Logged in as {player_keypair.public_key}{RESET}")
    except Exception as e:
        print(f"{RED}✗ Invalid secret key: {e}{RESET}")
        return
    if not ensure_trustline(player_keypair):
        print(f"{RED}✗ Game requires a KALE trustline.{RESET}")
        return
    fetch_kale_balance(player_keypair)
    while True:
        os.system('cls' if os.name == 'nt' else 'clear')
        fetch_kale_balance(player_keypair)
        print(f"\n{YELLOW}👩‍🌾 Balance: {player_balance} KALE 👩‍🌾{RESET}")
        print(f"{GREEN}🎲 Kale Casino Games 🎲{RESET}")
        print(f"  {CYAN}1.{RESET} Scratch-Off")
        print(f"  {CYAN}2.{RESET} Slots")
        print(f"  {CYAN}3.{RESET} Monte")
        print(f"  {CYAN}4.{RESET} Exit")
        choice = input(f"{YELLOW}➤ Choose (1-4): {RESET}").strip()
        if choice == "4":
            print(f"{GREEN}✓ Thanks for playing! Final balance: {player_balance} KALE{RESET}")
            break
        try:
            choice = int(choice)
            if choice == 1:
                play_scratch_offs(player_keypair)
            elif choice == 2:
                play_slots(player_keypair)
            elif choice == 3:
                play_three_card_monte(player_keypair)
            else:
                raise ValueError
        except ValueError:
            print(f"{RED}✗ Invalid choice!{RESET}")
            time.sleep(1)

if __name__ == "__main__":
    run_game()
