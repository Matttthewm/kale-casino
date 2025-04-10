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

    updateDialogue(dialogueId, message);
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
    showScreen('splash');

    const connectFreighterBtn = document.getElementById('connectFreighterBtn');
    if (connectFreighterBtn) {
        connectFreighterBtn.addEventListener('click', connectFreighter);
    } else {
        console.error("Connect Freighter button not found.");
    }

    // Example of showing the login screen after a delay (you can adjust or remove this)
    setTimeout(() => {
        showScreen('login');
    }, 1500);
});

async function connectFreighter() {
    console.log("Connect Freighter button clicked! Attempting to run function...");
    showLoading("Connecting to Freighter...");

    if (!window.freighterApi || !window.freighterApi.isConnected) {
        console.log("Freighter not installed check.");
        updateDialogue('loginDialogue', "Freighter extension not found. Please install and enable it.");
        hideLoading();
        return;
    }

    console.log("Freighter detected. Updating UI...");
    updateDialogue('loginDialogue', "Freighter detected. Requesting connection...");

    console.log("Attempting to call window.freighterApi.getPublicKey()...");
    try {
        window.freighterApi.getPublicKey()
            .then(publicKey => {
                console.log('Public Key:', publicKey);
                localStorage.setItem('publicKey', publicKey);
                updateDialogue('loginDialogue', `Connected with public key: ${publicKey.substring(0, 8)}...`);
                fetchBalance(publicKey); // Assuming this function exists
                showScreen('menu');
                hideLoading();
            })
            .catch(error => {
                console.error('Freighter connection error occurred:', error);
                updateDialogue('loginDialogue', `Error connecting to Freighter: ${error.message}`);
                hideLoading();
            });
    } catch (error) {
        console.error('Freighter connection error occurred in try block:', error);
        updateDialogue('loginDialogue', `Error during connection attempt: ${error.message}`);
        hideLoading();
    } finally {
        console.log("connectFreighter() finally block reached. Hiding loading.");
        // hideLoading(); // Already called in then and catch
    }
}

// Dummy fetchBalance function (replace with your actual implementation)
async function fetchBalance(publicKey) {
    console.log("Fetching balance for:", publicKey);
    balanceSpan.textContent = "Loading...";
    balanceBar.classList.remove('hidden');
    // In a real application, you would make an API call here
    setTimeout(() => {
        balanceSpan.textContent = Math.floor(Math.random() * 1000); // Simulate balance
    }, 1000);
}

// Game navigation functions
function showScratchOffs() { console.log("Scratch-Offs clicked"); showScreen('scratch'); }
function showSlots() { console.log("Slots clicked"); showScreen('slots'); }
function showMonte() { console.log("Monte clicked"); showScreen('monte'); }
function showDonation() { console.log("Donation clicked"); showScreen('donation'); }
function backToMenu() { console.log("Back to Menu clicked"); showScreen('menu'); }
function logout() { console.log("Logout clicked"); localStorage.removeItem('publicKey'); balanceBar.classList.add('hidden'); showScreen('login', 'Disconnected from Freighter.'); }

// Game buy functions
function buyScratchCard(price) { console.log(`Buy Scratch Card for ${price} KALE`); updateDialogue('scratchDialogue', `Attempting to buy scratch card for ${price} KALE...`); }
function buySlots(price, reels) { console.log(`Buy Slots for ${price} KALE with ${reels} reels`); updateDialogue('slotsDialogue', `Attempting to play slots for ${price} KALE with ${reels} reels...`); }
function buyMonte(price, cards) { console.log(`Buy Monte for ${price} KALE with ${cards} cards`); updateDialogue('monteDialogue', `Attempting to play Monte for ${price} KALE with ${cards} cards...`); }
