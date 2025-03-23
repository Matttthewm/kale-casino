function initApp() {
    // Use StellarSdk.Horizon.Server instead of StellarSdk.Server
    const server = new StellarSdk.Horizon.Server("https://horizon.stellar.org");
    const NETWORK_PASSPHRASE = StellarSdk.Networks.PUBLIC;
    const BANK_PUBLIC_KEY = "GC5FWTU5MP4HUOFWCQGFHTPFERFFNBL2QOKMJJQINLAV2G4QVQ6PFDL7";
    const KALE_ISSUER = "GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE";
    const KALE_ASSET_CODE = "KALE";
    const kale_asset = new StellarSdk.Asset(KALE_ASSET_CODE, KALE_ISSUER);
    const BANK_API_URL = "http://127.0.0.1:5000";
    let playerKeypair = null;
    let playerBalance = 0;

    const symbols = ["🍅", "🥕", "🥒", "🥔", "🌽", "🥦", "🍆", "🍠", "🥬", "🥬", "🥬", "👩‍🌾"];

    function showScreen(screenId) {
        document.querySelectorAll(".screen").forEach(screen => screen.classList.add("hidden"));
        document.getElementById(screenId).classList.remove("hidden");
    }

    async function ensureTrustline() {
        const account = await server.loadAccount(playerKeypair.publicKey());
        if (!account.balances.some(b => b.asset_code === KALE_ASSET_CODE && b.asset_issuer === KALE_ISSUER)) {
            const transaction = new StellarSdk.TransactionBuilder(account, { fee: await server.fetchBaseFee(), networkPassphrase: NETWORK_PASSPHRASE })
                .addOperation(StellarSdk.Operation.changeTrust({ asset: kale_asset }))
                .setTimeout(30)
                .build();
            transaction.sign(playerKeypair);
            await server.submitTransaction(transaction);
        }
    }

    async function fetchBalance() {
        const account = await server.loadAccount(playerKeypair.publicKey());
        const kaleBalance = account.balances.find(b => b.asset_code === KALE_ASSET_CODE && b.asset_issuer === KALE_ISSUER);
        playerBalance = kaleBalance ? parseFloat(kaleBalance.balance) : 0;
        document.getElementById("balance").textContent = playerBalance;
    }

    async function deductKale(amount, memo) {
        const account = await server.loadAccount(playerKeypair.publicKey());
        const transaction = new StellarSdk.TransactionBuilder(account, { fee: await server.fetchBaseFee(), networkPassphrase: NETWORK_PASSPHRASE })
            .addOperation(StellarSdk.Operation.payment({ destination: BANK_PUBLIC_KEY, asset: kale_asset, amount: amount.toString() }))
            .addMemo(StellarSdk.Memo.text(memo.slice(0, 28)))
            .setTimeout(30)
            .build();
        transaction.sign(playerKeypair);
        const response = await server.submitTransaction(transaction);
        if (response.successful) playerBalance -= amount;
        return response.successful;
    }

    async function addWinnings(gameId, cost, gameType, choices) {
        const signature = generateGameSignature(gameId, cost);
        const response = await fetch(`${BANK_API_URL}/payout`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ game_id: gameId, cost, signature, destination: playerKeypair.publicKey(), game_type: gameType, choices })
        });
        const data = await response.json();
        if (data.status === "success" && data.amount > 0) {
            playerBalance += data.amount;
            alert(`🏆 You Won ${data.amount} KALE!`);
        } else if (gameType === "Slots") {
            alert("✗ You Lose! Try Again!");
        }
        await fetchBalance();
    }

    function generateGameSignature(gameId, cost) {
        const message = `${gameId}:${cost}`;
        return StellarSdk.StrKey.encodeCheck("hash", new TextEncoder().encode(message)).slice(0, 16);
    }

    function login() {
        const secret = document.getElementById("secretKey").value;
        try {
            playerKeypair = StellarSdk.Keypair.fromSecret(secret);
            ensureTrustline().then(() => {
                fetchBalance().then(() => showScreen("menu"));
            }).catch(e => alert(`Error: ${e}`));
        } catch (e) {
            alert("✗ Invalid secret key!");
        }
    }

    function logout() {
        playerKeypair = null;
        showScreen("splash");
        setTimeout(() => showScreen("login"), 2000);
    }

    function backToMenu() {
        showScreen("menu");
    }

    function buyScratchCard(cost, seedlings) {
        if (playerBalance < cost) {
            alert(`✗ Need ${cost} KALE, only have ${playerBalance}!`);
            return;
        }
        playScratchCard(cost, seedlings);
    }

    async function playScratchCard(cost, seedlings) {
        const gameId = Math.floor(100000 + Math.random() * 900000).toString();
        const hiddenLayout = Array(seedlings).fill().map(() => symbols[Math.floor(Math.random() * symbols.length)]);
        let displayLayout = Array(seedlings).fill("🌱");
        const choices = [];
        const scratchCard = document.getElementById("scratchCard");
        scratchCard.classList.remove("hidden");
        renderScratchCard(displayLayout, seedlings);

        for (let i = 0; i < seedlings; i++) {
            const choice = prompt(`Scratch (1-${seedlings}):`);
            const box = parseInt(choice);
            if (isNaN(box) || box < 1 || box > seedlings || choices.includes(box)) {
                alert("✗ Invalid or scratched spot!");
                i--;
                continue;
            }
            choices.push(box);
            displayLayout[box - 1] = hiddenLayout[box - 1];
            renderScratchCard(displayLayout, seedlings);
        }
        if (await deductKale(cost, `Scratch ${gameId} S:${generateGameSignature(gameId, cost)}`)) {
            await addWinnings(gameId, cost, "Scratch", choices);
        }
        scratchCard.classList.add("hidden");
    }

    function renderScratchCard(layout, seedlings) {
        const scratchCard = document.getElementById("scratchCard");
        scratchCard.innerHTML = layout.map(item => `<span>${item}</span>`).join(" | ");
    }

    function buySlots(cost, reels) {
        if (playerBalance < cost) {
            alert(`✗ Need ${cost} KALE, only have ${playerBalance}!`);
            return;
        }
        playSlots(cost, reels);
    }

    async function playSlots(cost, reels) {
        const gameId = Math.floor(100000 + Math.random() * 900000).toString();
        const slotsGame = document.getElementById("slotsGame");
        slotsGame.classList.remove("hidden");
        if (await deductKale(cost, `Slots ${gameId} S:${generateGameSignature(gameId, cost)}`)) {
            let finalReels = Array(reels).fill().map(() => symbols[Math.floor(Math.random() * symbols.length)]);
            for (let i = 0; i < 5; i++) {
                const tempReels = Array(reels).fill().map(() => symbols[Math.floor(Math.random() * symbols.length)]);
                renderSlots(tempReels, reels);
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            renderSlots(finalReels, reels);
            await addWinnings(gameId, cost, "Slots", finalReels);
        }
        slotsGame.classList.add("hidden");
    }

    function renderSlots(reels, numReels) {
        const slotsGame = document.getElementById("slotsGame");
        slotsGame.innerHTML = reels.map(item => `<span>${item}</span>`).join(" | ");
    }

    function buyMonte(cost, cards, multiplier) {
        if (playerBalance < cost) {
            alert(`✗ Need ${cost} KALE, only have ${playerBalance}!`);
            return;
        }
        playMonte(cost, cards, multiplier);
    }

    async function playMonte(cost, numCards, multiplier) {
        const gameId = Math.floor(100000 + Math.random() * 900000).toString();
        const cards = ["🥬", ...Array(numCards - 1).fill("🌱")];
        shuffle(cards);
        const kalePos = cards.indexOf("🥬") + 1;
        const monteGame = document.getElementById("monteGame");
        monteGame.classList.remove("hidden");
        renderMonte(Array(numCards).fill("🌱"), numCards);

        for (let i = 0; i < 5; i++) {
            const temp = Array(numCards).fill("🌱");
            temp[Math.floor(Math.random() * numCards)] = "🥬";
            renderMonte(temp, numCards);
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        renderMonte(Array(numCards).fill("🌱"), numCards);
        const guess = parseInt(prompt(`Guess where the kale is (1-${numCards}):`));
        if (await deductKale(cost, `Monte ${gameId} S:${generateGameSignature(gameId, cost)}`)) {
            renderMonte(cards, numCards);
            await addWinnings(gameId, cost, "Monte", [guess]);
        }
        monteGame.classList.add("hidden");
    }

    function renderMonte(cards, numCards) {
        const monteGame = document.getElementById("monteGame");
        monteGame.innerHTML = cards.map(item => `<span>${item}</span>`).join(" | ");
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

    // Start by showing the splash screen, then transition to login
    setTimeout(() => showScreen("login"), 2000);

    // Expose functions to global scope for HTML onclick handlers
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

// Run the app directly
initApp();
