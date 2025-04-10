// app.js (MODIFIED for Freighter Integration - with MORE debug logs)

// Make sure freighterApi is available globally if using the CDN script
// import { isConnected, getPublicKey, signTransaction } from "@stellar/freighter-api"; // Use this if bundling

function initApp() {
    // Ensure StellarSdk is loaded
    if (typeof StellarSdk === 'undefined') {
        console.error("Stellar SDK not loaded!");
        alert("Error: Stellar SDK failed to load. Please refresh.");
        return;
    }
    // Check if Freighter is available
    const freighterInstalled = typeof window.freighterApi !== 'undefined' && window.freighterApi.isConnected; // Basic check

    const server = new StellarSdk.Horizon.Server("https://horizon.stellar.org");
    const NETWORK_PASSPHRASE = StellarSdk.Networks.PUBLIC; // PUBLIC or TESTNET
    const BANK_PUBLIC_KEY = "GC5FWTU5MP4HUOFWCQGFHTPFERFFNBL2QOKMJJQINLAV2G4QVQ6PFDL7"; // Bank's public key
    const KALE_ISSUER = "GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE"; // KALE asset issuer
    const KALE_ASSET_CODE = "KALE";
    const kale_asset = new StellarSdk.Asset(KALE_ASSET_CODE, KALE_ISSUER);
    const BANK_API_URL = "https://kalecasino.pythonanywhere.com";

    // *** State Variables Changed ***
    let playerPublicKey = null; // Store public key instead of keypair
    let playerBalance = 0;
    let activeGame = { id: null, cost: 0, type: null };

    const symbols = ["🍅", "🥕", "🥒", "🥔", "🌽", "🥦", "🍆", "🍠", "🥬", "👩‍🌾"];
    const LOCALSTORAGE_KEY = 'kaleCasinoPublicKey';

    // --- UI Functions (Mostly Unchanged) ---
    function showScreen(screenId) {
        document.querySelectorAll(".screen").forEach(screen => screen.classList.add("hidden"));
        const screen = document.getElementById(screenId);
        if (screen) screen.classList.remove("hidden");

        const dialogueId = screenId === 'menu' ? 'dialogue' : screenId === 'login' ? 'loginDialogue' : `${screenId}Dialogue`;
        const gameContainerId = screenId === 'scratch' ? 'scratchCard' : screenId === 'slots' ? 'slotsGame' : screenId === 'monte' ? 'monteGame' : null;

        updateDialogue(" ", dialogueId);
        if(gameContainerId) {
            const gameContainer = document.getElementById(gameContainerId);
            if(gameContainer) gameContainer.classList.add('hidden');
        }

        if (screenId !== "splash" && screenId !== "login") {
            document.getElementById("balanceBar").classList.remove("hidden");
            fetchBalance();
        } else {
            document.getElementById("balanceBar").classList.add("hidden");
        }
        updateBackground(screenId);
        // Don't reset active game here, reset it when payout completes or fails
        // activeGame = { id: null, cost: 0, type: null };
    }

    function updateBackground(screenId) {
        document.body.className = '';
        document.body.classList.add(`bg-${screenId}`);
    }

    function updateDialogue(message, dialogueId = "dialogue") {
        // Ensure dialogueId targets the correct element (e.g., loginDialogue)
        const dialogue = document.getElementById(dialogueId);
        if (dialogue) dialogue.innerHTML = message;
        else console.warn("Dialogue element not found:", dialogueId); // Warn if element missing
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

    // --- Stellar Interaction (Modified for Freighter) ---

    async function fetchBalance() {
        // *** Use playerPublicKey ***
        if (!playerPublicKey) return;
        try {
            // *** Use playerPublicKey ***
            const account = await server.loadAccount(playerPublicKey);
            const kaleBalance = account.balances.find(b => b.asset_code === KALE_ASSET_CODE && b.asset_issuer === KALE_ISSUER);
            playerBalance = kaleBalance ? parseFloat(kaleBalance.balance) : 0;
            updateBalanceDisplay();
        } catch (e) {
             if (e.response && e.response.status === 404) {
                 playerBalance = 0; updateBalanceDisplay();
                 console.warn("Account not found or doesn't trust KALE.");
                 // Optionally prompt user about missing trustline/funding
             } else {
                  console.error("Error fetching balance:", e);
                  updateDialogue(`✗ Error fetching balance.`, 'dialogue'); // Use general dialogue for balance errors
             }
        }
    }

    // *** Modified: ensureTrustline uses Freighter ***
     async function ensureTrustline() {
        if (!playerPublicKey) return false;
        showLoading("Checking KALE Trustline...");
        try {
            const account = await server.loadAccount(playerPublicKey);
            const hasTrustline = account.balances.some(
                (b) => b.asset_type === 'native' || (b.asset_code === KALE_ASSET_CODE && b.asset_issuer === KALE_ISSUER)
            );

            if (hasTrustline) {
                updateDialogue("✓ KALE Trustline exists.", "loginDialogue"); // Use login dialogue during setup
                hideLoading();
                return true;
            }

            // If trustline doesn't exist, attempt to create it
            updateDialogue("KALE Trustline needed. Preparing transaction...", "loginDialogue");
            const baseFee = await server.fetchBaseFee();
            const baseReserve = 0.5; const entryReserve = 0.5;
            const minBalance = (2 * baseReserve) + entryReserve; // Basic reserve check
            const xlmBalance = account.balances.find(b => b.asset_type === 'native');

             if (!xlmBalance || parseFloat(xlmBalance.balance) < minBalance + (parseInt(baseFee, 10) / 10000000) + 0.01) { // Add small buffer
                  updateDialogue(`✗ Insufficient XLM balance. Need ~${(minBalance + 0.01).toFixed(2)} XLM to add trustline.`, "loginDialogue");
                  hideLoading(); return false;
             }

            const transaction = new StellarSdk.TransactionBuilder(account, { fee: baseFee, networkPassphrase: NETWORK_PASSPHRASE, })
                .addOperation(StellarSdk.Operation.changeTrust({ asset: kale_asset, limit: '900000000' })) // Generous limit
                .setTimeout(180) // Increased timeout for user interaction
                .build();

            updateDialogue("Please approve the trustline transaction in Freighter.", "loginDialogue");

            const signedXDR = await signWithFreighter(transaction.toXDR());
            if (!signedXDR) {
                // signWithFreighter handles its own error messages
                hideLoading();
                return false;
            }

            showLoading("Submitting trustline transaction...");
            updateDialogue("Submitting trustline transaction...", "loginDialogue");
            const result = await server.submitTransaction(StellarSdk.TransactionBuilder.fromXDR(signedXDR, server.serverURL)); // Submit rehydrated Tx or XDR directly
            console.log("Trustline Tx Result:", result);
            updateDialogue("✓ KALE Trustline established!", "loginDialogue");
            hideLoading();
            return true;

         } catch (e) {
             console.error("Trustline Error:", e.response ? JSON.stringify(e.response.data) : e);
             if (e instanceof Error && e.message.includes("request is pending")) {
                 updateDialogue("✗ Freighter request is already pending. Please check the extension.", "loginDialogue");
             } else if (e.response && e.response.status === 404) {
                  updateDialogue(`✗ Account not found. Please fund ${playerPublicKey.substring(0,8)}... with XLM.`, "loginDialogue");
             } else {
                let errorDetail = e.message || 'Unknown error';
                if (e.response?.data?.extras?.result_codes) {
                   errorDetail = JSON.stringify(e.response.data.extras.result_codes);
                }
                updateDialogue(`✗ Error checking/establishing trustline: ${errorDetail}`, "loginDialogue");
             }
             hideLoading();
             return false;
         }
    }

    // *** Modified: deductKale uses Freighter ***
    async function deductKale(amount, memo, dialogueId) {
        if (!playerPublicKey) return false;
        showLoading("Preparing Payment...");
        updateDialogue("Preparing payment...", dialogueId);
        try {
            const account = await server.loadAccount(playerPublicKey);
            const baseFee = await server.fetchBaseFee();

            // Check KALE balance client-side (basic check)
             const kaleBalance = account.balances.find(b => b.asset_code === KALE_ASSET_CODE && b.asset_issuer === KALE_ISSUER);
             if (!kaleBalance || parseFloat(kaleBalance.balance) < amount) {
                 updateDialogue(`✗ Insufficient KALE balance. Need ${amount}, have ${kaleBalance ? parseFloat(kaleBalance.balance).toFixed(2) : 0}.`, dialogueId);
                 hideLoading();
                 return false;
             }


            const transaction = new StellarSdk.TransactionBuilder(account, { fee: baseFee, networkPassphrase: NETWORK_PASSPHRASE, })
                .addOperation(StellarSdk.Operation.payment({ destination: BANK_PUBLIC_KEY, asset: kale_asset, amount: amount.toString(), }))
                .addMemo(StellarSdk.Memo.text(memo.slice(0, 28)))
                .setTimeout(180) // Increased timeout
                .build();

            updateDialogue("Please approve the payment in Freighter.", dialogueId);

            const signedXDR = await signWithFreighter(transaction.toXDR());
            if (!signedXDR) {
                // Error handled in signWithFreighter
                hideLoading();
                return false;
            }

            showLoading("Submitting payment...");
            updateDialogue("Submitting payment...", dialogueId);
            // Submit the signed transaction XDR
            const result = await server.submitTransaction(StellarSdk.TransactionBuilder.fromXDR(signedXDR, server.serverURL)); // Submit rehydrated Tx or XDR directly
            console.log("Payment Tx Result:", result);
            playerBalance -= amount; updateBalanceDisplay(); // Optimistic update
            updateDialogue(`✓ Paid ${amount} KALE. Good luck!`, dialogueId);
            hideLoading();
            return true;

        } catch (error) {
            // Handle submission errors (already signed)
            console.error("Payment Submission Error:", error.response ? JSON.stringify(error.response.data) : error);
            let errorMsg = "✗ Payment failed.";
             if (error instanceof Error && error.message.includes("request is pending")) {
                 errorMsg = "✗ Freighter request is already pending. Please check the extension.";
             } else if (error.response?.data?.extras?.result_codes) {
                  const codes = error.response.data.extras.result_codes;
                  if (codes.transaction === 'tx_failed' && codes.operations?.[0] === 'op_underfunded') {
                      errorMsg = "✗ Payment failed: Insufficient KALE balance.";
                  } else if (codes.transaction === 'tx_failed' && codes.operations?.[0] === 'op_no_destination') {
                       errorMsg = "✗ Payment failed: Casino bank account may not exist or trust KALE.";
                  } else { errorMsg = `✗ Payment failed: ${codes.transaction || JSON.stringify(codes.operations) || 'Unknown reason'}`; }
             } else if (error.message) { errorMsg += ` ${error.message}`; }
            updateDialogue(errorMsg, dialogueId);
            fetchBalance(); // Refresh balance on error
            hideLoading(); return false;
        }
    }

    // --- NEW: Freighter Interaction Helpers ---

    /**
     * Attempts to connect to Freighter and get the public key.
     * Stores the key in localStorage on success.
     */
    async function connectFreighter() {
        console.log("Connect Freighter button clicked! Attempting to run function..."); // LOG 1

        if (typeof window.freighterApi === 'undefined' || !window.freighterApi.isConnected) {
            console.log("Freighter not installed check."); // LOG 2
            updateDialogue("Freighter is not installed. Please install the extension.", "loginDialogue");
            return;
        }
        console.log("Freighter detected. Updating UI..."); // LOG 3
        updateDialogue("Connecting to Freighter...", "loginDialogue");
        showLoading("Connecting...");
        try {
            // *** ADDED LOGGING AROUND getPublicKey ***
            console.log("Attempting to call window.freighterApi.getPublicKey()..."); // LOG 4
            const publicKey = await window.freighterApi.getPublicKey();
            console.log("window.freighterApi.getPublicKey() call completed. Result:", publicKey); // LOG 5

            if (publicKey) {
                console.log("Public key received:", publicKey); // LOG 6
                playerPublicKey = publicKey;
                updateDialogue(`✓ Connected as ${publicKey.substring(0, 8)}... Checking trustline...`, "loginDialogue");
                try { localStorage.setItem(LOCALSTORAGE_KEY, publicKey); } catch(e) { console.warn("LocalStorage not available", e); }

                console.log("Ensuring trustline..."); // LOG 7
                const trustlineOk = await ensureTrustline();
                console.log("Trustline check result:", trustlineOk); // LOG 8

                if (trustlineOk) {
                    console.log("Trustline OK. Fetching balance and showing menu..."); // LOG 9
                    await fetchBalance();
                    showScreen("menu");
                    updateDialogue(`✓ Ready to play!`, 'dialogue');
                } else {
                    console.log("Trustline check failed. Logging out."); // LOG 10
                    logout();
                }
            } else {
                console.log("getPublicKey() returned null or empty. User likely declined or closed popup."); // LOG 11
                updateDialogue("✗ Connection failed. Please ensure Freighter is unlocked and try again.", "loginDialogue");
                logout();
            }
        } catch (error) {
             // *** ADDED LOGGING INSIDE CATCH ***
            console.error("Freighter connection error occurred in try block:", error); // LOG 12 (Error Object)
             if (error instanceof Error && error.message.includes("request is pending")) {
                 updateDialogue("✗ Freighter request is already pending. Please check the extension.", "loginDialogue");
             } else {
                 // Display the actual error message if available
                updateDialogue(`✗ Error connecting: ${error.message || 'Unknown error'}`, "loginDialogue");
             }
             logout();
        } finally {
            console.log("connectFreighter() finally block reached. Hiding loading."); // LOG 13
            hideLoading();
        }
    }

    /**
     * Checks if Freighter is connected and if a key is stored.
     * Tries to resume session if possible.
     */
     async function checkFreighterConnection() {
        // ... (this function remains the same as before) ...
         if (typeof window.freighterApi === 'undefined' || !window.freighterApi.isConnected) {
            showScreen("login");
            updateDialogue("Freighter is not installed.", "loginDialogue");
            return;
        }

        showLoading("Checking connection...");
        try {
            const isConnected = await window.freighterApi.isConnected();
            const storedKey = localStorage.getItem(LOCALSTORAGE_KEY);

            if (isConnected && storedKey) {
                 const currentKey = await window.freighterApi.getPublicKey();
                 if (currentKey === storedKey) {
                    playerPublicKey = currentKey;
                    updateDialogue(`✓ Resumed session for ${playerPublicKey.substring(0, 8)}...`, 'dialogue');
                    await fetchBalance();
                    showScreen("menu");
                    hideLoading();
                    return;
                 } else {
                     console.log("Freighter account changed. Clearing stored key.");
                     logout();
                 }
            } else {
                 logout();
            }
        } catch (error) {
            console.error("Error checking Freighter connection:", error);
             updateDialogue(`✗ Error checking connection: ${error.message || 'Unknown error'}. Please try connecting manually.`, "loginDialogue");
             logout();
        }
         showScreen("login");
         updateDialogue("Please connect your wallet.", "loginDialogue");
         hideLoading();
    }


    /**
     * Signs a transaction XDR using Freighter.
     * @param {string} transactionXDR - The base64 encoded XDR of the unsigned transaction.
     * @returns {Promise<string|null>} - The signed transaction XDR or null if signing failed.
     */
     async function signWithFreighter(transactionXDR) {
        // ... (this function remains the same as before) ...
         if (!playerPublicKey || typeof window.freighterApi === 'undefined' || !window.freighterApi.isConnected) {
             updateDialogue("Not connected. Please connect Freighter.", "dialogue");
             return null;
         }
         try {
            const signedXDR = await window.freighterApi.signTransaction(transactionXDR, {
                network: NETWORK_PASSPHRASE === StellarSdk.Networks.PUBLIC ? 'PUBLIC' : 'TESTNET'
            });
             return signedXDR;
         } catch (error) {
            console.error("Freighter Signing Error:", error);
             let errorMsg = "✗ Transaction signing failed.";
             if (error && error.message) {
                 if (error.message.includes("User declined")) {
                    errorMsg = "✗ Transaction rejected in Freighter.";
                 } else if (error.message.includes("request is pending")) {
                     errorMsg = "✗ Freighter request is already pending. Please check the extension.";
                 } else {
                     errorMsg = `✗ Signing error: ${error.message}`;
                 }
             }
             const currentDialogueId = activeGame.type ? `${activeGame.type.toLowerCase()}Dialogue` : "loginDialogue";
             updateDialogue(errorMsg, currentDialogueId);
             return null;
         }
     }

    // --- Backend Interaction (Unchanged) ---
    async function fetchSignature(gameId, cost) {
        // ... (this function remains the same as before) ...
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
             updateDialogue(`✗ Error securing game: ${error.message}`, activeGame.type ? `${activeGame.type.toLowerCase()}Dialogue` : 'dialogue');
             hideLoading(); return null;
         }
    }

     async function requestPayout(gameId, cost, signature, gameType, choices) {
        // ... (this function remains the same as before) ...
        if (!gameId || !cost || !signature || !playerPublicKey) return null;
        showLoading("Checking Result...");
        const dialogueId = `${gameType.toLowerCase()}Dialogue`;
        updateDialogue("Checking results with the bank...", dialogueId);
        try {
            const response = await fetch(`${BANK_API_URL}/payout`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    game_id: gameId, cost: cost, signature: signature,
                    destination: playerPublicKey,
                    game_type: gameType, choices: choices })
            });

            if (!response.ok) {
                let errorJson; try { errorJson = await response.json(); } catch (e) {}
                throw new Error(errorJson?.error || errorJson?.message || `Payout request failed: ${response.status}`);
            }

            const data = await response.json();
            console.log("Payout response:", data);

            if (data.status === "success") {
                const winnings = data.amount;
                 const spentCost = activeGame.cost;
                 activeGame = { id: null, cost: 0, type: null };
                 let message = `You spent ${spentCost} KALE. `;
                 if (winnings > 0) {
                    message += `🏆 You won ${winnings.toFixed(2)} KALE! Payout sent. Balance updating...`;
                    setTimeout(fetchBalance, 4000);
                 } else {
                    message += `😭 No win this time. Better luck next time!`;
                 }
                 updateDialogue(message, dialogueId);
                 return data;
            } else {
                 updateDialogue(`✗ Payout check failed: ${data.message || data.error || 'Bank error.'}`, dialogueId);
                  activeGame = { id: null, cost: 0, type: null };
            }
        } catch (error) {
            console.error("Error processing winnings:", error);
            const errorMessage = error.message || "An unknown network error occurred.";
             updateDialogue(`✗ Error: ${errorMessage}`, dialogueId);
             activeGame = { id: null, cost: 0, type: null };
        } finally {
            hideLoading();
        }
        return null;
    }

    // --- Game Logic Functions (buyScratchCard, startScratchGame, buySlots, animateSlots, buyMonte, renderMonte) ---
    // ... (These functions remain the same internally as the previous version) ...
     async function buyScratchCard(cost) {
         if (activeGame.id) { updateDialogue("Please wait for the current game to finish.", "scratchDialogue"); return; }
         if (!playerPublicKey) { updateDialogue("Please connect your wallet first.", "scratchDialogue"); return; }
         if (playerBalance < cost) { updateDialogue(`✗ Need ${cost} KALE, you have ${playerBalance.toFixed(2)}!`, "scratchDialogue"); return; }
        showLoading("Initializing Scratch Card...");
        updateDialogue("Getting your scratch card ready...", "scratchDialogue");
        try {
            activeGame = { id: `temp-${Date.now()}`, cost: cost, type: "Scratch" };
            const initResponse = await fetch(`${BANK_API_URL}/init_scratch_game`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cost: cost }), });
            if (!initResponse.ok) { let errorJson; try { errorJson = await initResponse.json(); } catch(e){} throw new Error(errorJson?.error || `HTTP error ${initResponse.status}`); }
            const gameData = await initResponse.json();
            const gameId = gameData.gameId; const seedlings = gameData.seedlings;
            activeGame.id = gameId;
            const memo = `Scratch ${gameId.slice(-6)}`;
            const paymentSuccess = await deductKale(cost, memo, "scratchDialogue");
            if (paymentSuccess) {
                 startScratchGame(gameId, cost, seedlings);
            } else {
                activeGame = { id: null, cost: 0, type: null };
            }
         } catch (error) {
             console.error("Error buying scratch card:", error);
             updateDialogue(`✗ Error starting scratch game: ${error.message}`, "scratchDialogue");
             fetchBalance();
             activeGame = { id: null, cost: 0, type: null };
         } finally { hideLoading(); }
    }
     function startScratchGame(gameId, cost, seedlings) {
         const scratchCard = document.getElementById("scratchCard");
         const dialogueId = "scratchDialogue";
         scratchCard.innerHTML = ""; scratchCard.classList.remove("hidden");
         scratchCard.className = `game grid-${seedlings === 9 ? 9 : seedlings === 3 ? 3 : 12}`;
         scratchCard.style.pointerEvents = 'auto';
         let revealedCount = 0; let revealedSymbols = Array(seedlings).fill(null);
         let isGameConcluding = false;
         updateDialogue("Card ready! Click the 🌱 to reveal.", dialogueId);
         for (let i = 0; i < seedlings; i++) {
             const spot = document.createElement("div");
             spot.classList.add("scratch-spot"); spot.textContent = "🌱"; spot.dataset.index = i;
             spot.onclick = async () => {
                 if (!activeGame.id || activeGame.id !== gameId || spot.classList.contains("revealed") || spot.classList.contains("revealing") || isGameConcluding) { return; }
                 spot.classList.add("revealing"); spot.textContent = "🤔";
                 if (!isGameConcluding) updateDialogue("Revealing spot...", dialogueId);
                 try {
                     const response = await fetch(`${BANK_API_URL}/reveal_spot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId: gameId, index: i }), });
                     if (response.ok) {
                         const data = await response.json(); const symbol = data.symbol;
                         spot.textContent = symbol; spot.classList.remove("revealing"); spot.classList.add("revealed");
                         revealedCount++; revealedSymbols[i] = symbol;
                         if (revealedCount === seedlings && !isGameConcluding) {
                             isGameConcluding = true;
                             updateDialogue("All spots revealed! Checking results...", dialogueId);
                             scratchCard.style.pointerEvents = 'none';
                             const signature = await fetchSignature(gameId, cost);
                             if (signature && activeGame.id === gameId) {
                                await requestPayout(gameId, cost, signature, "Scratch", null);
                            } else if (!signature) {
                                updateDialogue("✗ Failed to secure game for payout.", dialogueId);
                                activeGame = { id: null, cost: 0, type: null };
                            }
                             setTimeout(() => { scratchCard.classList.add("hidden"); }, 5000);
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
     async function buySlots(cost, reels) {
        if (activeGame.id) { updateDialogue("Please wait for the current game to finish.", "slotsDialogue"); return; }
        if (!playerPublicKey) { updateDialogue("Please connect your wallet first.", "slotsDialogue"); return; }
        if (playerBalance < cost) { updateDialogue(`✗ Need ${cost} KALE, you have ${playerBalance.toFixed(2)}!`, "slotsDialogue"); return; }
        showLoading("Preparing Slots...");
        updateDialogue("Placing your bet...", "slotsDialogue");
        try {
             activeGame = { id: `temp-${Date.now()}`, cost: cost, type: "Slots" };
             const gameStartTime = Date.now(); const memo = `Slots ${cost}-${gameStartTime.toString().slice(-6)}`;
             const paymentSuccess = await deductKale(cost, memo, "slotsDialogue");
             if (!paymentSuccess) {
                 activeGame = { id: null, cost: 0, type: null };
                 hideLoading(); return;
             }
             updateDialogue("Spinning reels...", "slotsDialogue");
             const response = await fetch(`${BANK_API_URL}/play_slots`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cost: cost, num_reels: reels }), });
             if (!response.ok) { let errorJson; try { errorJson = await response.json(); } catch(e){} throw new Error(errorJson?.error || `HTTP error ${response.status}`); }
             const data = await response.json();
             const gameId = data.gameId; const finalReels = data.result;
             activeGame.id = gameId;
             console.log("Slots gameId received from /play_slots:", gameId);
             console.log("Set activeGame.id to:", activeGame.id);
             await animateSlots(reels, finalReels);
             updateDialogue("Spin finished! Checking results...", "slotsDialogue");
             const signature = await fetchSignature(gameId, cost);
             if (signature && activeGame.id === gameId) {
                console.log(`Calling requestPayout for Slots with gameId: ${gameId}, cost: ${cost}, type: Slots`);
                 await requestPayout(gameId, cost, signature, "Slots", null);
             } else if (!signature) {
                 updateDialogue("✗ Failed to secure game for payout.", "slotsDialogue");
                 fetchBalance();
                 activeGame = { id: null, cost: 0, type: null };
             }
             setTimeout(() => { const slotsGame = document.getElementById("slotsGame"); if(slotsGame) slotsGame.classList.add("hidden"); }, 5000);
         } catch (error) {
             console.error("Error playing slots:", error);
             updateDialogue(`✗ Error playing slots: ${error.message}`, "slotsDialogue");
             fetchBalance();
             activeGame = { id: null, cost: 0, type: null };
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
                     if (elapsedTime < stopTime) {
                         reelElements[i].textContent = symbols[Math.floor(Math.random() * symbols.length)];
                         allStopped = false;
                     } else {
                         reelElements[i].textContent = finalResult[i];
                     }
                 }
                 if (allStopped) {
                     clearInterval(spinInterval);
                     resolve();
                 }
             }, intervalTime);
         });
     }
     async function buyMonte(cost, cards) {
        if (activeGame.id) { updateDialogue("Please wait for the current game to finish.", "monteDialogue"); return; }
        if (!playerPublicKey) { updateDialogue("Please connect your wallet first.", "monteDialogue"); return; }
        if (playerBalance < cost) { updateDialogue(`✗ Need ${cost} KALE, you have ${playerBalance.toFixed(2)}!`, "monteDialogue"); return; }
        showLoading("Preparing Monte Game...");
        updateDialogue(`Shuffling ${cards} cards...`, "monteDialogue");
        try {
            activeGame = { id: `temp-${Date.now()}`, cost: cost, type: "Monte" };
            const initResponse = await fetch(`${BANK_API_URL}/init_monte_game`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cost: cost }), });
            if (!initResponse.ok) { let errorJson; try { errorJson = await initResponse.json(); } catch(e){} throw new Error(errorJson?.error || `HTTP error ${initResponse.status}`); }
            const gameData = await initResponse.json();
            const gameId = gameData.gameId; const numCards = gameData.numCards;
            activeGame.id = gameId;
            const memo = `Monte ${numCards}-${gameId.slice(-6)}`;
            const paymentSuccess = await deductKale(cost, memo, "monteDialogue");
            if (paymentSuccess) {
                 renderMonte(gameId, numCards);
            } else {
                activeGame = { id: null, cost: 0, type: null };
            }
         } catch (error) {
             console.error("Error buying Monte game:", error);
             updateDialogue(`✗ Error starting Monte game: ${error.message}`, "monteDialogue");
             fetchBalance();
             activeGame = { id: null, cost: 0, type: null };
         } finally { hideLoading(); }
     }
     async function renderMonte(gameId, numCards) {
         const monteGame = document.getElementById("monteGame");
         const dialogueId = "monteDialogue";
         monteGame.innerHTML = ""; monteGame.classList.remove("hidden");
         monteGame.className = `game grid-${numCards}`;
         monteGame.style.pointerEvents = 'auto';
         updateDialogue("Find the 🥬! Click a card to guess.", dialogueId);
         const cards = Array.from({ length: numCards }, (_, i) => i + 1);
         cards.forEach(cardNumber => {
             const card = document.createElement("div");
             card.classList.add("monte-card"); card.textContent = "?"; card.dataset.position = cardNumber;
             card.onclick = async () => {
                 if (!activeGame.id || activeGame.id !== gameId || card.classList.contains("revealed")) return;
                 card.textContent = "🤔"; card.style.pointerEvents = 'none';
                 updateDialogue(`You guessed card ${cardNumber}. Checking...`, dialogueId);
                 const signature = await fetchSignature(gameId, activeGame.cost);
                 if (signature && activeGame.id === gameId) {
                     const payoutData = await requestPayout(gameId, activeGame.cost, signature, "Monte", [cardNumber]);
                     if (payoutData && payoutData.finalLayout) {
                         const finalLayout = payoutData.finalLayout;
                         monteGame.innerHTML = ""; // Clear ? cards
                         finalLayout.forEach((symbol, index) => {
                             const revealedCard = document.createElement("div");
                             revealedCard.classList.add("monte-card", "revealed");
                             revealedCard.textContent = symbol;
                             if (symbol === "🥬") revealedCard.classList.add("kale-card");
                             monteGame.appendChild(revealedCard);
                         });
                     } else {
                         updateDialogue("✗ Error revealing results.", dialogueId);
                         activeGame = { id: null, cost: 0, type: null };
                     }
                 } else if (!signature) {
                     updateDialogue("✗ Failed to secure game for payout.", dialogueId);
                     activeGame = { id: null, cost: 0, type: null };
                 }
                 setTimeout(() => { monteGame.classList.add("hidden"); }, 5000);
             };
             monteGame.appendChild(card);
         });
     }

    // --- Navigation ---
    function showSplash() { showScreen("splash"); }
    function showLogin() { showScreen("login"); }
    function showMenu() { showScreen("menu"); }
    function showScratchOffs() { showScreen("scratch"); }
    function showSlots() { showScreen("slots"); }
    function showMonte() { showScreen("monte"); }
    function showDonation() { showScreen("donation"); }
    function backToMenu() { showScreen("menu"); }
    function logout() {
        playerPublicKey = null; playerBalance = 0; localStorage.removeItem(LOCALSTORAGE_KEY);
        updateBalanceDisplay(); showScreen("login"); updateDialogue("Disconnected.", "loginDialogue");
    }

    // --- Event Listeners ---
    document.getElementById("connectFreighterBtn").addEventListener("click", connectFreighter);

    // --- Initialization ---
    showSplash();
    setTimeout(showLogin, 1500);
    checkFreighterConnection();

    // --- Debugging ---
    window.debugLogout = logout; // Expose logout for testing
    window.debugAddKale = async (amount) => { // Temporary function for testing
        if (!playerPublicKey) { console.error("Not connected."); return; }
        showLoading(`Adding ${amount} KALE (DEBUG)...`);
        try {
            const response = await fetch(`${BANK_API_URL}/debug/add_kale`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ public_key: playerPublicKey, amount: amount })
            });
            if (response.ok) {
                const data = await response.json();
                console.log("Debug Add KALE Response:", data);
                await fetchBalance();
                updateDialogue(`✓ Added ${amount} KALE (DEBUG).`, 'dialogue');
            } else {
                const errorData = await response.json();
                console.error("Debug Add KALE Error:", errorData);
                updateDialogue(`✗ Error adding KALE (DEBUG): ${errorData.error || response.statusText}`, 'dialogue');
            }
        } catch (error) {
            console.error("Debug Add KALE Network Error:", error);
            updateDialogue(`✗ Network error adding KALE (DEBUG).`, 'dialogue');
        } finally { hideLoading(); }
    };

}

// Initialize the app when the script loads
document.addEventListener('DOMContentLoaded', initApp);
