// --- UYGULAMA DURUMU (APP STATE) ---
let peer = null;
let roomCode = '';
let isHost = false;
let myPeerId = '';
let myName = localStorage.getItem('quince_name') || 'Oyuncu_' + Math.floor(Math.random()*1000);
document.getElementById('player-name').value = myName;
let connections = []; // Host'un bağlandığı clientlar
let hostConnection = null; // Client'ın hosta bağlantısı
let customCards = []; // Özel Yaratılan Kartlar

// --- OYUN MOTORU DURUMU (HOST AUTHORITATIVE STATE) ---
// Yalnızca Host (Kurucu) bu state'i değiştirir, diğerlerine yayınlar.
let gameState = {
    status: 'waiting', // waiting, playing, finished
    players: [], // { id, name, hand: [], safe: false, isMod: false }
    deck: [],
    discardPile: [],
    currentTurnIndex: 0,
    direction: 1, // 1 (saat yönü), -1 (ters)
    currentColor: '', // Atılan kartın rengi (Wild atılırsa değişir)
    modOnly: false
};

// Arayüz Elemanları
const screens = { lobby: document.getElementById('lobby-screen'), game: document.getElementById('game-screen') };
const statusTxt = document.getElementById('status-text');

// 1. ODA KURMA (HOST)
document.getElementById('host-btn').addEventListener('click', () => {
    myName = document.getElementById('player-name').value;
    localStorage.setItem('quince_name', myName);
    const isModOnly = document.getElementById('mod-only-toggle').checked;
    
    roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    peer = new Peer(`quince-${roomCode}`);
    
    peer.on('open', (id) => {
        isHost = true;
        myPeerId = id;
        gameState.modOnly = isModOnly;
        
        // Host'u oyuncu olarak ekle (moderatör değilse)
        gameState.players.push({
            id: myPeerId, name: myName + " (Kurucu)", hand: [], safe: false, isMod: isModOnly
        });

        if(!isModOnly) document.getElementById('start-game-btn').classList.remove('hidden');
        else document.getElementById('moderator-view').classList.remove('hidden');
        
        showGameScreen();
        updateGameUI(gameState);
    });

    peer.on('connection', (conn) => {
        connections.push(conn);
        conn.on('data', (data) => handleDataFromClient(conn.peer, data));
        conn.on('open', () => {
            // Yeni gelene isim sor
            conn.send({ type: 'REQ_NAME' });
        });
        conn.on('close', () => {
            gameState.players = gameState.players.filter(p => p.id !== conn.peer);
            broadcastState();
        });
    });
});

// 2. ODAYA KATILMA (CLIENT)
document.getElementById('join-btn').addEventListener('click', () => {
    myName = document.getElementById('player-name').value;
    localStorage.setItem('quince_name', myName);
    roomCode = document.getElementById('room-code-input').value.toUpperCase();
    if(roomCode.length !== 5) return alert("Hatalı kod!");

    peer = new Peer();
    peer.on('open', (id) => {
        myPeerId = id;
        hostConnection = peer.connect(`quince-${roomCode}`);
        
        hostConnection.on('open', () => {
            isHost = false;
            showGameScreen();
            hostConnection.send({ type: 'SET_NAME', name: myName });
            
            // Şifresiz Devam Et (Reconnection)
            localStorage.setItem('quince_last_room', roomCode);
            localStorage.setItem('quince_peer_id', myPeerId);
        });

        hostConnection.on('data', handleDataFromHost);
    });
});

// Otomatik Bağlanma (Şifresiz Devam Et)
window.onload = () => {
    const lastRoom = localStorage.getItem('quince_last_room');
    if (lastRoom && confirm("Devam eden bir oyun bulundu. Bağlanılsın mı?")) {
        document.getElementById('room-code-input').value = lastRoom;
        document.getElementById('join-btn').click();
    }
};

// --- İLETİŞİM PROTOKOLLERİ (ANTI-CHEAT MİMARİSİ) ---

// Host, Client'tan gelen İstekleri (Intent) alır, doğrular. (Sunucu Mantığı)
function handleDataFromClient(peerId, data) {
    if (data.type === 'SET_NAME') {
        gameState.players.push({ id: peerId, name: data.name, hand: [], safe: false, isMod: false });
        if(gameState.players.length > 1 && !gameState.modOnly) {
            document.getElementById('start-game-btn').classList.remove('hidden');
        }
        broadcastState();
    }
    else if (data.type === 'INTENT_PLAY') {
        processPlayMove(peerId, data.cardId, data.selectedColor);
    }
    else if (data.type === 'INTENT_DRAW') {
        processDrawMove(peerId);
    }
}

// Client, Host'tan gelen kesinleşmiş tabloyu (State) alır.
function handleDataFromHost(data) {
    if (data.type === 'REQ_NAME') {
        hostConnection.send({ type: 'SET_NAME', name: myName });
    }
    else if (data.type === 'STATE_UPDATE') {
        updateGameUI(data.state);
    }
    else if (data.type === 'GAME_OVER') {
        alert("Oyun Bitti! Kaybeden: " + data.loser);
        localStorage.removeItem('quince_last_room');
        location.reload();
    }
}

function broadcastState() {
    if(!isHost) return;
    updateGameUI(gameState); // Kendi arayüzünü güncelle
    connections.forEach(conn => conn.send({ type: 'STATE_UPDATE', state: gameState }));
}

// --- QUINCE (UNO) OYUN MOTORU KURALLARI ---

// Deste Oluşturma
function generateDeck() {
    const colors = ['red', 'blue', 'green', 'yellow'];
    let deck = [];
    let idCounter = 0;
    
    colors.forEach(color => {
        deck.push({ id: idCounter++, color: color, value: '0', type: 'number' });
        for(let i=1; i<=9; i++) {
            deck.push({ id: idCounter++, color: color, value: i.toString(), type: 'number' });
            deck.push({ id: idCounter++, color: color, value: i.toString(), type: 'number' });
        }
        for(let i=0; i<2; i++) {
            deck.push({ id: idCounter++, color: color, value: 'Skip', type: 'action' });
            deck.push({ id: idCounter++, color: color, value: 'Rev', type: 'action' });
            deck.push({ id: idCounter++, color: color, value: '+2', type: 'action' });
        }
    });
    for(let i=0; i<4; i++) {
        deck.push({ id: idCounter++, color: 'dark', value: 'W', type: 'wild' });
        deck.push({ id: idCounter++, color: 'dark', value: '+4', type: 'wild' });
    }
    // Özel kartları ekle
    customCards.forEach(c => deck.push({ id: idCounter++, color: 'dark', value: c, type: 'custom' }));
    
    return deck.sort(() => Math.random() - 0.5); // Karıştır
}

// Oyunu Başlat
document.getElementById('start-game-btn').addEventListener('click', () => {
    if(!isHost) return;
    gameState.deck = generateDeck();
    gameState.status = 'playing';
    
    // Sadece Moderatör olmayanlara 7 kart dağıt
    gameState.players.forEach(p => {
        if(!p.isMod) {
            p.hand = gameState.deck.splice(0, 7);
        }
    });

    // İlk kartı ortaya at
    let firstCard = gameState.deck.pop();
    while(firstCard.type === 'wild' || firstCard.type === 'custom') {
        gameState.deck.unshift(firstCard);
        firstCard = gameState.deck.pop();
    }
    gameState.discardPile.push(firstCard);
    gameState.currentColor = firstCard.color;

    // İlk oyuncuyu seç (Moderatör atla)
    while(gameState.players[gameState.currentTurnIndex].isMod) {
        nextTurn();
    }
    
    document.getElementById('start-game-btn').classList.add('hidden');
    broadcastState();
});

// Hamle Doğrulama (Anti-Cheat)
function processPlayMove(peerId, cardId, selectedColor) {
    if(gameState.status !== 'playing') return;
    
    const playerIndex = gameState.players.findIndex(p => p.id === peerId);
    if(playerIndex !== gameState.currentTurnIndex) return; // Sıra onda değil! Hile girişimi reddedildi.
    
    const player = gameState.players[playerIndex];
    const cardIndex = player.hand.findIndex(c => c.id === cardId);
    if(cardIndex === -1) return; // Kart elinde yok! Hile girişimi.

    const card = player.hand[cardIndex];
    const topCard = gameState.discardPile[gameState.discardPile.length - 1];

    // Kurallar: Renk uyar, Değer uyar veya Wild (siyah) karttır.
    const isValidMove = (card.color === gameState.currentColor) || 
                        (card.value === topCard.value && card.color !== 'dark') || 
                        (card.color === 'dark');

    if(!isValidMove) return;

    // Kartı elinden al, ortaya at
    player.hand.splice(cardIndex, 1);
    gameState.discardPile.push(card);
    
    if(card.color === 'dark') {
        gameState.currentColor = selectedColor; // Kullanıcının seçtiği renk
    } else {
        gameState.currentColor = card.color;
    }

    // Hayatta Kalma (Survival) Kontrolü
    if(player.hand.length === 0) {
        player.safe = true;
    }

    // Aksiyon Kartları İşleme
    if(card.value === 'Rev') gameState.direction *= -1;
    if(card.value === 'Skip') nextTurn(); // Ekstra bir tur atla
    if(card.value === '+2') forceDrawNext(2);
    if(card.value === '+4') forceDrawNext(4);

    checkGameOver();
    if(gameState.status === 'playing') nextTurn();
    broadcastState();
}

function processDrawMove(peerId) {
    const playerIndex = gameState.players.findIndex(p => p.id === peerId);
    if(playerIndex !== gameState.currentTurnIndex) return;
    
    const player = gameState.players[playerIndex];
    if(gameState.deck.length === 0) {
        // Deste bittiyse atılanları karıştır (en üstteki hariç)
        const top = gameState.discardPile.pop();
        gameState.deck = gameState.discardPile.sort(() => Math.random() - 0.5);
        gameState.discardPile = [top];
    }
    
    if(gameState.deck.length > 0) {
        player.hand.push(gameState.deck.pop());
    }
    nextTurn();
    broadcastState();
}

function forceDrawNext(amount) {
    let nextIdx = getNextPlayerIndex();
    const targetPlayer = gameState.players[nextIdx];
    for(let i=0; i<amount; i++) {
        if(gameState.deck.length > 0) targetPlayer.hand.push(gameState.deck.pop());
    }
    nextTurn(); // Ceza alanın sırası atlanır
}

function nextTurn() {
    let loopProtect = 0;
    do {
        gameState.currentTurnIndex += gameState.direction;
        if(gameState.currentTurnIndex >= gameState.players.length) gameState.currentTurnIndex = 0;
        if(gameState.currentTurnIndex < 0) gameState.currentTurnIndex = gameState.players.length - 1;
        loopProtect++;
    } while((gameState.players[gameState.currentTurnIndex].safe || gameState.players[gameState.currentTurnIndex].isMod) && loopProtect < 10);
}

function getNextPlayerIndex() {
    let idx = gameState.currentTurnIndex + gameState.direction;
    if(idx >= gameState.players.length) idx = 0;
    if(idx < 0) idx = gameState.players.length - 1;
    return idx;
}

function checkGameOver() {
    const activePlayers = gameState.players.filter(p => !p.safe && !p.isMod);
    if(activePlayers.length === 1) {
        gameState.status = 'finished';
        if(isHost) {
            connections.forEach(conn => conn.send({ type: 'GAME_OVER', loser: activePlayers[0].name }));
            alert("Oyun Bitti! Kaybeden: " + activePlayers[0].name);
            // Burada Supabase'e bağlanıp Elo Skorlarını (Rankings) güncelleyebilirsin.
            localStorage.removeItem('quince_last_room');
            location.reload();
        }
    }
}

// --- ARAYÜZ (UI) GÜNCELLEMELERİ ---

function updateGameUI(state) {
    document.getElementById('display-room-code').innerText = roomCode;
    
    // Rakipleri Çiz
    const oppContainer = document.getElementById('opponents-container');
    oppContainer.innerHTML = '';
    state.players.forEach((p, idx) => {
        if(p.id !== myPeerId && !p.isMod) {
            const isTurn = idx === state.currentTurnIndex ? 'active-turn' : '';
            const safeClass = p.safe ? 'style="opacity:0.5; text-decoration:line-through;"' : '';
            oppContainer.innerHTML += `<div class="opponent ${isTurn}" ${safeClass}>
                <b>${p.name}</b><br>${p.hand.length} Kart
            </div>`;
        }
    });

    // Ortadaki Kart ve Renk Göstergesi
    if(state.discardPile.length > 0) {
        const topCard = state.discardPile[state.discardPile.length - 1];
        document.getElementById('discard-pile').innerHTML = createCardHTML(topCard);
        
        const colorInd = document.getElementById('current-color-indicator');
        colorInd.className = `color-indicator ${state.currentColor}`;
        colorInd.classList.remove('hidden');
    }

    // Kendi Elimi Çiz (Eğer mod değilsem)
    const myHandDiv = document.getElementById('my-hand');
    myHandDiv.innerHTML = '';
    const me = state.players.find(p => p.id === myPeerId);
    
    if(me && !me.isMod) {
        me.hand.forEach(card => {
            const cardEl = document.createElement('div');
            cardEl.innerHTML = createCardHTML(card);
            cardEl.onclick = () => attemptPlayCard(card);
            myHandDiv.appendChild(cardEl.firstElementChild);
        });
        
        const isMyTurn = state.currentTurnIndex === state.players.findIndex(p => p.id === myPeerId);
        document.getElementById('turn-indicator').innerText = isMyTurn ? "SIRA SENDE!" : "Sıra Bekleniyor...";
        document.getElementById('turn-indicator').style.color = isMyTurn ? "var(--green)" : "white";
    }

    // Sadece Host Moderatörse Tüm Elleri Çiz (God Mode)
    if(isHost && state.modOnly) {
        const modGrid = document.getElementById('all-players-hands');
        modGrid.innerHTML = '';
        state.players.forEach(p => {
            if(!p.isMod) {
                let cardsHtml = p.hand.map(c => createCardHTML(c)).join('');
                modGrid.innerHTML += `<div class="mod-player"><h4>${p.name} (${p.hand.length})</h4><div class="mod-cards">${cardsHtml}</div></div>`;
            }
        });
    }
}

// Kart Seçimi ve İstek Gönderme
let pendingCardToPlay = null;

function attemptPlayCard(card) {
    if(card.color === 'dark') {
        pendingCardToPlay = card;
        document.getElementById('color-picker-modal').classList.remove('hidden');
    } else {
        sendIntent('INTENT_PLAY', { cardId: card.id, selectedColor: null });
    }
}

// Renk Seçici (Wild Card İçin)
function submitColor(color) {
    document.getElementById('color-picker-modal').classList.add('hidden');
    sendIntent('INTENT_PLAY', { cardId: pendingCardToPlay.id, selectedColor: color });
    pendingCardToPlay = null;
}

// Desteden Çekme
document.getElementById('draw-pile').addEventListener('click', () => {
    sendIntent('INTENT_DRAW');
});

// Ağa İstek Gönder
function sendIntent(type, payload = {}) {
    if(isHost) {
        if(type === 'INTENT_PLAY') processPlayMove(myPeerId, payload.cardId, payload.selectedColor);
        if(type === 'INTENT_DRAW') processDrawMove(myPeerId);
    } else {
        hostConnection.send({ type: type, ...payload });
    }
}

// Özel Kart Ekleme (Oyun Öncesi Mod Özelliği)
document.getElementById('add-custom-card-btn').addEventListener('click', () => {
    const rule = prompt("Özel kartın kuralını yazın (örn: Herkes 1 kart çeker):");
    if(rule) {
        customCards.push(rule.substring(0, 15)); // max 15 karakter
        const li = document.createElement('li');
        li.innerText = rule;
        document.getElementById('custom-cards-list').appendChild(li);
    }
});

// Yardımcı Fonksiyonlar
function showGameScreen() {
    screens.lobby.classList.remove('active');
    screens.game.classList.add('active');
}

function createCardHTML(card) {
    let val = card.value;
    if(card.type === 'custom') val = "ÖZEL";
    return `<div class="playing-card ${card.color}"><span>${val}</span></div>`;
}
