// app.js
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

    function showScreen(screenId) {
        document.querySelectorAll(".screen").forEach(screen => screen.classList.add("hidden"));
        const screen = document.getElementById(screenId);
        if (screen) screen.classList.remove("hidden");
        updateDialogue("", screenId === "menu" ? "dialogue" : `${screenId}Dialogue`);
        if (screenId !== "splash" && screenId !== "login") {
            document.getElementById("balanceBar").classList.remove("hidden");
        } else {
            document.getElementById("balanceBar").classList.add("hidden");
        }
    }

    function updateDialogue(message, dialogueId = "dialogue") {
        const dialogue = document.getElementById(dialogueId);
        if (dialogue) dialogue.innerHTML = message;
    }

    function showLoading() {
        document.getElementById("loading").classList.remove("hidden");
    }

    function hideLoading() {
        document.getElementById("loading").classList.add("hidden");
    }

    function updateBalanceDisplay() {
        document.getElementById("balance").textContent = playerBalance.toFixed(2);
    }

    async function ensureTrustline() {
        showLoading();
        const account = await server.loadAccount(playerKeypair.publicKey());
        if (!account.balances.some(b => b.asset_code === KALE_ASSET_CODE && b.asset_issuer === KALE_ISSUER)) {
            const transaction = new StellarSdk.TransactionBuilder(account, { fee: await server.fetchBaseFee(), networkPassphrase: NETWORK_PASSPHRASE })
                .addOperation(StellarSdk.Operation.changeTrust({ asset: kale_asset }))
                .setTimeout(30)
                .build();
            transaction.sign(playerKeypair);
            await server.submitTransaction(transaction);
            updateDialogue("✓ Trustline for KALE established.");
        }
        hideLoading();
        return true;
    }

    async function fetchBalance() {
        showLoading();
        const account = await server.loadAccount(playerKeypair.publicKey());
        const kaleBalance = account.balances.find(b => b.asset_code === KALE_ASSET_CODE && b.asset_issuer === KALE_ISSUER);
        playerBalance = kaleBalance ? parseFloat(kaleBalance.balance) : 0;
        updateBalanceDisplay();
        hideLoading();
    }

    async function deductKale(amount, memo, dialogueId) {
        showLoading();
        const account = await server.loadAccount(playerKeypair.publicKey());
        const transaction = new StellarSdk.TransactionBuilder(account, { fee: await server.fetchBaseFee(), networkPassphrase: NETWORK_PASSPHRASE })
            .addOperation(StellarSdk.Operation.payment({ destination: BANK_PUBLIC_KEY, asset: kale_asset, amount: amount.toString() }))
            .addMemo(StellarSdk.Memo.text(memo.slice(0, 28)))
            .setTimeout(30)
            .build();
        transaction.sign(playerKeypair);
        const response = await server.submitTransaction(transaction);
        if (response.successful) {
            playerBalance -= amount;
            updateDialogue(`✓ ${amount} KALE deducted for game.`, dialogueId);
            updateBalanceDisplay();
        } else {
            updateDialogue("✗ Transaction failed.", dialogueId);
        }
        hideLoading();
        return response.successful;
    }

    async function addWinnings(gameId, cost, gameType, choices, dialogueId) {
        showLoading();
        try {
            const signatureResponse = await fetch(`${BANK_API_URL}/sign_game`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ game_id: gameId, cost })
            });
            if (!signatureResponse.ok) throw new Error("Failed to fetch signature");
            const { signature } = await signatureResponse.json();
            
            const response = await fetch(`${BANK_API_URL}/payout`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ game_id: gameId, cost, signature, destination: playerKeypair.publicKey(), game_type: gameType, choices })
            });
            if (!response.ok) throw new Error("Payout request failed");
            const data = await response.json();
            
            if (data.status === "success") {
                if (data.amount > 0) {
                    playerBalance += data.amount;
                    updateDialogue(`🏆 You Won ${data.amount} FARMER!`, dialogueId);
                } else if (gameType === "Slots") {
                    updateDialogue("✗ You Lose! Try Again!", dialogueId);
                } else {
                    updateDialogue("✗ No winnings received.", dialogueId);
                }
                updateBalanceDisplay();
            } else {
                updateDialogue("✗ Bank error.", dialogueId);
            }
        } catch (error) {
            updateDialogue(`✗ Error processing winnings: ${error.message}`, dialogueId);
        }
        hideLoading();
        return true;
    }

    function login() {
        const secret = document.getElementById("secretKey").value;
        try {
            playerKeypair = StellarSdk.Keypair.fromSecret(secret);
            ensureTrustline().then(() => {
                fetchBalance().then(() => {
                    updateDialogue(`✓ Logged in as ${playerKeypair.publicKey}`);
                    showScreen("menu");
                });
            }).catch(e => updateDialogue(`✗ Error: ${e}`));
        } catch (e) {
            updateDialogue("✗ Invalid secret key!");
        }
    }

    function logout() {
        playerKeypair = null;
        updateDialogue(`✓ Thanks for playing! Final balance: ${playerBalance} KALE`);
        showScreen("splash");
        setTimeout(() => showScreen("login"), 2000);
    }

    function backToMenu() {
        showScreen("menu");
    }

    function buyScratchCard(cost, seedlings) {
        if (playerBalance < cost) {
            updateDialogue(`✗ Need ${cost} KALE, only have ${playerBalance}!`, "scratchDialogue");
            return;
        }
        playScratchCard(cost, seedlings);
    }

    async function playScratchCard(cost, seedlings) {
        const gameId = Math.floor(100000 + Math.random() * 900000).toString();
        showScreen("scratch");
        const scratchCard = document.getElementById("scratchCard");
        scratchCard.classList.remove("hidden");
        const hiddenLayout = Array(seedlings).fill().map(() => {
            const rand = Math.random();
            if (cost === 10) {
                return rand < 0.1 ? "🥬" : rand < 0.15 ? "👩‍🌾" : symbols[Math.floor(Math.random() * (symbols.length - 2))];
            } else if (cost === 100) {
                return rand < 0.2 ? "🥬" : rand < 0.25 ? "👩‍🌾" : symbols[Math.floor(Math.random() * (symbols.length - 2))];
            } else {
                return rand < 0.3 ? "🥬" : rand < 0.35 ? "👩‍🌾" : symbols[Math.floor(Math.random() * (symbols.length - 2))];
            }
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
                            await addWinnings(gameId, cost, "Scratch", choices, "scratchDialogue");
                            setTimeout(() => scratchCard.classList.add("hidden"), 2000);
                        }
                    }
                }
            };
            scratchCard.appendChild(spot);
        });
    }

    function buySlots(cost, reels) {
        if (playerBalance < cost) {
            updateDialogue(`✗ Need ${cost} KALE, only have ${playerBalance}!`, "slotsDialogue");
            return;
        }
        playSlots(cost, reels);
    }

    async function playSlots(cost, reels) {
        const gameId = Math.floor(100000 + Math.random() * 900000).toString();
        showScreen("slots");
        const slotsGame = document.getElementById("slotsGame");
        slotsGame.classList.remove("hidden");
        slotsGame.classList.add(`grid-${reels}`);
        if (await deductKale(cost, `Slots ${gameId}`, "slotsDialogue")) {
            let finalReels = Array(reels).fill().map(() => {
                const rand = Math.random();
                if (cost === 10) {
                    return rand < 0.1 ? "🥬" : rand < 0.15 ? "👩‍🌾" : symbols[Math.floor(Math.random() * (symbols.length - 2))];
                } else if (cost === 100) {
                    return rand < 0.2 ? "🥬" : rand < 0.25 ? "👩‍🌾" : symbols[Math.floor(Math.random() * (symbols.length - 2))];
                } else {
                    return rand < 0.3 ? "🥬" : rand < 0.35 ? "👩‍🌾" : symbols[Math.floor(Math.random() * (symbols.length - 2))];
                }
            });
            for (let i = 0; i < 5; i++) {
                const tempReels = Array(reels).fill().map(() => symbols[Math.floor(Math.random() * symbols.length)]);
                renderSlots(tempReels, reels);
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            renderSlots(finalReels, reels);
            await addWinnings(gameId, cost, "Slots", finalReels, "slotsDialogue");
            setTimeout(() => slotsGame.classList.add("hidden"), 2000);
        }
    }

    function renderSlots(reels, numReels) {
        const slotsGame = document.getElementById("slotsGame");
        slotsGame.innerHTML = "";
        reels.forEach(item => {
            const reel = document.createElement("span");
            reel.textContent = item;
            slotsGame.appendChild(reel);
        });
    }

    function buyMonte(cost, cards, multiplier) {
        if (playerBalance < cost) {
            updateDialogue(`✗ Need ${cost} KALE, only have ${playerBalance}!`, "monteDialogue");
            return;
        }
        playMonte(cost, cards, multiplier);
    }

    async function playMonte(cost, numCards, multiplier) {
        const gameId = Math.floor(100000 + Math.random() * 900000).toString();
        showScreen("monte");
        const monteGame = document.getElementById("monteGame");
        monteGame.classList.remove("hidden");
        monteGame.classList.add(`grid-${numCards}`);
        const cards = ["🥬", ...Array(numCards - 1).fill("🌱")];
        shuffle(cards);
        const kalePos = cards.indexOf("🥬") + 1;
        let display = Array(numCards).fill("🌱");
        renderMonte(display, numCards);
        for (let i = 0; i < 5; i++) {
            const temp = Array(numCards).fill("🌱");
            temp[Math.floor(Math.random() * numCards)] = "🥬";
            renderMonte(temp, numCards);
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        renderMonte(display, numCards, cards, gameId, cost, kalePos);
    }

    function renderMonte(display, numCards, cards = null, gameId = null, cost = null, kalePos = null) {
        const monteGame = document.getElementById("monteGame");
        monteGame.innerHTML = "";
        display.forEach((item, index) => {
            const card = document.createElement("div");
            card.classList.add("monte-card");
            card.textContent = item;
            if (cards) {
                card.onclick = async () => {
                    monteGame.innerHTML = cards.map(c => `<span>${c}</span>`).join(" ");
                    if (await deductKale(cost, `Monte ${gameId}`, "monteDialogue")) {
                        await addWinnings(gameId, cost, "Monte", [index + 1], "monteDialogue");
                        updateDialogue(index + 1 === kalePos ? 
                            `✓ You found the kale at position ${kalePos}!` : 
                            `✗ The kale was at position ${kalePos}. You lose!`, "monteDialogue");
                        setTimeout(() => monteGame.classList.add("hidden"), 2000);
                    }
                };
            }
            monteGame.appendChild(card);
        });
    }

    function shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    function showScratchOffs() { showScreen("scratch"); }
    function showSlots() { showScreen("slots"); }
    function showMonte() { showScreen("monte"); }

    setTimeout(() => showScreen("login"), 2000);

    window.login = login;
    window.logout = logout;
    window.backToMenu = backToMenu;
    window.buyScratchCard = buyScratchCard;
    window.buySlots = buySlots;
    window.buyMonte = buyMonte;
    window.showScratchOffs = showScratchOffs;
    window.showSlots = showSlots;
    window.showMonte = showMonte;
}

initApp();
