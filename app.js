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
            const signatureResponse = await fetch(`${BANK_
