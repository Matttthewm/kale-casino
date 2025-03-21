import random
import time
import os
import hmac
import hashlib
import requests
from stellar_sdk import Server, Keypair, TransactionBuilder, Network, Asset
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Stellar configuration
HORIZON_SERVER = "https://horizon.stellar.org"
server = Server(HORIZON_SERVER)
NETWORK_PASSPHRASE = Network.PUBLIC_NETWORK_PASSPHRASE

# Bank's public key and API (loaded from environment variable)
BANK_PUBLIC_KEY = os.getenv("BANK_PUBLIC_KEY")
BANK_API_URL = os.getenv("BANK_API_URL", "http://127.0.0.1:5000")  # Default to localhost

# KALE token configuration
KALE_ISSUER = os.getenv("KALE_ISSUER")
KALE_ASSET_CODE = "KALE"
kale_asset = Asset(KALE_ASSET_CODE, KALE_ISSUER)

# Shared secret for signing game outcomes
SIGNING_SECRET = os.getenv("SIGNING_SECRET", "DEFAULT_SECRET_KEY")

player_balance = 0

# ANSI color codes for better visuals in terminal
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

def add_winnings(player_keypair, expected_amount, game_id, cost, timeout=60):
    global player_balance
    print(f"{YELLOW}🏆 You won {expected_amount} KALE! Requesting payout...{RESET}")
    signature = generate_game_signature(game_id, cost)
    payload = {
        "game_id": game_id,
        "cost": cost,
        "signature": signature,
        "destination": player_keypair.public_key,
        "game_type": "Scratch"  # Adjust for other games if implemented
    }
    try:
        response = requests.post(f"{BANK_API_URL}/payout", json=payload, timeout=10)
        if response.status_code == 200:
            print(f"{GREEN}✓ Payout requested successfully!{RESET}")
        else:
            print(f"{RED}✗ Bank error: {response.text}{RESET}")
    except Exception as e:
        print(f"{RED}✗ Failed to contact bank: {e}{RESET}")
    
    # Fallback: Check balance for confirmation
    initial_balance = fetch_kale_balance(player_keypair)
    for _ in range(timeout // 2):
        new_balance = fetch_kale_balance(player_keypair)
        received = new_balance - initial_balance
        if received > 0:
            if abs(received - expected_amount) < 0.0000001:
                print(f"{GREEN}✓ Received {received} KALE!{RESET}")
                return True
            else:
                print(f"{RED}✗ Received {received} KALE, expected {expected_amount}!{RESET}")
                return False
        time.sleep(2)
    print(f"{RED}✗ Timeout: No payout received after {timeout} seconds.{RESET}")
    return False

def generate_game_signature(game_id, cost):
    message = f"{game_id}:{cost}"
    signature = hmac.new(SIGNING_SECRET.encode(), message.encode(), hashlib.sha256).hexdigest()[:16]
    return signature

def print_card(card_layout, num_seedlings):
    print(f"{CYAN}=== Scratch Card ==={RESET}")
    rows = (num_seedlings + 2) // 3
    for row in range(rows):
        start = row * 3
        end = min(start + 3, num_seedlings)
        print(f"  {' | '.join(card_layout[start:end])}")
        if row < rows - 1:
            print(f"{YELLOW}  {'─' * 15}{RESET}")
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
    signature = generate_game_signature(game_id, card_cost)
    memo = f"Scratch {game_id} S:{signature}"

    symbols = ["🍅", "🥕", "🥒", "🥔", "🌽", "🥦", "🍆", "🍠", "🥬", "👩‍🌾"]
    card_layout = ["🌱"] * 12
    hidden_layout = ["🌱"] * 12
    for i in range(num_seedlings):
        rand = random.random()
        hidden_layout[i] = "👩‍🌾" if rand < 0.001 else "🥬" if rand < 0.05 else random.choice(symbols[:-2])
    print_card(card_layout, num_seedlings)
    for _ in range(num_seedlings):
        while True:
            try:
                box = int(input(f"{YELLOW}➤ Scratch (1-{num_seedlings}): {RESET}"))
                if 1 <= box <= num_seedlings and card_layout[box - 1] == "🌱":
                    card_layout[box - 1] = hidden_layout[box - 1]
                    break
                print(f"{RED}✗ Invalid or scratched spot!{RESET}")
            except ValueError:
                print(f"{RED}✗ Enter a number!{RESET}")
        print_card(card_layout, num_seedlings)
    farmer_count = hidden_layout.count("👩‍🌾")
    kale_count = hidden_layout.count("🥬")
    winnings = 10000 if farmer_count >= 3 else 1000 if farmer_count == 2 else 25 if farmer_count == 1 else 20 * kale_count
    if deduct_kale(player_keypair, card_cost, memo):
        if winnings > 0:
            print(f"\n{YELLOW}🏆 {'JACKPOT! 3+ Farmers!' if farmer_count >= 3 else 'Two Farmers!' if farmer_count == 2 else 'You win!'}{RESET}")
            return add_winnings(player_keypair, winnings, game_id, card_cost)
        else:
            print(f"{RED}✗ No winning combination found.{RESET}")
            return True  # Still consider it a success since payment went through
    return False

def play_scratch_offs(player_keypair):
    result = buy_scratch_off_card()
    if result is None:  # User chose to go back to menu
        return
    if result is False:  # Invalid choice or insufficient funds
        time.sleep(1)
        return
    cost, seedlings = result
    scratch_card(player_keypair, cost, seedlings)
    time.sleep(2)  # Give user time to see results

def play_slots(player_keypair): pass  # Placeholder for future implementation
def play_three_card_monte(player_keypair): pass  # Placeholder for future implementation

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
            if choice == 1: play_scratch_offs(player_keypair)
            elif choice == 2: play_slots(player_keypair)
            elif choice == 3: play_three_card_monte(player_keypair)
            else: raise ValueError
        except ValueError:
            print(f"{RED}✗ Invalid choice!{RESET}")
            time.sleep(1)

if __name__ == "__main__":
    run_game()
