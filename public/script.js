// STATE
let user = { balance: 0.00, today: 0.00, tasks: 0 };
// 12 app icon placeholders
const apps = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

// LEVELS
const levels = [
    { id: 1, cost: 200, profit: "4-6", style: "lv-bg-green" },
    { id: 2, cost: 680, profit: "18-24", style: "lv-bg-purple" },
    { id: 3, cost: 1560, profit: "48-65", style: "lv-bg-gold" }
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
    // WORK
    document.getElementById('wTask').innerText = user.tasks + "/12";
    document.getElementById('wComm').innerText = user.today.toFixed(2);
    document.getElementById('wTotal').innerText = user.balance.toFixed(2);
    document.getElementById('centerCount').innerText = user.tasks + "/12";
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
            <div class="lv-left ${l.style}">
                <i class="fas fa-crown lv-icon"></i>
                <div class="lv-level-txt">LV${l.id}</div>
            </div>
            <div class="lv-right">
                <div class="lv-line"><span>Betét:</span><span>${l.cost} USDT</span></div>
                <div class="lv-line"><span>Profit:</span><span>${l.profit}</span></div>
                <div style="text-align:right; margin-top:10px;">
                   <button onclick="alert('Nincs elég pénz!')" style="background:#00f2ff; border:none; padding:5px 15px; border-radius:5px; font-weight:bold;">FELOLDÁS</button>
                </div>
            </div>
        </div>
    `).join('');
}

// ROTATOR (12 ELEM KÖRBEN)
function initRotator() {
    const circle = document.getElementById('iconCircle');
    const radius = 135; 
    const total = 12;

    for(let i=0; i<total; i++) {
        const el = document.createElement('div');
        el.className = 'app-item';
        // Helykitöltő kép (színes négyzet)
        el.style.backgroundColor = `hsl(${i*30}, 70%, 50%)`;
        el.innerHTML = '<i class="fas fa-gamepad" style="color:#fff; font-size:14px;"></i>';
        
        const angle = (i / total) * 2 * Math.PI;
        const x = Math.cos(angle) * radius + 160; // 320/2
        const y = Math.sin(angle) * radius + 160;
        
        el.style.left = (x - 22.5) + 'px';
        el.style.top = (y - 22.5) + 'px';
        
        circle.appendChild(el);
    }
}

function runTask() {
    if(user.tasks >= 12) { alert("Nincs több feladat!"); return; }
    
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
        
        document.getElementById('mRew').innerText = "+" + r.toFixed(2) + " USDT";
        document.getElementById('modal').style.display = 'flex';
        
        btn.disabled = false;
    }, 3000);
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
}
