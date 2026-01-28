// STATE
let user = {
    balance: 0.00,
    today: 0.00,
    tasks: 0,
    level: 1
};

// SZINTEK ADATOK (SLV INFÓVAL)
const levels = [
    { id: 1, cost: 200, profit: "4-6", slv: "+20% ha 2 embert meghívsz" },
    { id: 2, cost: 680, profit: "18-24", slv: "+25% ha 3 embert meghívsz" },
    { id: 3, cost: 1560, profit: "48-65", slv: "+30% ha 5 embert meghívsz" },
    { id: 4, cost: 3600, profit: "104", slv: "VIP szint" },
    { id: 5, cost: 7600, profit: "200", slv: "Director szint" }
];

const apps = ["TikTok", "FB", "Insta", "Uber", "Temu", "Amz", "Spoti", "Snap", "Line", "X"];

// INIT
document.addEventListener("DOMContentLoaded", () => {
    renderLevels();
    initRotator();
    updateUI();
});

function updateUI() {
    // Main
    document.getElementById('mainBal').innerText = user.balance.toFixed(2);
    document.getElementById('mainToday').innerText = user.today.toFixed(2);
    // Work
    document.getElementById('workDone').innerText = user.tasks + "/10";
    document.getElementById('workComm').innerText = user.today.toFixed(2);
    document.getElementById('workTotal').innerText = user.balance.toFixed(2);
    // Profile
    document.getElementById('profBigBal').innerText = user.balance.toFixed(2) + " USDT";
    document.getElementById('pAvail').innerText = user.balance.toFixed(2) + " USDT";
    document.getElementById('pToday').innerText = user.today.toFixed(2) + " USDT";
}

function nav(pageId, btn) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    
    if(btn) {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        btn.classList.add('active');
    }
}

// --- LEVELS ---
function renderLevels() {
    const cont = document.getElementById('lvContainer');
    const colors = ["#00ff9d", "#0099ff", "#ffd700", "#aa00ff", "#ff0055"];
    
    cont.innerHTML = levels.map((l, i) => `
        <div class="lv-row">
            <div class="lv-left">
                <i class="fas fa-shield-alt lv-shield" style="color:${colors[i]}"></i>
                <div style="font-weight:bold; color:${colors[i]}">LV${l.id}</div>
            </div>
            <div class="lv-right">
                <div class="lv-line"><span>Betét:</span><span>${l.cost} USDT</span></div>
                <div class="lv-line"><span>Profit:</span><span style="color:${colors[i]}">${l.profit}</span></div>
                <div class="slv-info">SLV: ${l.slv}</div>
                <button onclick="alert('Nincs elég pénz!')" style="float:right; margin-top:5px; background:transparent; border:1px solid ${colors[i]}; color:${colors[i]}; border-radius:10px; font-size:10px;">AKTIVÁLÁS</button>
            </div>
        </div>
    `).join('');
}

// --- ROTATOR LOGIC (A KÖR) ---
function initRotator() {
    const rot = document.getElementById('rotator');
    const total = apps.length;
    const radius = 130; // Kör sugara

    // Ikonok elhelyezése körben
    apps.forEach((app, i) => {
        const el = document.createElement('div');
        el.className = 'app-icon';
        el.innerHTML = '<i class="fab fa-android"></i>'; // Placeholder icon
        
        // Matek: Kör koordináták
        const angle = (i / total) * 2 * Math.PI;
        const x = Math.cos(angle) * radius + 150; // 150 a fele a 300px containernek
        const y = Math.sin(angle) * radius + 150;
        
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        rot.appendChild(el);
    });
}

function startRotation() {
    if(user.tasks >= 10) { alert("Vége mára!"); return; }
    
    const rot = document.getElementById('rotator');
    const btn = document.getElementById('startBtn');
    
    btn.disabled = true;
    
    // Pörgetés (CSS Transform)
    const randomRot = 720 + Math.floor(Math.random() * 360);
    rot.style.transform = `rotate(${randomRot}deg)`;
    
    setTimeout(() => {
        // Kész
        rot.style.transform = `rotate(0deg)`; // Reset (vagy maradhatna is)
        
        const reward = 0.50;
        user.balance += reward;
        user.today += reward;
        user.tasks++;
        updateUI();
        
        document.getElementById('centerText').innerText = user.tasks + "/10";
        document.getElementById('mApp').innerText = "App: " + apps[Math.floor(Math.random()*apps.length)];
        document.getElementById('modalOverlay').style.display = 'flex';
        
        btn.disabled = false;
    }, 3000);
}

function closeModal() {
    document.getElementById('modalOverlay').style.display = 'none';
}
