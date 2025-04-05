// app.js (Updated: Added console logging for Slots game ID tracing)

function initApp() {
    // Ensure StellarSdk is loaded
    if (typeof StellarSdk === 'undefined') {
        console.error("Stellar SDK not loaded!");
        alert("Error: Stellar SDK failed to load. Please refresh.");
        return;
    }

    const server = new StellarSdk.Horizon.Server("https://horizon.stellar.org");
    const NETWORK_PASSPHRASE = StellarSdk.Networks.PUBLIC;
    const BANK_PUBLIC_KEY = "GC5FWTU5MP4HUOFWCQGFHTPFERFFNBL2QOKMJJQINLAV2G4QVQ6PFDL7"; // Bank's public key
    const KALE_ISSUER = "GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE"; // KALE asset issuer
    const KALE_ASSET_CODE = "KALE";
    const kale_asset = new StellarSdk.Asset(KALE_ASSET_CODE, KALE_ISSUER);
    // Use HTTPS for secure communication with your backend
    const BANK_API_URL = "https://kalecasino.pythonanywhere.com"; // Make sure this is HTTPS

    let playerKeypair = null;
    let playerBalance = 0;
    let activeGame = { id: null, cost: 0, type: null }; // Track active game details

    // Basic vegetable symbols + Kale + Farmer
    const symbols = ["🍅", "🥕", "🥒", "🥔", "🌽", "🥦", "🍆", "🍠", "🥬", "👩‍🌾"];

    // --- UI Functions ---
    function showScreen(screenId) {
        document.querySelectorAll(".screen").forEach(screen => screen.classList.add("hidden"));
        const screen = document.getElementById(screenId);
        if (screen) screen.classList.remove("hidden");

        // Reset dialogues on screen change, except for menu
        const dialogueId = screenId === 'menu' ? 'dialogue' : `${screenId}Dialogue`;
        const gameContainerId = screenId === 'scratch' ? 'scratchCard' : screenId === 'slots' ? 'slotsGame' : screenId === 'monte' ? 'monteGame' : null;

        updateDialogue(" ", dialogueId); // Clear dialogue
        if(gameContainerId) {
            const gameContainer = document.getElementById(gameContainerId);
            if(gameContainer) gameContainer.classList.add('hidden'); // Hide old game grids
        }


        if (screenId !== "splash" && screenId !== "login") {
            document.getElementById("balanceBar").classList.remove("hidden");
            fetchBalance(); // Update balance when showing game screens
        } else {
            document.getElementById("balanceBar").classList.add("hidden");
        }
        updateBackground(screenId);
        activeGame = { id: null, cost: 0, type: null }; // Reset active game on screen change
    }

    function updateBackground(screenId) {
        document.body.className = ''; // Clear existing background classes
        document.body.classList.add(`bg-${screenId}`); // Apply specific class
    }

    function updateDialogue(message, dialogueId = "dialogue") {
        const dialogue = document.getElementById(dialogueId);
        if (dialogue) dialogue.innerHTML = message; // Use innerHTML to allow basic formatting if needed
    }

    function showLoading(message = "Loading...") {
        document.getElementById("loading").classList.remove("hidden");
        document.getElementById("loadingText").textContent = message;
    }

    function hideLoading() {
        document.getElementById("loading").classList.add("hidden");
        document.getElementById("loadingText").textContent = "";
    }

    function updateBalanceDisplay() {
        document.getElementById("balance").textContent = playerBalance.toFixed(2);
    }

    // --- Stellar Interaction ---
    async function fetchBalance() {
        if (!playerKeypair) return;
        try {
            const account = await server.loadAccount(playerKeypair.publicKey());
            const kaleBalance = account.balances.find(b => b.asset_code === KALE_ASSET_CODE && b.asset_issuer === KALE_ISSUER);
            playerBalance = kaleBalance ? parseFloat(kaleBalance.balance) : 0;
            updateBalanceDisplay();
        } catch (e) {
             if (e.response && e.response.status === 404) {
                playerBalance = 0; updateBalanceDisplay();
            } else {
                 console.error("Error fetching balance:", e);
                 updateDialogue(`✗ Error fetching balance. Please ensure account exists and check console.`);
            }
        } finally { }
    }

     async function ensureTrustline() {
        if (!playerKeypair) return false;
        showLoading("Checking KALE Trustline...");
        try {
            const account = await server.loadAccount(playerKeypair.publicKey());
            const hasTrustline = account.balances.some(
                (b) => b.asset_type === 'native' || (b.asset_code === KALE_ASSET_CODE && b.asset_issuer === KALE_ISSUER)
            );
            if (!hasTrustline) {
                 updateDialogue("Establishing KALE Trustline...");
                 const baseFee = await server.fetchBaseFee();
                 const baseReserve = 0.5; const entryReserve = 0.5;
                 const minBalance = (2 * baseReserve) + entryReserve;
                 const xlmBalance = account.balances.find(b => b.asset_type === 'native');
                 if (!xlmBalance || parseFloat(xlmBalance.balance) < minBalance + (parseInt(baseFee, 10) / 10000000)) {
                     updateDialogue(`✗ Insufficient XLM balance. Need ~${minBalance + 0.01} XLM for trustline.`);
                     hideLoading(); return false;
                 }
                 const transaction = new StellarSdk.TransactionBuilder(account, { fee: baseFee, networkPassphrase: NETWORK_PASSPHRASE, })
                    .addOperation(StellarSdk.Operation.changeTrust({ asset: kale_asset, limit: '900000000' }))
                    .setTimeout(30).build();
                transaction.sign(playerKeypair);
                await server.submitTransaction(transaction);
                updateDialogue("✓ KALE Trustline established!");
            } else { updateDialogue("✓ KALE Trustline exists."); }
            return true;
        } catch (e) {
             console.error("Trustline Error:", e.response ? e.response.data : e);
             if (e.response && e.response.status === 404) {
                 updateDialogue(`✗ Account not found on network. Please fund ${playerKeypair.publicKey()} with XLM.`);
             } else { updateDialogue(`✗ Error checking/establishing trustline: ${e.message || 'Unknown error'}`); }
             return false;
         } finally { hideLoading(); }
    }

    async function deductKale(amount, memo, dialogueId) {
        if (!playerKeypair) return false;
        showLoading("Processing Payment...");
        updateDialogue("Sending payment to casino bank...", dialogueId);
        try {
            const account = await server.loadAccount(playerKeypair.publicKey());
            const baseFee = await server.fetchBaseFee();
            const transaction = new StellarSdk.TransactionBuilder(account, { fee: baseFee, networkPassphrase: NETWORK_PASSPHRASE, })
                .addOperation(StellarSdk.Operation.payment({ destination: BANK_PUBLIC_KEY, asset: kale_asset, amount: amount.toString(), }))
                .addMemo(StellarSdk.Memo.text(memo.slice(0, 28)))
                .setTimeout(60).build();
            transaction.sign(playerKeypair);
            const result = await server.submitTransaction(transaction);
            console.log("Payment Tx Result:", result); // Keep this log
            playerBalance -= amount; updateBalanceDisplay();
            updateDialogue(`✓ ${amount} KALE payment sent.`, dialogueId);
            hideLoading(); return true;
        } catch (error) {
            console.error("Payment Error:", error.response ? error.response.data : error);
             let errorMsg = "✗ Payment failed.";
             if (error.response?.data?.extras?.result_codes) { // Optional chaining
                 const codes = error.response.data.extras.result_codes;
                 if (codes.transaction === 'tx_failed' && codes.operations?.[0] === 'op_underfunded') { // Optional chaining
                     errorMsg = "✗ Payment failed: Insufficient KALE balance.";
                 } else if (codes.transaction === 'tx_failed' && codes.operations?.[0] === 'op_no_destination') {
                     errorMsg = "✗ Payment failed: Casino bank account may not exist.";
                 } else { errorMsg = `✗ Payment failed: ${codes.transaction || 'Unknown reason'}`; }
             } else if (error.message) { errorMsg += ` ${error.message}`; }
            updateDialogue(errorMsg, dialogueId);
            fetchBalance(); hideLoading(); return false;
        }
    }

    // --- Backend Interaction ---
    async function fetchSignature(gameId, cost) {
        if (!gameId || !cost) return null;
        showLoading("Securing game...");
        try {
             const response = await fetch(`${BANK_API_URL}/sign_game`, {
                 method: "POST", headers: { "Content-Type": "application/json" },
                 body: JSON.stringify({ game_id: gameId, cost: cost })
             });
             if (!response.ok) {
                 let errorJson; try { errorJson = await response.json(); } catch (e) {}
                 throw new Error(errorJson?.error || `HTTP error ${response.status}`);
             }
             const data = await response.json();
             hideLoading(); return data.signature;
         } catch (error) {
             console.error("Error fetching signature:", error);
             updateDialogue(`✗ Error securing game: ${error.message}`, activeGame.type ? `${activeGame.type}Dialogue` : 'dialogue');
             hideLoading(); return null;
         }
    }

    async function requestPayout(gameId, cost, signature, gameType, choices) {
        if (!gameId || !cost || !signature || !playerKeypair) return;
        showLoading("Requesting Payout...");
        updateDialogue("Checking results with the bank...", `${gameType}Dialogue`);
        try {
            const response = await fetch(`${BANK_API_URL}/payout`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ game_id: gameId, cost: cost, signature: signature,
                    destination: playerKeypair.publicKey(), game_type: gameType, choices: choices })
            });
            if (!response.ok) {
                let errorJson; try { errorJson = await response.json(); } catch (e) {}
                throw new Error(errorJson?.error || `Payout request failed: ${response.status}`);
            }
            const data = await response.json();
            console.log("Payout response:", data);
            if (data.status === "success") {
                if (data.amount > 0) {
                    updateDialogue(`🏆 You Won ${data.amount.toFixed(2)} KALE! Processing...`, `${gameType}Dialogue`);
                    setTimeout(fetchBalance, 4000);
                } else { updateDialogue("✗ You Lost! Better luck next time!", `${gameType}Dialogue`); }
            } else { updateDialogue(`✗ Payout check failed: ${data.message || 'Bank error.'}`, `${gameType}Dialogue`); }
        } catch (error) {
            console.error("Error processing winnings:", error);
            const errorMessage = error.message || "An unknown error occurred.";
            updateDialogue(`✗ Error: ${errorMessage}`, `${gameType}Dialogue`); // Update dialogue on error
        } finally {
            hideLoading();
            activeGame = { id: null, cost: 0, type: null };
        }
    }

    // --- Game Logic ---
    // SCRATCH-OFF
    async function buyScratchCard(cost) {
         if (activeGame.id) { updateDialogue("Finish the current game first!", "scratchDialogue"); return; }
         if (playerBalance < cost) { updateDialogue(`✗ Need ${cost} KALE, you have ${playerBalance.toFixed(2)}!`, "scratchDialogue"); return; }
        showLoading("Initializing Scratch Card...");
        updateDialogue("Getting your scratch card ready...", "scratchDialogue");
        try {
            const initResponse = await fetch(`${BANK_API_URL}/init_scratch_game`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cost: cost }), });
            if (!initResponse.ok) { let errorJson; try { errorJson = await initResponse.json(); } catch(e){} throw new Error(errorJson?.error || `HTTP error ${initResponse.status}`); }
            const gameData = await initResponse.json();
            const gameId = gameData.gameId; const seedlings = gameData.seedlings;
            const memo = `Scratch ${gameId.slice(-6)}`;
            const paymentSuccess = await deductKale(cost, memo, "scratchDialogue");
            if (paymentSuccess) {
                 activeGame = { id: gameId, cost: cost, type: "Scratch" };
                 updateDialogue("✓ Paid! Scratch away!", "scratchDialogue");
                 startScratchGame(gameId, cost, seedlings);
            } else { updateDialogue("✗ Payment failed. Card cancelled.", "scratchDialogue"); }
         } catch (error) {
             console.error("Error buying scratch card:", error);
             updateDialogue(`✗ Error starting scratch game: ${error.message}`, "scratchDialogue");
             fetchBalance();
         } finally { hideLoading(); }
    }

     function startScratchGame(gameId, cost, seedlings) {
         const scratchCard = document.getElementById("scratchCard");
         const dialogueId = "scratchDialogue";
         scratchCard.innerHTML = ""; scratchCard.classList.remove("hidden");
         scratchCard.className = `game grid-${seedlings === 9 ? 9 : seedlings === 3 ? 3 : 12}`;
         scratchCard.style.pointerEvents = 'auto';
         let revealedCount = 0; let revealedSymbols = Array(seedlings).fill(null);
         let isGameConcluding = false; // Flag to prevent multiple payouts
         for (let i = 0; i < seedlings; i++) {
             const spot = document.createElement("div");
             spot.classList.add("scratch-spot"); spot.textContent = "🌱"; spot.dataset.index = i;
             spot.onclick = async () => {
                 if (!activeGame.id || spot.classList.contains("revealed") || spot.classList.contains("revealing") || isGameConcluding) { return; }
                 spot.classList.add("revealing"); spot.textContent = "🤔";
                 if (!isGameConcluding) updateDialogue("Revealing spot...", dialogueId);
                 try {
                     const response = await fetch(`${BANK_API_URL}/reveal_spot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId: gameId, index: i }), });
                     if (response.ok) {
                         const data = await response.json(); const symbol = data.symbol;
                         spot.textContent = symbol; spot.classList.remove("revealing"); spot.classList.add("revealed");
                         revealedCount++; revealedSymbols[i] = symbol;
                         if (revealedCount === seedlings && !isGameConcluding) {
                             isGameConcluding = true; // Set flag IMMEDIATELY
                             updateDialogue("All spots revealed! Checking results...", dialogueId);
                             scratchCard.style.pointerEvents = 'none';
                             const signature = await fetchSignature(gameId, cost); // Use gameId from closure
                             if (signature) { await requestPayout(activeGame.id, activeGame.cost, signature, activeGame.type, null); }
                             else { updateDialogue("✗ Failed to secure game for payout.", dialogueId); activeGame = { id: null, cost: 0, type: null }; }
                             setTimeout(() => { scratchCard.classList.add("hidden"); }, 5000);
                         } else if (!isGameConcluding) { updateDialogue(`Spot revealed! ${seedlings - revealedCount} remaining.`, dialogueId); }
                     } else {
                         let errorJson; try { errorJson = await response.json(); } catch(e){} console.error("Error revealing spot:", errorJson || response.status);
                         spot.textContent = "Error"; spot.classList.remove("revealing"); updateDialogue(`✗ Error revealing spot: ${errorJson?.error || 'Unknown error'}`, dialogueId);
                     }
                 } catch (error) {
                     console.error("Error revealing spot:", error); spot.textContent = "Error"; spot.classList.remove("revealing");
                     updateDialogue(`✗ Network error revealing spot.`, dialogueId);
                 }
             };
             scratchCard.appendChild(spot);
         }
         updateDialogue("Card ready! Click the 🌱 to reveal.", dialogueId);
     }

    // SLOTS
     async function buySlots(cost, reels) {
        if (activeGame.id) { updateDialogue("Finish the current game first!", "slotsDialogue"); return; }
        if (playerBalance < cost) { updateDialogue(`✗ Need ${cost} KALE, you have ${playerBalance.toFixed(2)}!`, "slotsDialogue"); return; }
        showLoading("Preparing Slots...");
        updateDialogue("Placing your bet...", "slotsDialogue");
        const gameStartTime = Date.now(); const memo = `Slots ${cost}-${gameStartTime.toString().slice(-6)}`;
        const paymentSuccess = await deductKale(cost, memo, "slotsDialogue");
        if (!paymentSuccess) { updateDialogue("✗ Payment failed. Cannot play slots.", "slotsDialogue"); hideLoading(); return; }
        updateDialogue("✓ Paid! Spinning reels...", "slotsDialogue");
        try {
            const response = await fetch(`${BANK_API_URL}/play_slots`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cost: cost, num_reels: reels }), });
            if (!response.ok) { let errorJson; try { errorJson = await response.json(); } catch(e){} throw new Error(errorJson?.error || `HTTP error ${response.status}`); }
            const data = await response.json();
            const gameId = data.gameId; const finalReels = data.result;
            // *** ADDED LOG ***
            console.log("Slots gameId received from /play_slots:", gameId);
            activeGame = { id: gameId, cost: cost, type: "Slots" };
             // *** ADDED LOG ***
            console.log("Set activeGame.id to:", activeGame.id);
            await animateSlots(reels, finalReels);
            updateDialogue("Spin finished! Checking results...", "slotsDialogue");
            const signature = await fetchSignature(gameId, cost); // Use gameId received
            if (signature) {
                 // *** ADDED LOG ***
                 console.log(`Calling requestPayout for Slots with gameId: ${activeGame.id}, cost: ${activeGame.cost}, type: ${activeGame.type}`);
                 await requestPayout(activeGame.id, activeGame.cost, signature, activeGame.type, null);
            } else {
                 updateDialogue("✗ Failed to secure game for payout.", "slotsDialogue");
                 fetchBalance(); activeGame = { id: null, cost: 0, type: null };
            }
            setTimeout(() => { const slotsGame = document.getElementById("slotsGame"); if(slotsGame) slotsGame.classList.add("hidden"); }, 5000);
        } catch (error) {
            console.error("Error playing slots:", error);
            updateDialogue(`✗ Error playing slots: ${error.message}`, "slotsDialogue");
            fetchBalance(); activeGame = { id: null, cost: 0, type: null };
        } finally { hideLoading(); }
    }

     async function animateSlots(reels, finalResult) {
         const slotsGame = document.getElementById("slotsGame");
         slotsGame.innerHTML = ""; slotsGame.classList.remove("hidden");
         slotsGame.className = `game grid-${reels === 9 ? 9 : reels === 6 ? 6 : 3}`;
         const reelElements = [];
         for (let i = 0; i < reels; i++) {
             const reelSpan = document.createElement("span");
             reelSpan.textContent = symbols[Math.floor(Math.random() * symbols.length)];
             slotsGame.appendChild(reelSpan); reelElements.push(reelSpan);
         }
         const spinDuration = 1500; const intervalTime = 50; const startTime = Date.now();
         return new Promise(resolve => {
             const spinInterval = setInterval(() => {
                 const elapsedTime = Date.now() - startTime; let allStopped = true;
                 for (let i = 0; i < reels; i++) {
                     const stopTime = (spinDuration * 0.5) + (i * spinDuration * 0.5 / reels);
                     if (elapsedTime < stopTime) { reelElements[i].textContent = symbols[Math.floor(Math.random() * symbols.length)]; allStopped = false; }
                     else { reelElements[i].textContent = finalResult[i]; }
                 }
                 if (allStopped || elapsedTime >= spinDuration) {
                     clearInterval(spinInterval);
                     for (let i = 0; i < reels; i++) { reelElements[i].textContent = finalResult[i]; }
                     resolve();
                 }
             }, intervalTime);
         });
     }

    // MONTE
     async function buyMonte(cost, numCards) {
         if (activeGame.id) { updateDialogue("Finish the current game first!", "monteDialogue"); return; }
         if (playerBalance < cost) { updateDialogue(`✗ Need ${cost} KALE, you have ${playerBalance.toFixed(2)}!`, "monteDialogue"); return; }
        showLoading("Initializing Monte Game...");
        updateDialogue("Setting up the cards...", "monteDialogue");
        try {
            const initResponse = await fetch(`${BANK_API_URL}/init_monte_game`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cost: cost }), });
            if (!initResponse.ok) { let errorJson; try { errorJson = await initResponse.json(); } catch(e){} throw new Error(errorJson?.error || `HTTP error ${initResponse.status}`); }
            const gameData = await initResponse.json(); const gameId = gameData.gameId;
            const memo = `Monte ${gameId.slice(-6)}`;
            const paymentSuccess = await deductKale(cost, memo, "monteDialogue");
            if (paymentSuccess) {
                 activeGame = { id: gameId, cost: cost, type: "Monte" };
                 updateDialogue("✓ Paid! Find the Kale 🥬!", "monteDialogue");
                 renderMonte(gameId, cost, numCards);
            } else { updateDialogue("✗ Payment failed. Game cancelled.", "monteDialogue"); }
        } catch (error) {
            console.error("Error buying Monte game:", error);
            updateDialogue(`✗ Error starting Monte game: ${error.message}`, "monteDialogue");
            fetchBalance();
        } finally { hideLoading(); }
    }

     function renderMonte(gameId, cost, numCards) {
         const monteGame = document.getElementById("monteGame");
         const dialogueId = "monteDialogue";
         monteGame.innerHTML = ""; monteGame.classList.remove("hidden");
         monteGame.className = `game grid-${numCards === 5 ? 5 : numCards === 4 ? 4 : 3}`;
         monteGame.classList.remove('revealed'); monteGame.style.pointerEvents = 'auto';
         for (let i = 0; i < numCards; i++) {
             const card = document.createElement("div");
             card.classList.add("monte-card"); card.textContent = "🌱"; card.dataset.index = i; card.style.pointerEvents = 'auto';
             card.onclick = async () => {
                 if (!activeGame.id || activeGame.type !== "Monte" || monteGame.classList.contains('revealed')) { console.log("Monte click ignored:", activeGame, monteGame.classList.contains('revealed')); return; }
                 const chosenIndex = i + 1;
                 updateDialogue(`You chose card ${chosenIndex}. Checking result...`, dialogueId);
                 monteGame.classList.add('revealed');
                 monteGame.querySelectorAll('.monte-card').forEach(c => c.style.pointerEvents = 'none');
                 const signature = await fetchSignature(gameId, cost); // Use gameId from closure
                 if (signature) { await requestPayout(activeGame.id, activeGame.cost, signature, activeGame.type, [chosenIndex]); }
                 else { updateDialogue("✗ Failed to secure game for payout.", dialogueId); activeGame = { id: null, cost: 0, type: null }; }
                 setTimeout(async () => {
                    monteGame.querySelectorAll('.monte-card').forEach(c => { c.textContent = "?"; c.classList.add('revealed'); });
                    const chosenCardElement = monteGame.querySelector(`[data-index="${i}"]`);
                    if (chosenCardElement) { chosenCardElement.style.border = '2px solid blue'; }
                    setTimeout(() => { monteGame.classList.add("hidden"); }, 5000);
                 }, 1000);
             };
             monteGame.appendChild(card);
         }
         updateDialogue(`Find the Kale 🥬! Click a card to make your choice.`, dialogueId);
     }

    // --- Utility & Navigation ---
    function login() {
        const secret = document.getElementById("secretKey").value;
        if (!secret || !secret.startsWith("S") || secret.length !== 56) { updateDialogue("✗ Invalid Secret Key format!", "dialogue"); return; }
        try {
            playerKeypair = StellarSdk.Keypair.fromSecret(secret);
            updateDialogue(`Logging in as ${playerKeypair.publicKey().substring(0, 8)}...`, "dialogue");
            ensureTrustline().then(trustlineOk => {
                if (trustlineOk) { fetchBalance().then(() => { showScreen("menu"); updateDialogue(`✓ Logged in! Welcome!`, "dialogue"); }); }
                else { hideLoading(); }
            });
        } catch (e) { console.error("Login error:", e); updateDialogue("✗ Invalid Secret Key!", "dialogue"); }
    }

    function logout() {
        playerKeypair = null; playerBalance = 0; updateBalanceDisplay();
        document.getElementById("secretKey").value = "";
        updateDialogue(`✓ Logged out. Thanks for playing!`, "dialogue");
        showScreen("splash"); setTimeout(() => showScreen("login"), 2000);
    }
    function backToMenu() { showScreen("menu"); }
    function showScratchOffs() { showScreen("scratch"); }
    function showSlots() { showScreen("slots"); }
    function showMonte() { showScreen("monte"); }
    function showDonation() { showScreen("donation"); }

    // --- Initialization ---
    updateBackground("splash"); setTimeout(() => showScreen("login"), 1500);

    // Expose functions to global scope
    window.login = login; window.logout = logout; window.backToMenu = backToMenu;
    window.buyScratchCard = buyScratchCard; window.buySlots = buySlots; window.buyMonte = buyMonte;
    window.showScratchOffs = showScratchOffs; window.showSlots = showSlots; window.showMonte = showMonte;
    window.showDonation = showDonation;
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initApp); } else { initApp(); }
