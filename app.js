// app.js (MODIFIED)

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
                   .addOperation(StellarSdk.Operation.changeTrust({ asset: kale_asset, limit: '900000000' })) // Generous limit
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
                .addMemo(StellarSdk.Memo.text(memo.slice(0, 28))) // Max 28 chars for memo
                .setTimeout(60).build();
            transaction.sign(playerKeypair);
            const result = await server.submitTransaction(transaction);
            console.log("Payment Tx Result:", result); // Keep this log
            playerBalance -= amount; updateBalanceDisplay();
            // **MODIFICATION: Clearer payment confirmation **
            updateDialogue(`✓ Paid ${amount} KALE. Good luck!`, dialogueId);
            hideLoading(); return true;
        } catch (error) {
            console.error("Payment Error:", error.response ? error.response.data : error);
             let errorMsg = "✗ Payment failed.";
             if (error.response?.data?.extras?.result_codes) { // Optional chaining
                  const codes = error.response.data.extras.result_codes;
                  if (codes.transaction === 'tx_failed' && codes.operations?.[0] === 'op_underfunded') { // Optional chaining
                      errorMsg = "✗ Payment failed: Insufficient KALE balance.";
                  } else if (codes.transaction === 'tx_failed' && codes.operations?.[0] === 'op_no_destination') {
                       errorMsg = "✗ Payment failed: Casino bank account may not exist or trust KALE.";
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
             updateDialogue(`✗ Error securing game: ${error.message}`, activeGame.type ? `${activeGame.type.toLowerCase()}Dialogue` : 'dialogue'); // Ensure lowercase type matches ID
             hideLoading(); return null;
         }
    }

    // *** MODIFICATION: requestPayout now returns the data on success ***
    async function requestPayout(gameId, cost, signature, gameType, choices) {
        if (!gameId || !cost || !signature || !playerKeypair) return null; // Return null on initial failure
        showLoading("Checking Result...");
        const dialogueId = `${gameType.toLowerCase()}Dialogue`; // Ensure lowercase matches element ID
        updateDialogue("Checking results with the bank...", dialogueId);
        try {
            const response = await fetch(`${BANK_API_URL}/payout`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ game_id: gameId, cost: cost, signature: signature,
                    destination: playerKeypair.publicKey(), game_type: gameType, choices: choices })
            });

            if (!response.ok) {
                let errorJson; try { errorJson = await response.json(); } catch (e) {}
                throw new Error(errorJson?.error || errorJson?.message || `Payout request failed: ${response.status}`);
            }

            const data = await response.json();
            console.log("Payout response:", data);

            // *** MODIFICATION: Clearer win/loss message ***
            if (data.status === "success") {
                const winnings = data.amount;
                let message = `You spent ${cost} KALE. `;
                if (winnings > 0) {
                    message += `🏆 You won ${winnings.toFixed(2)} KALE! Payout sent. Balance updating...`;
                    setTimeout(fetchBalance, 4000); // Update balance after a delay to allow payout processing
                } else {
                    message += `😭 No win this time. Better luck next time!`;
                     // Optionally update balance even on loss if needed, though it shouldn't change
                     // setTimeout(fetchBalance, 1000);
                }
                 updateDialogue(message, dialogueId);
                 activeGame = { id: null, cost: 0, type: null }; // Clear active game *after* successful processing
                 return data; // Return the full data object for Monte layout
            } else {
                 // Handle specific bank-side errors reported in the JSON
                 updateDialogue(`✗ Payout check failed: ${data.message || data.error || 'Bank error.'}`, dialogueId);
            }
        } catch (error) {
            console.error("Error processing winnings:", error);
            const errorMessage = error.message || "An unknown network error occurred.";
             updateDialogue(`✗ Error: ${errorMessage}`, dialogueId); // Update dialogue on error
        } finally {
            hideLoading();
            // Ensure activeGame is reset if something went wrong before success block
            if (activeGame.id === gameId) { // Only reset if it's still the same game
                 activeGame = { id: null, cost: 0, type: null };
            }
        }
        return null; // Return null if payout wasn't successful or fetch failed
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
                 // Message updated in deductKale on success
                 startScratchGame(gameId, cost, seedlings);
            } else { /* Message handled in deductKale */ }
         } catch (error) {
             console.error("Error buying scratch card:", error);
             updateDialogue(`✗ Error starting scratch game: ${error.message}`, "scratchDialogue");
             fetchBalance(); // Update balance in case of error after payment attempt
         } finally { hideLoading(); }
    }

     function startScratchGame(gameId, cost, seedlings) {
         const scratchCard = document.getElementById("scratchCard");
         const dialogueId = "scratchDialogue";
         scratchCard.innerHTML = ""; scratchCard.classList.remove("hidden");
         // Ensure correct grid class based on seedling count
         scratchCard.className = `game grid-${seedlings === 9 ? 9 : seedlings === 3 ? 3 : 12}`;
         scratchCard.style.pointerEvents = 'auto';
         let revealedCount = 0; let revealedSymbols = Array(seedlings).fill(null);
         let isGameConcluding = false; // Flag to prevent multiple payouts

         updateDialogue("Card ready! Click the 🌱 to reveal.", dialogueId); // Initial instruction

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
                             scratchCard.style.pointerEvents = 'none'; // Disable further clicks
                             const signature = await fetchSignature(gameId, cost);
                             if (signature) {
                                 // Call payout, message handled inside requestPayout
                                await requestPayout(activeGame.id, activeGame.cost, signature, activeGame.type, null);
                            } else {
                                updateDialogue("✗ Failed to secure game for payout.", dialogueId);
                                activeGame = { id: null, cost: 0, type: null }; // Reset game if signature fails
                            }
                             setTimeout(() => { scratchCard.classList.add("hidden"); }, 5000); // Hide card after result
                         } else if (!isGameConcluding) {
                             updateDialogue(`Spot revealed! ${seedlings - revealedCount} remaining.`, dialogueId);
                         }
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
     }

    // SLOTS
     async function buySlots(cost, reels) {
        if (activeGame.id) { updateDialogue("Finish the current game first!", "slotsDialogue"); return; }
        if (playerBalance < cost) { updateDialogue(`✗ Need ${cost} KALE, you have ${playerBalance.toFixed(2)}!`, "slotsDialogue"); return; }
        showLoading("Preparing Slots...");
        updateDialogue("Placing your bet...", "slotsDialogue");
        const gameStartTime = Date.now(); const memo = `Slots ${cost}-${gameStartTime.toString().slice(-6)}`;
        const paymentSuccess = await deductKale(cost, memo, "slotsDialogue");
        if (!paymentSuccess) { hideLoading(); return; }
        // Message updated in deductKale
        updateDialogue("Spinning reels...", "slotsDialogue"); // Update after payment success
        try {
            const response = await fetch(`${BANK_API_URL}/play_slots`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cost: cost, num_reels: reels }), });
            if (!response.ok) { let errorJson; try { errorJson = await response.json(); } catch(e){} throw new Error(errorJson?.error || `HTTP error ${response.status}`); }
            const data = await response.json();
            const gameId = data.gameId; const finalReels = data.result;
            console.log("Slots gameId received from /play_slots:", gameId); // Keep log
            activeGame = { id: gameId, cost: cost, type: "Slots" };
             console.log("Set activeGame.id to:", activeGame.id); // Keep log
            await animateSlots(reels, finalReels);
            updateDialogue("Spin finished! Checking results...", "slotsDialogue");
            const signature = await fetchSignature(gameId, cost);
            if (signature) {
                console.log(`Calling requestPayout for Slots with gameId: ${activeGame.id}, cost: ${activeGame.cost}, type: ${activeGame.type}`); // Keep log
                // Call payout, message handled inside requestPayout
                 await requestPayout(activeGame.id, activeGame.cost, signature, activeGame.type, null);
            } else {
                updateDialogue("✗ Failed to secure game for payout.", "slotsDialogue");
                fetchBalance(); // Fetch balance if signature failed after payment
                activeGame = { id: null, cost: 0, type: null };
            }
            setTimeout(() => { const slotsGame = document.getElementById("slotsGame"); if(slotsGame) slotsGame.classList.add("hidden"); }, 5000); // Hide reels after result
        } catch (error) {
            console.error("Error playing slots:", error);
            updateDialogue(`✗ Error playing slots: ${error.message}`, "slotsDialogue");
            fetchBalance(); // Fetch balance on error
            activeGame = { id: null, cost: 0, type: null };
        } finally { hideLoading(); }
    }

     async function animateSlots(reels, finalResult) {
         const slotsGame = document.getElementById("slotsGame");
         slotsGame.innerHTML = ""; slotsGame.classList.remove("hidden");
         // Ensure correct grid class
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
                     // Stagger the stop times
                     const stopTime = (spinDuration * 0.5) + (i * spinDuration * 0.5 / reels);
                     if (elapsedTime < stopTime) { reelElements[i].textContent = symbols[Math.floor(Math.random() * symbols.length)]; allStopped = false; }
                     else { reelElements[i].textContent = finalResult[i]; } // Lock in final symbol
                 }
                 if (allStopped || elapsedTime >= spinDuration + 500) { // Add buffer time
                     clearInterval(spinInterval);
                     // Ensure final state is correct
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
                 // Message updated in deductKale
                 renderMonte(gameId, cost, numCards);
            } else { /* Message handled in deductKale */ }
        } catch (error) {
            console.error("Error buying Monte game:", error);
            updateDialogue(`✗ Error starting Monte game: ${error.message}`, "monteDialogue");
            fetchBalance();
        } finally { hideLoading(); }
    }

    // *** MODIFICATION: renderMonte uses payoutData to show final layout ***
     function renderMonte(gameId, cost, numCards) {
         const monteGame = document.getElementById("monteGame");
         const dialogueId = "monteDialogue";
         monteGame.innerHTML = ""; monteGame.classList.remove("hidden");
         // Ensure correct grid class
         monteGame.className = `game grid-${numCards === 5 ? 5 : numCards === 4 ? 4 : 3}`;
         monteGame.classList.remove('revealed'); // Ensure revealed class is removed initially
         monteGame.style.pointerEvents = 'auto'; // Ensure cards are clickable initially

         updateDialogue(`Find the Kale 🥬! Click a card to make your choice.`, dialogueId); // Initial instruction

         for (let i = 0; i < numCards; i++) {
             const card = document.createElement("div");
             card.classList.add("monte-card");
             card.textContent = "❓"; // Show question mark initially
             card.dataset.index = i;
             card.style.pointerEvents = 'auto'; // Make sure individual cards are clickable

             card.onclick = async () => {
                 // Prevent clicking if game ended or already revealed
                 if (!activeGame.id || activeGame.type !== "Monte" || monteGame.classList.contains('revealed')) {
                     console.log("Monte click ignored:", activeGame, monteGame.classList.contains('revealed'));
                     return;
                 }
                 const chosenIndex = i + 1; // 1-based index for backend
                 const chosenCardElement = card; // Reference to the clicked card

                 updateDialogue(`You chose card ${chosenIndex}. Checking result...`, dialogueId);
                 monteGame.classList.add('revealed'); // Mark game as revealed to prevent further clicks
                 monteGame.querySelectorAll('.monte-card').forEach(c => c.style.pointerEvents = 'none'); // Disable all cards

                 const signature = await fetchSignature(gameId, cost); // Use gameId from closure

                 let payoutData = null; // Variable to hold result from payout
                 if (signature) {
                     payoutData = await requestPayout(activeGame.id, activeGame.cost, signature, activeGame.type, [chosenIndex]);
                     // Payout message is now handled inside requestPayout
                 } else {
                     updateDialogue("✗ Failed to secure game for payout.", dialogueId);
                     activeGame = { id: null, cost: 0, type: null }; // Reset if signature fails
                 }

                 // Reveal cards AFTER payout attempt using the returned data
                 // Use a short delay for visual effect if desired
                 setTimeout(() => {
                    const allCardElements = monteGame.querySelectorAll('.monte-card');
                    if (payoutData && payoutData.status === 'success' && payoutData.finalLayout) {
                         const finalLayout = payoutData.finalLayout;
                         allCardElements.forEach((c, index) => {
                             c.textContent = finalLayout[index] || '!'; // Show actual symbol or '!' if layout mismatch
                             c.classList.add('revealed'); // Add class to style revealed cards if needed
                             if (finalLayout[index] === '🥬') {
                                 c.classList.add('kale-card'); // Optional: highlight kale
                             }
                         });
                     } else {
                         // Fallback if finalLayout isn't available (error during payout/bank issue)
                         allCardElements.forEach(c => {
                             c.textContent = "!"; // Indicate an issue revealing
                             c.classList.add('revealed');
                         });
                         // Dialogue message already updated in requestPayout for errors
                         updateDialogue("Could not retrieve final card layout. Result already determined.", dialogueId);
                     }

                     // Highlight the player's chosen card
                     if (chosenCardElement) {
                         chosenCardElement.style.border = '3px solid blue'; // Make highlight more prominent
                     }

                     // Hide the game board after a delay
                     setTimeout(() => { monteGame.classList.add("hidden"); }, 5000);
                 }, 500); // Short delay before revealing cards

             };
             monteGame.appendChild(card);
         }
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
                else { hideLoading(); /* Error message handled in ensureTrustline */ }
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
// Ensure the script runs after the DOM is loaded
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initApp); } else { initApp(); }
