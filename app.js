// app.js (MODIFIED for Freighter Integration)

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
    const freighterInstalled = typeof freighterApi !== 'undefined' && freighterApi.isConnected; // Basic check

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
        if (!freighterInstalled) {
            updateDialogue("Freighter is not installed. Please install the extension.", "loginDialogue");
            return;
        }
        updateDialogue("Connecting to Freighter...", "loginDialogue");
        showLoading("Connecting...");
        try {
            const publicKey = await freighterApi.getPublicKey();
            if (publicKey) {
                playerPublicKey = publicKey;
                updateDialogue(`✓ Connected as ${publicKey.substring(0, 8)}... Checking trustline...`, "loginDialogue");
                // Store key for session persistence
                try { localStorage.setItem(LOCALSTORAGE_KEY, publicKey); } catch(e) { console.warn("LocalStorage not available", e); }

                const trustlineOk = await ensureTrustline(); // Check/establish trustline after connect
                if (trustlineOk) {
                    await fetchBalance();
                    showScreen("menu");
                    updateDialogue(`✓ Ready to play!`, 'dialogue'); // Use main menu dialogue
                } else {
                    // Error message handled in ensureTrustline
                    logout(); // Log out if trustline fails
                }
            } else {
                updateDialogue("✗ Connection failed. Please ensure Freighter is unlocked and try again.", "loginDialogue");
                logout(); // Ensure clean state
            }
        } catch (error) {
            console.error("Freighter connection error:", error);
             if (error instanceof Error && error.message.includes("request is pending")) {
                 updateDialogue("✗ Freighter request is already pending. Please check the extension.", "loginDialogue");
             } else {
                updateDialogue(`✗ Error connecting: ${error.message || 'Unknown error'}`, "loginDialogue");
             }
             logout(); // Ensure clean state on error
        } finally {
            hideLoading();
        }
    }

    /**
     * Checks if Freighter is connected and if a key is stored.
     * Tries to resume session if possible.
     */
     async function checkFreighterConnection() {
        if (!freighterInstalled) {
            showScreen("login");
            updateDialogue("Freighter is not installed.", "loginDialogue");
            return;
        }

        showLoading("Checking connection...");
        try {
            const isConnected = await freighterApi.isConnected();
            const storedKey = localStorage.getItem(LOCALSTORAGE_KEY);

            if (isConnected && storedKey) {
                 // Verify the connected key matches the stored one
                 const currentKey = await freighterApi.getPublicKey();
                 if (currentKey === storedKey) {
                    playerPublicKey = currentKey;
                    updateDialogue(`✓ Resumed session for ${playerPublicKey.substring(0, 8)}...`, 'dialogue');
                    await fetchBalance();
                    showScreen("menu");
                    hideLoading();
                    return; // Successfully resumed session
                 } else {
                     // Key mismatch, likely user switched accounts in Freighter
                     console.log("Freighter account changed. Clearing stored key.");
                     logout(); // Clear state and prompt for connection
                 }
            } else {
                // Not connected or no stored key
                 logout(); // Ensure clean state
            }
        } catch (error) {
            console.error("Error checking Freighter connection:", error);
             updateDialogue(`✗ Error checking connection: ${error.message || 'Unknown error'}. Please try connecting manually.`, "loginDialogue");
             logout(); // Ensure clean state on error
        }
         // If session couldn't be resumed, show login screen
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
         if (!playerPublicKey || !freighterInstalled) {
             updateDialogue("Not connected. Please connect Freighter.", "dialogue"); // Use general dialogue
             return null;
         }
         try {
            // Request signature from Freighter
             // Pass the network passphrase correctly
            const signedXDR = await freighterApi.signTransaction(transactionXDR, {
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
             // Display error in the *active game's* dialogue, or login dialogue if signing trustline
             const currentDialogueId = activeGame.type ? `${activeGame.type.toLowerCase()}Dialogue` : "loginDialogue";
             updateDialogue(errorMsg, currentDialogueId);
             return null; // Indicate signing failure
         }
     }

    // --- Backend Interaction (Unchanged) ---
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
             updateDialogue(`✗ Error securing game: ${error.message}`, activeGame.type ? `${activeGame.type.toLowerCase()}Dialogue` : 'dialogue');
             hideLoading(); return null;
         }
    }

     async function requestPayout(gameId, cost, signature, gameType, choices) {
        // Use playerPublicKey obtained via Freighter
        if (!gameId || !cost || !signature || !playerPublicKey) return null;
        showLoading("Checking Result...");
        const dialogueId = `${gameType.toLowerCase()}Dialogue`;
        updateDialogue("Checking results with the bank...", dialogueId);
        try {
            const response = await fetch(`${BANK_API_URL}/payout`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    game_id: gameId, cost: cost, signature: signature,
                    destination: playerPublicKey, // Send connected public key
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
                // Get cost from activeGame *before* resetting it
                 const spentCost = activeGame.cost; // Use a temporary variable

                 activeGame = { id: null, cost: 0, type: null }; // Clear active game *after* successful processing

                 let message = `You spent ${spentCost} KALE. `; // Use spentCost
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
                  activeGame = { id: null, cost: 0, type: null }; // Clear game on bank failure too
            }
        } catch (error) {
            console.error("Error processing winnings:", error);
            const errorMessage = error.message || "An unknown network error occurred.";
             updateDialogue(`✗ Error: ${errorMessage}`, dialogueId);
             activeGame = { id: null, cost: 0, type: null }; // Clear game on fetch/network error
        } finally {
            hideLoading();
        }
        return null;
    }

    // --- Game Logic Functions (buyScratchCard, startScratchGame, buySlots, animateSlots, buyMonte, renderMonte) ---
    // These functions remain largely the same, but rely on the modified
    // deductKale, fetchSignature, and requestPayout functions which now use Freighter.
    // Ensure activeGame is set correctly at the start of each game purchase.

     async function buyScratchCard(cost) {
         if (activeGame.id) { updateDialogue("Please wait for the current game to finish.", "scratchDialogue"); return; }
         if (!playerPublicKey) { updateDialogue("Please connect your wallet first.", "scratchDialogue"); return; }
         if (playerBalance < cost) { updateDialogue(`✗ Need ${cost} KALE, you have ${playerBalance.toFixed(2)}!`, "scratchDialogue"); return; }
        showLoading("Initializing Scratch Card...");
        updateDialogue("Getting your scratch card ready...", "scratchDialogue");
        try {
            // Set active game *before* payment attempt, needed for context if payment fails signature step
            activeGame = { id: `temp-${Date.now()}`, cost: cost, type: "Scratch" }; // Temporary ID until backend confirms

            const initResponse = await fetch(`${BANK_API_URL}/init_scratch_game`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cost: cost }), });
            if (!initResponse.ok) { let errorJson; try { errorJson = await initResponse.json(); } catch(e){} throw new Error(errorJson?.error || `HTTP error ${initResponse.status}`); }
            const gameData = await initResponse.json();
            const gameId = gameData.gameId; const seedlings = gameData.seedlings;

            activeGame.id = gameId; // Update with real game ID from backend

            const memo = `Scratch ${gameId.slice(-6)}`;
            const paymentSuccess = await deductKale(cost, memo, "scratchDialogue"); // Uses Freighter
            if (paymentSuccess) {
                 // Message updated in deductKale
                 startScratchGame(gameId, cost, seedlings);
            } else {
                activeGame = { id: null, cost: 0, type: null }; // Reset if payment failed
            }
         } catch (error) {
             console.error("Error buying scratch card:", error);
             updateDialogue(`✗ Error starting scratch game: ${error.message}`, "scratchDialogue");
             fetchBalance(); // Update balance in case of error after payment attempt
             activeGame = { id: null, cost: 0, type: null }; // Reset on error
         } finally { hideLoading(); }
    }

     function startScratchGame(gameId, cost, seedlings) {
        // --- This function remains the same internally ---
        // It calls fetchSignature and requestPayout which are already modified
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
                 if (!activeGame.id || activeGame.id !== gameId || spot.classList.contains("revealed") || spot.classList.contains("revealing") || isGameConcluding) { return; } // Check gameId match
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
                             if (signature && activeGame.id === gameId) { // Check activeGame again before payout
                                await requestPayout(gameId, cost, signature, "Scratch", null);
                            } else if (!signature) {
                                updateDialogue("✗ Failed to secure game for payout.", dialogueId);
                                activeGame = { id: null, cost: 0, type: null }; // Reset if signature fails
                            }
                             setTimeout(() => { scratchCard.classList.add("hidden"); }, 5000);
                         } else if (!isGameConcluding) {
                             updateDialogue(`Spot revealed! ${seedlings - revealedCount} remaining.`, dialogueId);
                         }
                     } else { // Handle reveal error
                         let errorJson; try { errorJson = await response.json(); } catch(e){} console.error("Error revealing spot:", errorJson || response.status);
                         spot.textContent = "Error"; spot.classList.remove("revealing"); updateDialogue(`✗ Error revealing spot: ${errorJson?.error || 'Unknown error'}`, dialogueId);
                         // Should we end the game here? Maybe not automatically.
                     }
                 } catch (error) { // Handle network error during reveal
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
             // Set active game *before* payment attempt
             activeGame = { id: `temp-${Date.now()}`, cost: cost, type: "Slots" };

             const gameStartTime = Date.now(); const memo = `Slots ${cost}-${gameStartTime.toString().slice(-6)}`;
             const paymentSuccess = await deductKale(cost, memo, "slotsDialogue"); // Uses Freighter
             if (!paymentSuccess) {
                 activeGame = { id: null, cost: 0, type: null }; // Reset if payment failed
                 hideLoading(); return;
             }

             // Payment successful, now get game details from backend
             updateDialogue("Spinning reels...", "slotsDialogue");
             const response = await fetch(`${BANK_API_URL}/play_slots`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cost: cost, num_reels: reels }), });
             if (!response.ok) { let errorJson; try { errorJson = await response.json(); } catch(e){} throw new Error(errorJson?.error || `HTTP error ${response.status}`); }
             const data = await response.json();
             const gameId = data.gameId; const finalReels = data.result;

             activeGame.id = gameId; // Update with real game ID

             console.log("Slots gameId received from /play_slots:", gameId);
             console.log("Set activeGame.id to:", activeGame.id);

             await animateSlots(reels, finalReels);
             updateDialogue("Spin finished! Checking results...", "slotsDialogue");

             const signature = await fetchSignature(gameId, cost);
             if (signature && activeGame.id === gameId) { // Check active game again
                console.log(`Calling requestPayout for Slots with gameId: ${gameId}, cost: ${cost}, type: Slots`);
                 await requestPayout(gameId, cost, signature, "Slots", null);
             } else if (!signature) {
                 updateDialogue("✗ Failed to secure game for payout.", "slotsDialogue");
                 fetchBalance(); // Fetch balance if signature failed after payment
                 activeGame = { id: null, cost: 0, type: null };
             }
             setTimeout(() => { const slotsGame = document.getElementById("slotsGame"); if(slotsGame) slotsGame.classList.add("hidden"); }, 5000);
         } catch (error) {
             console.error("Error playing slots:", error);
             updateDialogue(`✗ Error playing slots: ${error.message}`, "slotsDialogue");
             fetchBalance(); // Fetch balance on error
             activeGame = { id: null, cost: 0, type: null }; // Reset on error
         } finally { hideLoading(); }
    }

     async function animateSlots(reels, finalResult) {
         // --- This function remains the same internally ---
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
                 if (allStopped || elapsedTime >= spinDuration + 500) {
                     clearInterval(spinInterval);
                     for (let i = 0; i < reels; i++) { reelElements[i].textContent = finalResult[i]; }
                     resolve();
                 }
             }, intervalTime);
         });
     }

     async function buyMonte(cost, numCards) {
        if (activeGame.id) { updateDialogue("Please wait for the current game to finish.", "monteDialogue"); return; }
        if (!playerPublicKey) { updateDialogue("Please connect your wallet first.", "monteDialogue"); return; }
        if (playerBalance < cost) { updateDialogue(`✗ Need ${cost} KALE, you have ${playerBalance.toFixed(2)}!`, "monteDialogue"); return; }
        showLoading("Initializing Monte Game...");
        updateDialogue("Setting up the cards...", "monteDialogue");

        try {
             // Set active game *before* payment attempt
             activeGame = { id: `temp-${Date.now()}`, cost: cost, type: "Monte" };

             const initResponse = await fetch(`${BANK_API_URL}/init_monte_game`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cost: cost }), });
             if (!initResponse.ok) { let errorJson; try { errorJson = await initResponse.json(); } catch(e){} throw new Error(errorJson?.error || `HTTP error ${initResponse.status}`); }
             const gameData = await initResponse.json();
             const gameId = gameData.gameId;
             // numCards is now determined by backend based on cost, use gameData.numCards
             const actualNumCards = gameData.numCards;

             activeGame.id = gameId; // Update with real game ID

             const memo = `Monte ${gameId.slice(-6)}`;
             const paymentSuccess = await deductKale(cost, memo, "monteDialogue"); // Uses Freighter
             if (paymentSuccess) {
                 // Message updated in deductKale
                 renderMonte(gameId, cost, actualNumCards); // Use actualNumCards from backend
             } else {
                 activeGame = { id: null, cost: 0, type: null }; // Reset if payment failed
             }
        } catch (error) {
            console.error("Error buying Monte game:", error);
            updateDialogue(`✗ Error starting Monte game: ${error.message}`, "monteDialogue");
            fetchBalance();
            activeGame = { id: null, cost: 0, type: null }; // Reset on error
        } finally { hideLoading(); }
    }

     function renderMonte(gameId, cost, numCards) {
         // --- This function remains mostly the same internally ---
         // It calls fetchSignature and requestPayout which are already modified
         const monteGame = document.getElementById("monteGame");
         const dialogueId = "monteDialogue";
         monteGame.innerHTML = ""; monteGame.classList.remove("hidden");
         monteGame.className = `game grid-${numCards === 5 ? 5 : numCards === 4 ? 4 : 3}`;
         monteGame.classList.remove('revealed');
         monteGame.style.pointerEvents = 'auto';

         updateDialogue(`Find the Kale 🥬! Click a card to make your choice.`, dialogueId);

         for (let i = 0; i < numCards; i++) {
             const card = document.createElement("div");
             card.classList.add("monte-card");
             card.textContent = "❓";
             card.dataset.index = i;
             card.style.pointerEvents = 'auto';

             card.onclick = async () => {
                 if (!activeGame.id || activeGame.id !== gameId || monteGame.classList.contains('revealed')) { return; } // Check gameId match
                 const chosenIndex = i + 1;
                 const chosenCardElement = card;

                 updateDialogue(`You chose card ${chosenIndex}. Checking result...`, dialogueId);
                 monteGame.classList.add('revealed');
                 monteGame.querySelectorAll('.monte-card').forEach(c => c.style.pointerEvents = 'none');

                 const signature = await fetchSignature(gameId, cost);

                 let payoutData = null;
                 if (signature && activeGame.id === gameId) { // Check active game again
                     payoutData = await requestPayout(gameId, cost, signature, "Monte", [chosenIndex]);
                 } else if (!signature) {
                     updateDialogue("✗ Failed to secure game for payout.", dialogueId);
                     activeGame = { id: null, cost: 0, type: null }; // Reset if signature fails
                 }

                 // Reveal cards AFTER payout attempt
                 setTimeout(() => {
                    const allCardElements = monteGame.querySelectorAll('.monte-card');
                    if (payoutData && payoutData.status === 'success' && payoutData.finalLayout) {
                         const finalLayout = payoutData.finalLayout;
                         allCardElements.forEach((c, index) => {
                             c.textContent = finalLayout[index] || '!';
                             c.classList.add('revealed');
                             if (finalLayout[index] === '🥬') { c.classList.add('kale-card'); }
                         });
                     } else { // Fallback if layout missing
                         allCardElements.forEach(c => { c.textContent = "!"; c.classList.add('revealed'); });
                         if (!payoutData || payoutData.status !== 'success') {
                            // Dialogue already shows payout error, maybe add layout specific message?
                            // updateDialogue("Could not retrieve final card layout. Result already determined.", dialogueId);
                         }
                     }
                     if (chosenCardElement) { chosenCardElement.style.border = '3px solid blue'; }
                     setTimeout(() => { monteGame.classList.add("hidden"); }, 5000);
                 }, 500);
             };
             monteGame.appendChild(card);
         }
     }


    // --- Utility & Navigation (Modified for Freighter) ---

    // *** login() is now connectFreighter() triggered by button ***

    // *** logout() clears Freighter state ***
    function logout() {
        playerPublicKey = null;
        playerBalance = 0;
        updateBalanceDisplay();
        try { localStorage.removeItem(LOCALSTORAGE_KEY); } catch(e) { console.warn("LocalStorage not available", e); }
        updateDialogue(`✓ Disconnected. Thanks for playing!`, "loginDialogue"); // Show message on login screen
        showScreen("splash"); setTimeout(() => showScreen("login"), 1500);
    }

    function backToMenu() { showScreen("menu"); }
    function showScratchOffs() { showScreen("scratch"); }
    function showSlots() { showScreen("slots"); }
    function showMonte() { showScreen("monte"); }
    function showDonation() { showScreen("donation"); }

    // --- Initialization ---

    // Add event listener for the connect button
    const connectBtn = document.getElementById('connectFreighterBtn');
    if (connectBtn) {
        connectBtn.onclick = connectFreighter; // Assign function directly
    } else {
        console.error("Connect Freighter button not found!");
    }

    // Try to resume session on load
    checkFreighterConnection(); // This will show login or menu screen

    // Expose functions needed by HTML onclick attributes
    window.logout = logout; window.backToMenu = backToMenu;
    window.buyScratchCard = buyScratchCard; window.buySlots = buySlots; window.buyMonte = buyMonte;
    window.showScratchOffs = showScratchOffs; window.showSlots = showSlots; window.showMonte = showMonte;
    window.showDonation = showDonation;
}

// Ensure the script runs after the DOM is loaded
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initApp); } else { initApp(); }

// Make sure freighterApi functions are accessible (might need adjustment based on how you include the library)
const freighterApi = window.freighterApi;
