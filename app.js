// app.js (Updated: Improved error handling in requestPayout)

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
        // Don't show loading for quick balance updates unless necessary
        // showLoading("Fetching Balance...");
        try {
            const account = await server.loadAccount(playerKeypair.publicKey());
            const kaleBalance = account.balances.find(b => b.asset_code === KALE_ASSET_CODE && b.asset_issuer === KALE_ISSUER);
            playerBalance = kaleBalance ? parseFloat(kaleBalance.balance) : 0;
            updateBalanceDisplay();
        } catch (e) {
             if (e.response && e.response.status === 404) {
                playerBalance = 0; // Account exists but no KALE balance / trustline yet
                updateBalanceDisplay();
            } else {
                 console.error("Error fetching balance:", e);
                 updateDialogue(`✗ Error fetching balance. Please ensure account exists and check console.`);
            }
        } finally {
            // hideLoading();
        }
    }

     async function ensureTrustline() {
        if (!playerKeypair) return false;
        showLoading("Checking KALE Trustline...");
        try {
            const account = await server.loadAccount(playerKeypair.publicKey());
            // Check if trustline exists OR if it's the native asset (XLM) which doesn't need one
            const hasTrustline = account.balances.some(
                (b) => b.asset_type === 'native' || (b.asset_code === KALE_ASSET_CODE && b.asset_issuer === KALE_ISSUER)
            );

            if (!hasTrustline) {
                 updateDialogue("Establishing KALE Trustline...");
                 // Check if account has enough XLM for the transaction fee + reserve
                 const baseFee = await server.fetchBaseFee(); // Fee in stroops
                 const baseReserve = 0.5; // Base reserve in XLM
                 const entryReserve = 0.5; // Reserve per entry (trustline)
                 const minBalance = (2 * baseReserve) + entryReserve; // Need 2 base reserves + 1 for trustline

                 const xlmBalance = account.balances.find(b => b.asset_type === 'native');
                 if (!xlmBalance || parseFloat(xlmBalance.balance) < minBalance + (parseInt(baseFee, 10) / 10000000)) {
                     updateDialogue(`✗ Insufficient XLM balance. Need ~${minBalance + 0.01} XLM for trustline.`);
                     hideLoading();
                     return false;
                 }

                 const transaction = new StellarSdk.TransactionBuilder(account, {
                        fee: baseFee,
                        networkPassphrase: NETWORK_PASSPHRASE,
                    })
                    .addOperation(StellarSdk.Operation.changeTrust({ asset: kale_asset, limit: '900000000' })) // Set a high limit
                    .setTimeout(30)
                    .build();
                transaction.sign(playerKeypair);

                await server.submitTransaction(transaction);
                updateDialogue("✓ KALE Trustline established!");
            } else {
                 updateDialogue("✓ KALE Trustline exists.");
            }
            return true; // Trustline exists or was created
        } catch (e) {
             console.error("Trustline Error:", e.response ? e.response.data : e);
             if (e.response && e.response.status === 404) {
                 updateDialogue(`✗ Account not found on network. Please fund ${playerKeypair.publicKey()} with XLM.`);
             } else {
                 updateDialogue(`✗ Error checking/establishing trustline: ${e.message || 'Unknown error'}`);
             }
             return false;
         } finally {
            hideLoading();
        }
    }

    async function deductKale(amount, memo, dialogueId) {
        if (!playerKeypair) return false;
        showLoading("Processing Payment...");
        updateDialogue("Sending payment to casino bank...", dialogueId);
        try {
            const account = await server.loadAccount(playerKeypair.publicKey());
            const baseFee = await server.fetchBaseFee();
            const transaction = new StellarSdk.TransactionBuilder(account, {
                    fee: baseFee,
                    networkPassphrase: NETWORK_PASSPHRASE,
                })
                .addOperation(StellarSdk.Operation.payment({
                    destination: BANK_PUBLIC_KEY,
                    asset: kale_asset,
                    amount: amount.toString(),
                }))
                .addMemo(StellarSdk.Memo.text(memo.slice(0, 28))) // Max 28 chars for memo
                .setTimeout(60) // Increased timeout
                .build();

            transaction.sign(playerKeypair);
            const result = await server.submitTransaction(transaction);
            // Log result for debugging, but don't rely solely on console logs for feedback
            console.log("Payment Tx Result:", result);

            playerBalance -= amount; // Optimistically deduct, fetchBalance will correct if needed
            updateBalanceDisplay();
            updateDialogue(`✓ ${amount} KALE payment sent.`, dialogueId);
            hideLoading();
            return true;

        } catch (error) {
            console.error("Payment Error:", error.response ? error.response.data : error);
             let errorMsg = "✗ Payment failed.";
             if (error.response && error.response.data && error.response.data.extras && error.response.data.extras.result_codes) {
                 const codes = error.response.data.extras.result_codes;
                 if (codes.transaction === 'tx_failed' && codes.operations && codes.operations[0] === 'op_underfunded') {
                     errorMsg = "✗ Payment failed: Insufficient KALE balance.";
                 } else if (codes.transaction === 'tx_failed' && codes.operations && codes.operations[0] === 'op_no_destination') {
                     errorMsg = "✗ Payment failed: Casino bank account may not exist.";
                 } else {
                    errorMsg = `✗ Payment failed: ${codes.transaction || 'Unknown reason'}`;
                 }
             } else if (error.message) {
                 errorMsg += ` ${error.message}`;
             }
            updateDialogue(errorMsg, dialogueId);
            fetchBalance(); // Refresh balance after failed payment
            hideLoading();
            return false;
        }
    }

    // --- Backend Interaction ---

    async function fetchSignature(gameId, cost) {
        if (!gameId || !cost) return null;
        showLoading("Securing game...");
        try {
             const response = await fetch(`${BANK_API_URL}/sign_game`, {
                 method: "POST",
                 headers: { "Content-Type": "application/json" },
                 body: JSON.stringify({ game_id: gameId, cost: cost })
             });
             if (!response.ok) {
                 // Try to parse error response from backend
                 let errorJson;
                 try { errorJson = await response.json(); } catch (e) { /* ignore parsing error */ }
                 throw new Error(errorJson?.error || `HTTP error ${response.status}`);
             }
             const data = await response.json();
             hideLoading();
             return data.signature;
         } catch (error) {
             console.error("Error fetching signature:", error);
             updateDialogue(`✗ Error securing game: ${error.message}`, activeGame.type ? `${activeGame.type}Dialogue` : 'dialogue');
             hideLoading();
             return null;
         }
    }

    // *** MODIFIED requestPayout function ***
    async function requestPayout(gameId, cost, signature, gameType, choices) {
        if (!gameId || !cost || !signature || !playerKeypair) return; // choices can be null/empty for scratch/slots
        showLoading("Requesting Payout...");
        // Update dialogue immediately before the async call
        updateDialogue("Checking results with the bank...", `${gameType}Dialogue`);

        try {
            const response = await fetch(`${BANK_API_URL}/payout`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    game_id: gameId,
                    cost: cost,
                    signature: signature,
                    destination: playerKeypair.publicKey(), // Send player's public key
                    game_type: gameType,
                    choices: choices // Only relevant for Monte (player's guess)
                })
            });

            if (!response.ok) {
                let errorJson;
                try { errorJson = await response.json(); } catch (e) { /* ignore parsing error */ }
                // Throw an error with the message from the backend JSON or status code
                throw new Error(errorJson?.error || `Payout request failed: ${response.status}`);
            }

            const data = await response.json();
            console.log("Payout response:", data);

            if (data.status === "success") {
                if (data.amount > 0) {
                    updateDialogue(`🏆 You Won ${data.amount.toFixed(2)} KALE! Processing...`, `${gameType}Dialogue`);
                    setTimeout(fetchBalance, 4000); // Wait longer for tx to likely settle
                } else {
                    updateDialogue("✗ You Lost! Better luck next time!", `${gameType}Dialogue`);
                }
            } else {
                // Should ideally not happen if status !success throws error above, but handle defensively
                updateDialogue(`✗ Payout check failed: ${data.message || 'Bank error.'}`, `${gameType}Dialogue`);
            }
        } catch (error) {
            // Catch errors thrown from fetch (network error) or the !response.ok block
            console.error("Error processing winnings:", error);
            // *** THIS IS THE KEY CHANGE ***
            // Update the dialogue with the specific error message caught
            const errorMessage = error.message || "An unknown error occurred.";
            updateDialogue(`✗ Error: ${errorMessage}`, `${gameType}Dialogue`);
            // *** END OF KEY CHANGE ***
        } finally {
            hideLoading();
            // Reset active game only after payout attempt is fully complete (success or fail)
            // Ensure this doesn't clear state needed for error display if needed, but seems okay here.
            activeGame = { id: null, cost: 0, type: null };
        }
    }


    // --- Game Logic ---

    // SCRATCH-OFF
    async function buyScratchCard(cost) {
         if (activeGame.id) {
            updateDialogue("Finish the current game first!", "scratchDialogue");
            return;
        }
        if (playerBalance < cost) {
            updateDialogue(`✗ Need ${cost} KALE, you have ${playerBalance.toFixed(2)}!`, "scratchDialogue");
            return;
        }

        showLoading("Initializing Scratch Card...");
        updateDialogue("Getting your scratch card ready...", "scratchDialogue");

        try {
            // 1. Initialize game with backend
            const initResponse = await fetch(`${BANK_API_URL}/init_scratch_game`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cost: cost }),
            });

            if (!initResponse.ok) {
                 let errorJson; try { errorJson = await initResponse.json(); } catch(e){}
                 throw new Error(errorJson?.error || `HTTP error ${initResponse.status}`);
            }
            const gameData = await initResponse.json();
            const gameId = gameData.gameId;
            const seedlings = gameData.seedlings;

             // 2. Deduct cost
             const memo = `Scratch ${gameId.slice(-6)}`; // Short memo
             const paymentSuccess = await deductKale(cost, memo, "scratchDialogue");

             if (paymentSuccess) {
                 activeGame = { id: gameId, cost: cost, type: "Scratch" };
                 updateDialogue("✓ Paid! Scratch away!", "scratchDialogue");
                 startScratchGame(gameId, cost, seedlings); // Pass details to start game function
             } else {
                  updateDialogue("✗ Payment failed. Card cancelled.", "scratchDialogue");
                 // No need to revert init on backend unless necessary
             }

         } catch (error) {
             console.error("Error buying scratch card:", error);
             updateDialogue(`✗ Error starting scratch game: ${error.message}`, "scratchDialogue");
             fetchBalance(); // Refresh balance on error
         } finally {
            hideLoading();
        }
    }

     function startScratchGame(gameId, cost, seedlings) {
         const scratchCard = document.getElementById("scratchCard");
         const dialogueId = "scratchDialogue";
         scratchCard.innerHTML = "";
         scratchCard.classList.remove("hidden");
         scratchCard.className = `game grid-${seedlings === 9 ? 9 : seedlings === 3 ? 3 : 12}`; // Reset classes and apply grid
         scratchCard.style.pointerEvents = 'auto'; // Ensure card is clickable initially

         let revealedCount = 0;
         let revealedSymbols = Array(seedlings).fill(null); // Store revealed symbols locally
         let isGameConcluding = false; // <<< --- Add this flag to prevent multiple payouts

         for (let i = 0; i < seedlings; i++) {
             const spot = document.createElement("div");
             spot.classList.add("scratch-spot");
             spot.textContent = "🌱"; // Start with seedling emoji
             spot.dataset.index = i; // Store index

             spot.onclick = async () => {
                 // Ignore clicks if game inactive, already revealed, revealing, OR if payout already triggered
                 if (!activeGame.id || spot.classList.contains("revealed") || spot.classList.contains("revealing") || isGameConcluding) { // <<< --- Check flag here
                     return;
                 }

                 spot.classList.add("revealing");
                 spot.textContent = "🤔"; // Indicate loading/revealing
                 // Only update dialogue if not concluding game already
                 if (!isGameConcluding) updateDialogue("Revealing spot...", dialogueId);

                 try {
                     const response = await fetch(`${BANK_API_URL}/reveal_spot`, {
                         method: 'POST',
                         headers: { 'Content-Type': 'application/json' },
                         body: JSON.stringify({ gameId: gameId, index: i }),
                     });

                     if (response.ok) {
                         const data = await response.json();
                         const symbol = data.symbol;
                         spot.textContent = symbol;
                         spot.classList.remove("revealing");
                         spot.classList.add("revealed");
                         revealedCount++;
                         revealedSymbols[i] = symbol; // Store revealed symbol

                         // Check if all spots revealed AND payout hasn't started
                         if (revealedCount === seedlings && !isGameConcluding) { // <<< --- Check flag again for safety
                             isGameConcluding = true; // <<< --- Set flag IMMEDIATELY
                             updateDialogue("All spots revealed! Checking results...", dialogueId);
                             scratchCard.style.pointerEvents = 'none'; // Disable further clicks on the grid

                             // Get signature and request payout (only runs once now)
                             const signature = await fetchSignature(gameId, cost);
                             if (signature) {
                                 // Pass actual game details from activeGame object
                                 await requestPayout(activeGame.id, activeGame.cost, signature, activeGame.type, null);
                             } else {
                                 updateDialogue("✗ Failed to secure game for payout.", dialogueId);
                                 activeGame = { id: null, cost: 0, type: null }; // Reset game if signature fails
                             }

                             // Timeout to hide card
                             setTimeout(() => {
                                 scratchCard.classList.add("hidden");
                                 // Avoid overwriting payout message immediately
                                 // updateDialogue("Game finished. Buy another?", dialogueId);
                             }, 5000); // Increased to 5 seconds

                         } else if (!isGameConcluding) { // Only update if not concluding
                            updateDialogue(`Spot revealed! ${seedlings - revealedCount} remaining.`, dialogueId);
                         }
                     } else {
                         let errorJson; try { errorJson = await response.json(); } catch(e){}
                         console.error("Error revealing spot:", errorJson || response.status);
                         spot.textContent = "Error";
                         spot.classList.remove("revealing");
                         updateDialogue(`✗ Error revealing spot: ${errorJson?.error || 'Unknown error'}`, dialogueId);
                     }
                 } catch (error) {
                     console.error("Error revealing spot:", error);
                     spot.textContent = "Error";
                     spot.classList.remove("revealing");
                     updateDialogue(`✗ Network error revealing spot.`, dialogueId);
                 }
             };
             scratchCard.appendChild(spot);
         }
         updateDialogue("Card ready! Click the 🌱 to reveal.", dialogueId);
     }


    // SLOTS
     async function buySlots(cost, reels) {
        if (activeGame.id) {
            updateDialogue("Finish the current game first!", "slotsDialogue");
            return;
        }
        if (playerBalance < cost) {
            updateDialogue(`✗ Need ${cost} KALE, you have ${playerBalance.toFixed(2)}!`, "slotsDialogue");
            return;
        }

        showLoading("Preparing Slots...");
        updateDialogue("Placing your bet...", "slotsDialogue");

         // 1. Deduct cost first for slots
         const gameStartTime = Date.now(); // Use timestamp for a simple memo part
         const memo = `Slots ${cost}-${gameStartTime.toString().slice(-6)}`;
         const paymentSuccess = await deductKale(cost, memo, "slotsDialogue");

        if (!paymentSuccess) {
            updateDialogue("✗ Payment failed. Cannot play slots.", "slotsDialogue");
            hideLoading();
            return;
        }

        updateDialogue("✓ Paid! Spinning reels...", "slotsDialogue");

        try {
            // 2. Call backend to get the final result and gameId
            const response = await fetch(`${BANK_API_URL}/play_slots`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cost: cost, num_reels: reels }),
            });

            if (!response.ok) {
                 let errorJson; try { errorJson = await response.json(); } catch(e){}
                 throw new Error(errorJson?.error || `HTTP error ${response.status}`);
            }
            const data = await response.json();
            const gameId = data.gameId;
            const finalReels = data.result;

            activeGame = { id: gameId, cost: cost, type: "Slots" };

            // 3. Animate and show result
            await animateSlots(reels, finalReels);
            updateDialogue("Spin finished! Checking results...", "slotsDialogue");

            // 4. Get signature and request payout
            const signature = await fetchSignature(gameId, cost);
            if (signature) {
                 // Pass actual game details from activeGame object
                 await requestPayout(activeGame.id, activeGame.cost, signature, activeGame.type, null);
            } else {
                 updateDialogue("✗ Failed to secure game for payout.", "slotsDialogue");
                 fetchBalance(); // Try to fetch balance if payout failed early
                 activeGame = { id: null, cost: 0, type: null }; // Reset game
            }
            // Hide game after timeout
            setTimeout(() => {
                const slotsGame = document.getElementById("slotsGame");
                if(slotsGame) slotsGame.classList.add("hidden");
                // updateDialogue("Game finished. Spin again?", "slotsDialogue");
            }, 5000);

        } catch (error) {
            console.error("Error playing slots:", error);
            updateDialogue(`✗ Error playing slots: ${error.message}`, "slotsDialogue");
            fetchBalance(); // Refresh balance on error
            activeGame = { id: null, cost: 0, type: null }; // Reset game state
        } finally {
            hideLoading();
        }
    }

     async function animateSlots(reels, finalResult) {
         const slotsGame = document.getElementById("slotsGame");
         slotsGame.innerHTML = ""; // Clear previous result
         slotsGame.classList.remove("hidden");
         slotsGame.className = `game grid-${reels === 9 ? 9 : reels === 6 ? 6 : 3}`; // Reset classes and apply grid

         // Create reel elements
         const reelElements = [];
         for (let i = 0; i < reels; i++) {
             const reelSpan = document.createElement("span");
             reelSpan.textContent = symbols[Math.floor(Math.random() * symbols.length)]; // Start random
             slotsGame.appendChild(reelSpan);
             reelElements.push(reelSpan);
         }

         // Animation loop
         const spinDuration = 1500; // Total spin time in ms
         const intervalTime = 50; // Update interval in ms
         const startTime = Date.now();

         return new Promise(resolve => {
             const spinInterval = setInterval(() => {
                 const elapsedTime = Date.now() - startTime;
                 let allStopped = true;

                 for (let i = 0; i < reels; i++) {
                      // Stagger stop time based on reel index
                     const stopTime = (spinDuration * 0.5) + (i * spinDuration * 0.5 / reels);
                     if (elapsedTime < stopTime) {
                         reelElements[i].textContent = symbols[Math.floor(Math.random() * symbols.length)];
                         allStopped = false;
                     } else {
                         reelElements[i].textContent = finalResult[i]; // Set final symbol
                     }
                 }

                 if (allStopped || elapsedTime >= spinDuration) {
                     clearInterval(spinInterval);
                     // Ensure final result is displayed
                     for (let i = 0; i < reels; i++) {
                         reelElements[i].textContent = finalResult[i];
                     }
                     resolve(); // Animation complete
                 }
             }, intervalTime);
         });
     }


    // MONTE
     async function buyMonte(cost, numCards) { // Removed multiplier
         if (activeGame.id) {
            updateDialogue("Finish the current game first!", "monteDialogue");
            return;
        }
         if (playerBalance < cost) {
            updateDialogue(`✗ Need ${cost} KALE, you have ${playerBalance.toFixed(2)}!`, "monteDialogue");
            return;
        }

        showLoading("Initializing Monte Game...");
        updateDialogue("Setting up the cards...", "monteDialogue");

        try {
            // 1. Initialize game with backend
            const initResponse = await fetch(`${BANK_API_URL}/init_monte_game`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cost: cost }),
            });

            if (!initResponse.ok) {
                let errorJson; try { errorJson = await initResponse.json(); } catch(e){}
                throw new Error(errorJson?.error || `HTTP error ${initResponse.status}`);
            }
            const gameData = await initResponse.json();
            const gameId = gameData.gameId;
            // const serverNumCards = gameData.numCards; // Use this if needed

            // 2. Deduct cost
            const memo = `Monte ${gameId.slice(-6)}`; // Short memo
            const paymentSuccess = await deductKale(cost, memo, "monteDialogue");

            if (paymentSuccess) {
                 activeGame = { id: gameId, cost: cost, type: "Monte" };
                 updateDialogue("✓ Paid! Find the Kale 🥬!", "monteDialogue");
                 renderMonte(gameId, cost, numCards); // Pass details to render
            } else {
                 updateDialogue("✗ Payment failed. Game cancelled.", "monteDialogue");
            }

        } catch (error) {
            console.error("Error buying Monte game:", error);
            updateDialogue(`✗ Error starting Monte game: ${error.message}`, "monteDialogue");
            fetchBalance(); // Refresh balance on error
        } finally {
            hideLoading();
        }
    }

     function renderMonte(gameId, cost, numCards) {
         const monteGame = document.getElementById("monteGame");
         const dialogueId = "monteDialogue";
         monteGame.innerHTML = "";
         monteGame.classList.remove("hidden");
         monteGame.className = `game grid-${numCards === 5 ? 5 : numCards === 4 ? 4 : 3}`; // Reset classes and apply grid
         monteGame.classList.remove('revealed'); // Ensure revealed class is removed initially
         monteGame.style.pointerEvents = 'auto'; // Ensure clickable

         for (let i = 0; i < numCards; i++) {
             const card = document.createElement("div");
             card.classList.add("monte-card");
             card.textContent = "🌱"; // Show back of card (seedling)
             card.dataset.index = i; // Store 0-based index
             card.style.pointerEvents = 'auto'; // Ensure individual cards clickable

             card.onclick = async () => {
                 // Check activeGame using the object, not just gameId
                 if (!activeGame.id || activeGame.type !== "Monte" || monteGame.classList.contains('revealed')) {
                     console.log("Monte click ignored:", activeGame, monteGame.classList.contains('revealed'));
                     return; // Ignore clicks if game inactive or already revealed
                 }

                 const chosenIndex = i + 1; // Player's guess (1-based)
                 updateDialogue(`You chose card ${chosenIndex}. Checking result...`, dialogueId);
                 monteGame.classList.add('revealed'); // Prevent further clicks on the grid overall

                 // Disable all cards immediately
                 monteGame.querySelectorAll('.monte-card').forEach(c => c.style.pointerEvents = 'none');

                 // Get signature and request payout, sending the choice
                 const signature = await fetchSignature(gameId, cost);
                 if (signature) {
                     // Pass actual game details from activeGame object
                     await requestPayout(activeGame.id, activeGame.cost, signature, activeGame.type, [chosenIndex]);
                 } else {
                      updateDialogue("✗ Failed to secure game for payout.", dialogueId);
                      activeGame = { id: null, cost: 0, type: null }; // Reset game
                 }

                 // Visually reveal cards AFTER payout attempt
                 setTimeout(async () => {
                    monteGame.querySelectorAll('.monte-card').forEach(c => {
                        c.textContent = "?"; // Show placeholder as we don't know layout
                        c.classList.add('revealed');
                    });
                    // Highlight the chosen card
                    const chosenCardElement = monteGame.querySelector(`[data-index="${i}"]`);
                    if (chosenCardElement) {
                        chosenCardElement.style.border = '2px solid blue';
                    }

                     setTimeout(() => {
                        monteGame.classList.add("hidden");
                        // updateDialogue("Game finished. Play again?", dialogueId);
                    }, 5000); // Hide after 5 secs
                 }, 1000); // Delay reveal slightly
             };
             monteGame.appendChild(card);
         }
          updateDialogue(`Find the Kale 🥬! Click a card to make your choice.`, dialogueId);
     }

    // --- Utility & Navigation ---
    function shuffle(array) { // Fisher-Yates Shuffle
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    function login() {
        const secret = document.getElementById("secretKey").value;
        if (!secret || !secret.startsWith("S") || secret.length !== 56) {
             updateDialogue("✗ Invalid Secret Key format!", "dialogue"); // Use main dialogue for login
             return;
        }
        try {
            playerKeypair = StellarSdk.Keypair.fromSecret(secret);

            updateDialogue(`Logging in as ${playerKeypair.publicKey().substring(0, 8)}...`, "dialogue");

            // Check trustline first, then fetch balance
            ensureTrustline().then(trustlineOk => {
                if (trustlineOk) {
                    fetchBalance().then(() => {
                        showScreen("menu");
                         updateDialogue(`✓ Logged in! Welcome!`, "dialogue");
                    });
                } else {
                    // ensureTrustline updates dialogue with specific error
                    hideLoading(); // Ensure loading is hidden if trustline fails early
                }
            });
        } catch (e) {
            console.error("Login error:", e);
            updateDialogue("✗ Invalid Secret Key!", "dialogue");
        }
    }

    function logout() {
        playerKeypair = null;
        playerBalance = 0;
        updateBalanceDisplay(); // Clear balance display
        document.getElementById("secretKey").value = ""; // Clear input field
        updateDialogue(`✓ Logged out. Thanks for playing!`, "dialogue"); // Use main dialogue
        showScreen("splash");
        // Transition back to login after a delay
        setTimeout(() => showScreen("login"), 2000);
    }

    function backToMenu() {
        showScreen("menu");
    }

    function showScratchOffs() { showScreen("scratch"); }
    function showSlots() { showScreen("slots"); }
    function showMonte() { showScreen("monte"); }
    function showDonation() { showScreen("donation"); }

    // --- Initialization ---
    // Show splash, then login screen
    updateBackground("splash"); // Set initial background
    setTimeout(() => showScreen("login"), 1500); // Faster transition

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
    window.showDonation = showDonation;
}

// Run the app initialization function once the DOM is ready
if (document.readyState === 'loading') { // Loading hasn't finished yet
  document.addEventListener('DOMContentLoaded', initApp);
} else { // `DOMContentLoaded` has already fired
  initApp();
}
