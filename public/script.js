// --- ADATOK (STATE) ---
let user = {
    balance: 0.00,
    today: 0.00,
    tasks: 0,
    level: 1
};

const levels = [
    { id: 1, cost: 200, profit: "4-6", color: "#00ff9d" },
    { id: 2, cost: 680, profit: "18-24", color: "#00f2ff" },
    { id: 3, cost: 1560, profit: "48-65", color: "#ffd700" }
];

const apps = ["TikTok", "Instagram", "Binance", "Temu", "Spotify", "Uber", "Facebook", "Amazon"];

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
    renderLevels();
    renderGrid();
    updateUI();
});

// --- UI FRISSÍTÉS ---
function updateUI() {
    // Lobby
    document.getElementById('lobbyBal').innerText = user.balance.toFixed(2);
    // Work
    document.getElementById('workBal').innerText = user.balance.toFixed(2);
    document.getElementById('workComm').innerText = user.today.toFixed(2);
    document.getElementById('taskCount').innerText = user.tasks;
    // Profile
    document.getElementById('profBal').innerText = user.balance.toFixed(2) + " USDT";
    document.getElementById('profAvail').innerText = user.balance.toFixed(2) + " USDT";
    document.getElementById('profToday').innerText = user.today.toFixed(2) + " USDT";
}

// --- NAVIGÁCIÓ ---
function nav(pageId, btn) {
    // Oldalak elrejtése
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    // Kiválasztott megjelenítése
    document.getElementById(pageId).classList.add('active');

    // Gombok frissítése
    if(btn) {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        btn.classList.add('active');
    }

    // Ha a Lobbyból mész a Munkára, frissítsd a menüt is
    if(pageId === 'work' && !btn) {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.nav-item')[2].classList.add('active');
    }
}

// --- LEVELS RENDERELÉS ---
function renderLevels() {
    const container = document.getElementById('levelContainer');
    container.innerHTML = levels.map(lv => `
        <div class="lv-card">
            <div class="lv-side" style="color:${lv.color}">
                <i class="fas fa-shield-alt"></i>
                <div style="font-weight:bold; font-size:12px">LV${lv.id}</div>
            </div>
            <div class="lv-cont">
                <div class="lv-row"><span>Kaució</span><span>${lv.cost} USDT</span></div>
                <div class="lv-row"><span>Profit</span><span style="color:${lv.color}">${lv.profit} USDT</span></div>
                <button class="lv-btn" onclick="alert('Nincs elég fedezet!')">AKTIVÁLÁS</button>
            </div>
        </div>
    `).join('');
}

// --- WORK GRID RENDERELÉS ---
function renderGrid() {
    const grid = document.getElementById('iconGrid');
    // Többszörözzük meg az ikonokat a rácshoz
    const gridIcons = [...apps, ...apps].slice(0, 16); 
    grid.innerHTML = gridIcons.map(app => `
        <div class="grid-item"><i class="fab fa-${app.toLowerCase()}"></i></div>
    `).join('');
}

// --- TASK LOGIKA (ANIMÁCIÓ) ---
function startTask() {
    if(user.tasks >= 10) {
        alert("Mára végeztél a feladatokkal!");
        return;
    }

    const btn = document.getElementById('startBtn');
    const items = document.querySelectorAll('.grid-item');
    btn.disabled = true;
    btn.innerText = "KERESÉS...";

    // Véletlenszerű villogás
    let interval = setInterval(() => {
        items.forEach(i => i.classList.remove('active'));
        const rand = Math.floor(Math.random() * items.length);
        items[rand].classList.add('active');
    }, 100);

    setTimeout(() => {
        clearInterval(interval);
        // Nyerő kiválasztása
        items.forEach(i => i.classList.remove('active'));
        const winIdx = Math.floor(Math.random() * items.length);
        items[winIdx].classList.add('active');

        // Matek
        const reward = 0.50;
        user.balance += reward;
        user.today += reward;
        user.tasks++;
        updateUI();

        // Modal
        document.getElementById('modalApp').innerText = "Optimalizálva: " + apps[winIdx % apps.length];
        document.getElementById('modalAmt').innerText = "+" + reward.toFixed(2) + " USDT";
        document.getElementById('modal').style.display = 'flex';

        btn.disabled = false;
        btn.innerText = "FELADAT INDÍTÁSA";

    }, 2000);
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
    document.querySelectorAll('.grid-item').forEach(i => i.classList.remove('active'));
}
