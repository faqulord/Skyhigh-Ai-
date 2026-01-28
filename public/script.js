// ADATOK
let user = { balance: 0.00, today: 0.00, tasks: 0 };
const apps = ["TikTok", "FB", "Insta", "X", "Temu", "Uber", "Amz", "Snap", "Line", "Chat"];

// LEVELS ADATOK
const levels = [
    { id: 1, cost: 200, profit: "4-6 USDT / Nap", icon: "fa-shield-alt" },
    { id: 2, cost: 680, profit: "18-24 USDT / Nap", icon: "fa-rocket" },
    { id: 3, cost: 1560, profit: "48-65 USDT / Nap", icon: "fa-crown" }
];

document.addEventListener("DOMContentLoaded", () => {
    initLevels();
    initRotator();
    updateUI();
});

function updateUI() {
    // HOME
    document.getElementById('mainBal').innerText = user.balance.toFixed(2);
    document.getElementById('mainToday').innerText = user.today.toFixed(2);
    document.getElementById('homeTask').innerText = user.tasks;
    // WORK
    document.getElementById('wTask').innerText = user.tasks + "/10";
    document.getElementById('wComm').innerText = user.today.toFixed(2);
    document.getElementById('wTotal').innerText = user.balance.toFixed(2);
    // PROFILE
    document.getElementById('profBal').innerText = user.balance.toFixed(2) + " USDT";
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

function initLevels() {
    const c = document.getElementById('lvContainer');
    c.innerHTML = levels.map(l => `
        <div class="lv-card">
            <div class="lv-icon"><i class="fas ${l.icon}"></i></div>
            <div class="lv-info">
                <div class="lv-title">LEVEL ${l.id}</div>
                <div class="lv-sub">Kaució: ${l.cost} USDT</div>
                <div class="lv-sub">Profit: ${l.profit}</div>
            </div>
            <button class="lv-btn">AKTÍV</button>
        </div>
    `).join('');
}

// ROTATOR (KÖR)
function initRotator() {
    const circle = document.getElementById('iconCircle');
    const radius = 120; // Sugár
    const total = apps.length;

    apps.forEach((app, i) => {
        const el = document.createElement('div');
        el.className = 'app-item';
        el.innerHTML = '<i class="fab fa-android"></i>'; // Placeholder icon
        
        const angle = (i / total) * 2 * Math.PI;
        // Középpont 150, 150 (300/2)
        const x = Math.cos(angle) * radius + 150;
        const y = Math.sin(angle) * radius + 150;
        
        el.style.left = (x - 20) + 'px'; // -20 a fél szélesség miatt
        el.style.top = (y - 20) + 'px';
        
        circle.appendChild(el);
    });
}

function runTask() {
    if(user.tasks >= 10) { alert("Nincs több feladat!"); return; }
    
    const circle = document.getElementById('iconCircle');
    const btn = document.getElementById('startBtn');
    
    btn.disabled = true;
    
    // Pörgetés
    const rot = 720 + Math.floor(Math.random() * 360);
    circle.style.transform = `rotate(${rot}deg)`;
    
    setTimeout(() => {
        circle.style.transform = `rotate(0deg)`;
        
        const r = 0.50;
        user.balance += r;
        user.today += r;
        user.tasks++;
        updateUI();
        
        document.getElementById('centerCount').innerText = user.tasks + "/10";
        document.getElementById('mRew').innerText = "+" + r.toFixed(2) + " USDT";
        document.getElementById('modal').style.display = 'flex';
        
        btn.disabled = false;
    }, 3000);
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
}
