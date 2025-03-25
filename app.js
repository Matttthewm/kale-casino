function initApp() {
    const server = new StellarSdk.Horizon.Server("https://horizon.stellar.org");
    const NETWORK_PASSPHRASE = StellarSdk.Networks.PUBLIC;
    const BANK_PUBLIC_KEY = "GC5FWTU5MP4HUOFWCQGFHTPFERFFNBL2QOKMJJQINLAV2G4QVQ6PFDL7"; 
    const KALE_ISSUER = "GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE"; 
    const KALE_ASSET_CODE = "KALE";
    const kale_asset = new StellarSdk.Asset(KALE_ASSET_CODE, KALE_ISSUER);
    const BANK_API_URL = "https://kalecasino.pythonanywhere.com/";
    let playerKeypair = null;
    let playerBalance = 0;
    const symbols = ["🍅", "🥕", "🥒", "🥔", "🌽", "🥦", "🍆", "🍠", "🥬", "👩‍🌾"];

    async function fetchBalance() {
        const account = await server.loadAccount(playerKeypair.publicKey());
        const kaleBalance = account.balances.find(b => b.asset_code === KALE_ASSET_CODE && b.asset_issuer === KALE_ISSUER);
        playerBalance = kaleBalance ? parseFloat(kaleBalance.balance) : 0;
        updateBalanceDisplay();
    }

    function checkScratchWin(hiddenLayout) {
        const winningSymbol = "🥬";
        const farmerSymbol = "👩‍🌾";
        const kaleCount = hiddenLayout.filter(symbol => symbol === winningSymbol).length;
        const farmerCount = hiddenLayout.filter(symbol => symbol === farmerSymbol).length;
        return kaleCount >= 2 || farmerCount > 0;
    }

    async function playScratchCard(cost, seedlings) {
        const gameId = Math.floor(100000 + Math.random() * 900000).toString();
        showScreen("scratch");
        const scratchCard = document.getElementById("scratchCard");
        scratchCard.classList.remove("hidden");

        const hiddenLayout = Array(seedlings).fill().map(() => {
            const rand = Math.random();
            return rand < 0.05 ? "🥬" : rand < 0.07 ? "👩‍🌾" : symbols[Math.floor(Math.random() * (symbols.length - 2))];
        });

        let displayLayout = Array(seedlings).fill("🌱");
        const choices = [];
        renderScratchCard(displayLayout, seedlings, hiddenLayout, choices, gameId, cost);
    }

    function renderScratchCard(displayLayout, seedlings, hiddenLayout, choices, gameId, cost) {
        const scratchCard = document.getElementById("scratchCard");
        scratchCard.innerHTML = "";
        scratchCard.classList.add(`grid-${seedlings}`);
        displayLayout.forEach((item, index) => {
            const spot = document.createElement("div");
            spot.classList.add("scratch-spot");
            spot.textContent = item;
            spot.onclick = async () => {
                if (!choices.includes(index + 1)) {
                    choices.push(index + 1);
                    displayLayout[index] = hiddenLayout[index];
                    spot.textContent = hiddenLayout[index];
                    spot.classList.add("revealed");
                    if (choices.length === seedlings) {
                        if (await deductKale(cost, `Scratch ${gameId}`, "scratchDialogue")) {
                            const isWin = checkScratchWin(hiddenLayout);
                            await addWinnings(gameId, cost, "Scratch", choices, "scratchDialogue", isWin);
                        }
                    }
                }
            };
            scratchCard.appendChild(spot);
        });
    }

    async function addWinnings(gameId, cost, gameType, choices, dialogueId, isWin) {
        try {
            const response = await fetch(`${BANK_API_URL}/payout`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ game_id: gameId, cost, destination: playerKeypair.publicKey(), game_type: gameType, choices, is_win: isWin })
            });
            const data = await response.json();
            if (data.status === "success" && isWin) {
                playerBalance += data.amount;
                updateDialogue(`🏆 You Won ${data.amount} KALE!`, dialogueId);
            } else {
                updateDialogue("✗ You Lose! Try Again!", dialogueId);
            }
            updateBalanceDisplay();
        } catch (error) {
            updateDialogue(`✗ Error processing winnings: ${error.message}`, dialogueId);
        }
    }

    window.playScratchCard = playScratchCard;
}

initApp();
