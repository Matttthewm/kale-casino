const appDiv = document.getElementById('app');
const balanceBar = document.getElementById('balanceBar');
const balanceSpan = document.getElementById('balance');
const loadingDiv = document.getElementById('loading');
const loadingText = document.getElementById('loadingText');

function showScreen(screenId, message = '', dialogueId = screenId === 'menu' ? 'dialogue' : screenId === 'login' ? 'loginDialogue' : `${screenId}Dialogue`) {
    const screens = document.querySelectorAll('.screen');
    screens.forEach(screen => screen.classList.add('hidden'));

    const screenToShow = document.getElementById(screenId);
    if (screenToShow) {
        screenToShow.classList.remove('hidden');
    }

    // Only update dialogue if message is provided and dialogueId exists
    if (message && document.getElementById(dialogueId)) {
        updateDialogue(dialogueId, message);
    }
}

function updateDialogue(dialogueId, message) {
    const dialogueElement = document.getElementById(dialogueId);
    if (dialogueElement) {
        dialogueElement.textContent = message;
    } else {
        console.warn(`Dialogue element not found: ${dialogueId}`);
    }
}

function showLoading(message) {
    loadingText.textContent = message;
    loadingDiv.classList.remove('hidden');
}

function hideLoading() {
    loadingDiv.classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
    showScreen('splash'); // No message, so no dialogue update attempted

    const connectFreighterBtn = document.getElementById('connectFreighterBtn');
    if (connectFreighterBtn) {
        connectFreighterBtn.addEventListener('click', connectFreighter);
    } else {
        console.error("Connect Freighter button not found.");
    }

    setTimeout(() => {
        showScreen('login');
    }, 1500);
});

async function connectFreighter() {
    console.log("Connect Freighter button clicked! Attempting to run function...");
    showLoading("Connecting to Freighter...");

    // Debug: Inspect window.freighterApi
    console.log("window.freighterApi:", window.freighterApi);
    console.log("window.freighterApi type:", typeof window.freighterApi);
    console.log("window.freighterApi methods:", Object.keys(window.freighterApi || {}));

    if (!window.freighterApi) {
        console.log("Freighter API not available.");
        updateDialogue('loginDialogue', "Freighter extension not detected. Please install it.");
        hideLoading();
        return;
    }

    const freighterApi = window.freighterApi;

    // Check if the API has the expected methods
    const availableMethods = Object.keys(freighterApi);
    console.log("Available Freighter API methods:", availableMethods);

    // Verify isConnected (This check is okay as is)
    if (typeof freighterApi.isConnected !== 'function') {
        console.error("isConnected is not a function on window.freighterApi.");
        updateDialogue('loginDialogue', "Freighter API issue: isConnected not found.");
        hideLoading();
        return;
    }

    try {
        const connected = await freighterApi.isConnected();
        if (!connected) {
            console.log("Freighter not connected.");
            updateDialogue('loginDialogue', "Freighter extension not connected. Please enable it and try again.");
            hideLoading();
            return;
        }

        console.log("Freighter Detected! Requesting public key...");
        updateDialogue('loginDialogue', "Freighter detected. Requesting public key...");

        // --- FIX START: Handle getAddress returning an object ---
        // Verify getAddress exists (based on previous debugging, it should)
        if (typeof freighterApi.getAddress !== 'function') {
            console.error("getAddress is not a function on window.freighterApi.");
             updateDialogue('loginDialogue', "Freighter API issue: getAddress not found. Please ensure Freighter is properly installed and enabled.");
            hideLoading();
            return;
        }

        // Call getAddress which returns an object containing the public key string
        const publicKeyObject = await freighterApi.getAddress();

        // Extract the public key string from the returned object
        // Based on standard Freighter API, it's likely under the 'publicKey' property
        if (!publicKeyObject || typeof publicKeyObject.publicKey !== 'string') {
             console.error("getAddress returned an unexpected format:", publicKeyObject);
             updateDialogue('loginDialogue', "Freighter API issue: Failed to retrieve public key string.");
             hideLoading();
             return;
        }
        const publicKey = publicKeyObject.publicKey; // This is the public key string!
        // --- FIX END ---


        console.log('Public Key:', publicKey); // This should now log 'Public Key: G...'

        localStorage.setItem('publicKey', publicKey);
        updateDialogue('loginDialogue', `Connected with public key: ${publicKey.substring(0, 8)}...`); // This should now work
        fetchBalance(publicKey); // Pass the string public key
        showScreen('menu'); // Assuming connection is successful, show the menu
        hideLoading();

    } catch (error) {
        console.error('Freighter connection error:', error);
        // Provide more specific error message if possible
        let userErrorMessage = "Error connecting to Freighter.";
         if (error.message && error.message.includes('User declined')) {
             userErrorMessage = "Connection request declined in Freighter. Please approve.";
         } else if (error.message) {
              userErrorMessage += ` Details: ${error.message}`;
         }
        updateDialogue('loginDialogue', userErrorMessage);
        hideLoading();
    }
}

// Fetch balance (placeholder implementation)
async function fetchBalance(publicKey) {
    console.log("Fetching balance for:", publicKey);
    balanceSpan.textContent = "Loading...";
    balanceBar.classList.remove('hidden');
    // TODO: Replace with actual Stellar SDK logic to fetch KALECHIPS balance
    // Use the publicKey and the KALECHIPS asset details (code and issuer)
    setTimeout(() => {
        balanceSpan.textContent = Math.floor(Math.random() * 1000); // Dummy balance
    }, 1000);
}

// Game navigation functions
function showScratchOffs() {
    console.log("Scratch-Offs clicked");
    showScreen('scratch');
}

function showSlots() {
    console.log("Slots clicked");
    showScreen('slots');
}

function showMonte() {
    console.log("Monte clicked");
    showScreen('monte');
}

function showDonation() {
    console.log("Donation clicked");
    showScreen('donation');
}

function backToMenu() {
    console.log("Back to Menu clicked");
    showScreen('menu');
}

function logout() {
    console.log("Logout clicked");
    localStorage.removeItem('publicKey');
    balanceBar.classList.add('hidden');
    showScreen('login', 'Disconnected from Freighter.');
}

// Game buy functions
function buyScratchCard(price) {
    console.log(`Buy Scratch Card for ${price} KALE`);
    updateDialogue('scratchDialogue', `Attempting to buy scratch card for ${price} KALE...`);
    // TODO: Implement game logic including Freighter transaction signing
}

function buySlots(price, reels) {
    console.log(`Buy Slots for ${price} KALE with ${reels} reels`);
    updateDialogue('slotsDialogue', `Attempting to play slots for ${price} KALE with ${reels} reels...`);
    // TODO: Implement game logic including Freighter transaction signing
}

function buyMonte(price, cards) {
    console.log(`Buy Monte for ${price} KALE with ${cards} cards`);
    updateDialogue('monteDialogue', `Attempting to play Monte for ${price} KALE with ${cards} cards...`);
     // TODO: Implement game logic including Freighter transaction signing
}

// TODO: Add implementation for other game logic functions (revealing scratch spots, playing Monte, handling game results and payout requests)
// TODO: Implement KALECHIPS "Bake" feature (KALE -> KALECHIPS swap)
// TODO: Implement KALECHIPS Tokenomics (Burning, Buyback, Utility)
// TODO: Implement Kale Salad Lottery Game
// TODO: Update UI rendering to use pixel art aesthetic
