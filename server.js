<!DOCTYPE html>
<html lang="hu">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Owner HQ | <%= brandName %></title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@800&family=Inter:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        body { background: #000000; color: #fff; font-family: 'Inter', sans-serif; overflow-x: hidden; }
        .tech-card { background: #0a0a0a; border: 1px solid #222; border-radius: 20px; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
        .hidden { display: none !important; }
        #sidebar { position: fixed; top: 0; left: 0; width: 260px; height: 100vh; background: #09090b; border-right: 1px solid #222; z-index: 50; padding-top: 80px; }
        .menu-item { display: flex; align-items: center; gap: 15px; width: 100%; padding: 18px 25px; color: #666; font-size: 11px; font-weight: 800; text-transform: uppercase; border-left: 3px solid transparent; }
        .menu-item:hover, .menu-item.active { color: #fff; background: #111; border-left-color: #c084fc; }
        .chat-container { height: 400px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 10px; background: #050505; border: 1px solid #222; border-radius: 12px; }
        .msg { padding: 10px 15px; border-radius: 12px; font-size: 12px; max-width: 80%; }
        .msg-me { align-self: flex-end; background: #2563eb; } .msg-ai { align-self: flex-start; background: #222; border: 1px solid #333; }
        .orange-neon { color: #FF9F43; }
    </style>
    <script>
        function switchTab(id) {
            document.querySelectorAll('.page-section').forEach(e => e.classList.add('hidden'));
            document.querySelectorAll('.menu-item').forEach(b => b.classList.remove('active'));
            document.getElementById('tab-' + id).classList.remove('hidden');
            document.getElementById('btn-' + id).classList.add('active');
        }
    </script>
</head>
<body class="min-h-screen">
    <nav id="sidebar" class="hidden lg:block">
        <div class="px-6 mb-6"><h2 class="text-white font-black text-xl tracking-widest uppercase">HQ <span class="text-purple-500">CONTROL</span></h2></div>
        <button onclick="switchTab('dashboard')" id="btn-dashboard" class="menu-item active"><span>📊</span> VEZÉRLŐPULT</button>
        <button onclick="switchTab('marketing')" id="btn-marketing" class="menu-item"><span>📢</span> MARKETING</button>
        <button onclick="switchTab('users')" id="btn-users" class="menu-item"><span>👥</span> TAGOK & LICENSZ</button>
        <button onclick="switchTab('chat')" id="btn-chat" class="menu-item"><span>🤖</span> RÓKA AGYA</button>
        <button onclick="switchTab('finance')" id="btn-finance" class="menu-item"><span>💰</span> PÉNZÜGY</button>
        <a href="/logout" class="absolute bottom-10 left-0 w-full text-center text-red-500 py-3 text-[10px] font-black uppercase">Kijelentkezés</a>
    </nav>

    <header class="lg:hidden fixed top-0 w-full bg-black border-b border-zinc-800 p-4 z-40 flex justify-between">
        <span class="font-black">ZSIVÁNY HQ</span>
        <a href="/dashboard" class="text-xs font-bold text-purple-500">DASHBOARD ➤</a>
    </header>

    <main class="pt-[70px] lg:pt-[20px] px-4 pb-10 w-full lg:pl-[280px] max-w-6xl mx-auto">
        
        <div id="tab-dashboard" class="page-section pt-10">
            <h2 class="text-xl font-black mb-6 border-l-4 border-purple-500 pl-4">Vezérlőpult</h2>
            <div class="tech-card p-6">
                <p class="text-xs text-zinc-500 font-bold uppercase mb-4">Stratégia: <span class="orange-neon"><%= strategyMode.toUpperCase() %></span></p>
                <form action="/admin/update-settings" method="POST" class="grid grid-cols-3 gap-3">
                    <button name="mode" value="recovery" class="p-4 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black hover:border-blue-500">🛡️ ÓVATOS</button>
                    <button name="mode" value="normal" class="p-4 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black hover:border-purple-500">🦊 NORMÁL</button>
                    <button name="mode" value="aggressive" class="p-4 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black hover:border-orange-500">🔥 ZSIVÁNY</button>
                </form>
            </div>

            <div class="tech-card p-6">
                <% if (currentTip) { %>
                    <h3 class="text-xl font-black"><%= currentTip.match %></h3>
                    <p class="text-purple-400 font-bold text-sm mb-4"><%= currentTip.prediction %> (@<%= currentTip.odds %>)</p>
                    <% if(!currentTip.isPublished) { %>
                        <form action="/admin/publish-tip" method="POST" class="mb-4"><input type="hidden" name="tipId" value="<%= currentTip._id %>"><button class="w-full bg-blue-600 py-3 rounded-xl font-black text-xs uppercase">📢 PUBLIKÁLÁS</button></form>
                    <% } %>
                    <div class="grid grid-cols-2 gap-4">
                        <form action="/admin/settle-tip" method="POST" onsubmit="return confirm('Biztos WIN?')"><input type="hidden" name="status" value="win"><button class="w-full bg-green-900/40 border border-green-500 text-green-500 py-3 rounded-xl font-black text-xs">WIN ✅</button></form>
                        <form action="/admin/settle-tip" method="POST" onsubmit="return confirm('Biztos LOSS?')"><input type="hidden" name="status" value="loss"><button class="w-full bg-red-900/40 border border-red-500 text-red-500 py-3 rounded-xl font-black text-xs">LOSS ❌</button></form>
                    </div>
                <% } else { %>
                    <div class="text-center py-6"><div class="text-4xl mb-2">🤖</div><form action="/admin/run-robot" method="POST"><button class="bg-white text-black px-6 py-3 rounded-xl font-black text-xs uppercase">🚀 Elemzés Indítása</button></form></div>
                <% } %>
            </div>
        </div>

        <div id="tab-marketing" class="page-section hidden pt-10">
            <h2 class="text-xl font-black mb-6 border-l-4 border-pink-500 pl-4">Marketing</h2>
            <div class="tech-card p-6">
                <div class="flex gap-3 mb-4">
                    <button onclick="generateSocial('win')" class="flex-1 bg-zinc-800 py-3 rounded-xl text-[10px] font-black uppercase hover:bg-green-900">🏆 NYERŐ POSZT</button>
                    <button onclick="generateSocial('motivation')" class="flex-1 bg-zinc-800 py-3 rounded-xl text-[10px] font-black uppercase hover:bg-pink-900">🔥 MOTIVÁCIÓ</button>
                </div>
                <textarea id="social-result" rows="5" class="w-full bg-black border border-zinc-800 rounded-xl p-4 text-xs text-white" placeholder="Ide generálja a szöveget..."></textarea>
            </div>
        </div>

        <div id="tab-users" class="page-section hidden pt-10">
            <h2 class="text-xl font-black mb-6 border-l-4 border-green-500 pl-4">Tagok</h2>
            <div class="grid gap-3">
                <% users.forEach(u => { %> 
                    <div class="tech-card p-5 flex flex-col sm:flex-row justify-between items-center gap-4">
                        <div class="w-full">
                            <p class="font-bold text-sm"><%= u.fullname %> <span class="text-[10px] text-zinc-500"><%= u.email %></span></p>
                            <p class="text-[10px] text-zinc-400">Bank: <%= u.currentBankroll %> | Havi: <%= u.monthlyProfit %></p>
                            <span class="text-[9px] font-black uppercase px-2 py-1 rounded <%= u.hasLicense ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400' %>"><%= u.hasLicense ? 'AKTÍV' : 'INAKTÍV' %></span>
                        </div>
                        <form action="/admin/toggle-license" method="POST" class="w-full sm:w-auto">
                            <input type="hidden" name="userId" value="<%= u._id %>">
                            <button class="w-full px-4 py-3 rounded-xl text-[10px] font-black uppercase border <%= u.hasLicense ? 'border-red-500 text-red-500' : 'border-green-500 text-green-500' %>"><%= u.hasLicense ? 'ELVÉTEL ⛔' : 'AKTIVÁLÁS ✅' %></button>
                        </form>
                    </div> 
                <% }) %>
            </div>
        </div>
        
        <div id="tab-chat" class="page-section hidden pt-10">
            <h2 class="text-xl font-black mb-6 border-l-4 border-blue-500 pl-4">Róka Agya</h2>
            <div class="tech-card p-4 h-[500px] flex flex-col">
                <div id="chat-win" class="chat-container flex-1 mb-4 custom-scrollbar">
                    <% chatHistory.forEach(msg => { %> <div class="msg <%= msg.sender === 'Főnök' ? 'msg-me' : 'msg-ai' %>"><strong class="block mb-1 text-[10px] opacity-50 uppercase"><%= msg.sender %></strong> <%= msg.text %></div> <% }) %>
                </div>
                <div class="flex gap-2">
                    <input type="text" id="chat-in" class="flex-1 bg-black border border-zinc-700 rounded-xl px-4 py-3 text-xs text-white" placeholder="Írj..." onkeypress="if(event.key === 'Enter') talk()">
                    <button onclick="talk()" class="bg-purple-600 px-6 py-3 rounded-xl font-bold">➤</button>
                </div>
            </div>
        </div>

        <div id="tab-finance" class="page-section hidden pt-10">
            <h2 class="text-xl font-black mb-6 border-l-4 border-yellow-500 pl-4">Pénzügyi Zárás</h2>
            <div class="tech-card p-6 border border-red-900/40 bg-red-950/10">
                <h3 class="text-sm font-black text-red-500 uppercase mb-2">Hónap Zárása</h3>
                <p class="text-xs text-zinc-400 mb-4">Csak hónap elsején használd!</p>
                <form action="/admin/reset-monthly" method="POST" onsubmit="return confirm('Biztos nullázod a havi profitot?')"><button class="w-full bg-red-600 text-white py-3 rounded-xl font-black text-xs uppercase">🔄 ÚJ HÓNAP INDÍTÁSA</button></form>
            </div>
        </div>
    </main>

    <script>
        const win = document.getElementById('chat-win'); if(win) win.scrollTop = win.scrollHeight;
        async function talk() { 
            const i = document.getElementById('chat-in'); if(!i.value) return; const msgText = i.value; i.value = ''; 
            const win = document.getElementById('chat-win'); win.innerHTML += `<div class="msg msg-me"><strong>Főnök:</strong> ${msgText}</div>`; win.scrollTop = win.scrollHeight; 
            try { const r = await fetch('/admin/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message: msgText})}); const d = await r.json(); win.innerHTML += `<div class="msg msg-ai"><strong>Róka:</strong> ${d.reply}</div>`; win.scrollTop = win.scrollHeight; } catch (err) { alert("Hiba."); } 
        }
        async function generateSocial(type) { 
            const textarea = document.getElementById('social-result'); textarea.value = "Generálás... 🦊";
            try { const res = await fetch('/admin/social-content', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ type }) }); const data = await res.json(); textarea.value = data.content; } catch(e) { textarea.value = "Hiba történt."; } 
        }
    </script>
</body>
</html>