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
                    updateDialogue(`🏆 You Won ${data.amount} KALE!`, dialogueId);
                } else {
                    updateDialogue("✗ You Lose! Try Again!", dialogueId);
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
                return rand < 0.02 ? "🥬" : rand < 0.03 ? "👩‍🌾" : symbols[Math.floor(Math.random() * (symbols.length - 2))];
            } else if (cost === 100) {
                return rand < 0.05 ? "🥬" : rand < 0.07 ? "👩‍🌾" : symbols[Math.floor(Math.random() * (symbols.length - 2))];
            } else {
                return rand < 0.08 ? "🥬" : rand < 0.10 ? "👩‍🌾" : symbols[Math.floor(Math.random() * (symbols.length - 2))];
            }
        });
        let displayLayout = Array(seedlings).fill("🌱");
        const choices = [];
        renderScratchCard(displayLayout, seedlings, hiddenLayout, choices, gameId, cost);
    }

    function renderScratchCard(displayLayout, seedlings, hidden
