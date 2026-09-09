/* ==========================================================================
   NEXUS: MARKET TYCOON — FULL CLIENT ENGINE (app.js)
   Connected to Supabase Project: yvgbcckemyrqrjpbvzyn
   ========================================================================== */

const SUPABASE_URL = "https://yvgbcckemyrqrjpbvzyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_98Q1xbAaSOd2GwYAwCfCpg_AU487UEm";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let activeChatTargetId = null;

// SHA-256 hash helper for password verification
async function hashString(str) {
    const buffer = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ==========================================================================
   AUTHENTICATION ENGINE
   ========================================================================== */
async function handleLogin() {
    const username = document.getElementById('auth-username').value.trim().toLowerCase();
    const pass = document.getElementById('auth-password').value.trim();

    if (!username || !pass) return showAuthError('Please fill in both fields.');

    const passHash = await hashString(pass);
    const { data: user, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('username', username)
        .single();

    if (error || !user || user.password_hash !== passHash) {
        return showAuthError('Invalid username or password.');
    }

    if (!user.is_enabled) return showAuthError('This operative account has been disabled.');

    currentUser = user;
    sessionStorage.setItem('nexus_user_id', user.id);
    document.getElementById('login-modal').classList.remove('active');
    postAuthInit();
}

async function handleRegister() {
    const username = document.getElementById('auth-username').value.trim().toLowerCase();
    const pass = document.getElementById('auth-password').value.trim();

    if (!username || !pass) return showAuthError('Please enter username & password.');

    const passHash = await hashString(pass);
    const role = (username === 'abdo') ? 'admin' : 'player';

    const { data: newUser, error } = await supabase
        .from('profiles')
        .insert([{
            username: username,
            display_name: username.charAt(0).toUpperCase() + username.slice(1),
            password_hash: passHash,
            role: role,
            cash: role === 'admin' ? 500000 : 100000
        }])
        .select()
        .single();

    if (error) return showAuthError(error.message);

    // Starter items drop
    await supabase.from('inventories').insert([
        { owner_id: newUser.id, name: 'Cyberblade Prototype', rarity: 'RARE', icon: '🗡️', value: 35000, discovered_by: newUser.display_name },
        { owner_id: newUser.id, name: 'Neural Chipset', rarity: 'COMMON', icon: '💾', value: 12000, discovered_by: newUser.display_name }
    ]);

    currentUser = newUser;
    sessionStorage.setItem('nexus_user_id', newUser.id);
    document.getElementById('login-modal').classList.remove('active');
    postAuthInit();
}

function showAuthError(msg) {
    const box = document.getElementById('auth-msg');
    box.textContent = msg;
    box.style.display = 'block';
}

function executeLogout() {
    currentUser = null;
    sessionStorage.removeItem('nexus_user_id');
    document.getElementById('login-modal').classList.add('active');
}

function openSwitchAccountModal() {
    document.getElementById('login-modal').classList.add('active');
}

/* ==========================================================================
   STATE ORCHESTRATION & REALTIME LISTENERS
   ========================================================================== */
async function postAuthInit() {
    updateUserStatsUI();
    setupRealtimeSubscriptions();
    renderAllSections();
}

function updateUserStatsUI() {
    if (!currentUser) return;
    document.getElementById('stat-username').textContent = `${currentUser.display_name} (${currentUser.role.toUpperCase()})`;
    document.getElementById('stat-cash').textContent = `$${Number(currentUser.cash).toLocaleString()}`;
    document.getElementById('stat-level').textContent = `Lvl ${currentUser.level} (${currentUser.xp} XP)`;
    document.getElementById('stat-prestige').textContent = `Prestige ${currentUser.prestige}`;

    if (currentUser.role === 'admin') {
        const adminTab = document.getElementById('admin-nav-tab');
        if (adminTab) adminTab.style.display = 'block';
    }
}

function setupRealtimeSubscriptions() {
    supabase
        .channel('public:profiles')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (payload) => {
            if (currentUser && payload.new.id === currentUser.id) {
                currentUser = payload.new;
                updateUserStatsUI();
            }
            renderLeaderboards();
        })
        .subscribe();

    supabase
        .channel('public:market_listings')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'market_listings' }, () => {
            renderMarketplace();
        })
        .subscribe();

    supabase
        .channel('public:auctions')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'auctions' }, () => {
            renderAuctions();
        })
        .subscribe();

    supabase
        .channel('public:stocks')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'stocks' }, () => {
            renderTicker();
        })
        .subscribe();

    supabase
        .channel('public:messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
            if (payload.new.receiver_id === currentUser.id || payload.new.sender_id === currentUser.id) {
                renderMessagesFeed();
            }
        })
        .subscribe();
}

async function renderAllSections() {
    renderTicker();
    renderMarketplace();
    renderAuctions();
    renderInventory();
    renderBusinesses();
    renderMessagesContacts();
    renderLeaderboards();
}

/* ==========================================================================
   MARKETPLACE & AUCTIONS
   ========================================================================== */
async function renderMarketplace() {
    const grid = document.getElementById('market-listings-grid');
    if (!grid) return;

    const { data: listings } = await supabase
        .from('market_listings')
        .select('id, price, seller_id, profiles(display_name), inventories(name, rarity, icon, value)');

    grid.innerHTML = '';
    if (!listings || listings.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:var(--text-muted); padding:30px;">No market listings active.</div>';
        return;
    }

    listings.forEach(l => {
        const item = l.inventories;
        const seller = l.profiles;
        const card = document.createElement('div');
        card.className = `item-card rarity-${item.rarity}`;
        card.innerHTML = `
            <div class="item-icon">${item.icon}</div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong>${item.name}</strong>
                <span class="rarity-badge rarity-${item.rarity}">${item.rarity}</span>
            </div>
            <div style="font-size:0.8rem; color:var(--text-muted);">Seller: <span class="text-cyan">${seller?.display_name || 'Anonymous'}</span></div>
            <div class="mono text-gold" style="font-size:1.2rem; font-weight:700;">$${Number(l.price).toLocaleString()}</div>
            ${l.seller_id !== currentUser.id ? 
                `<button class="btn btn-gold btn-sm" style="width:100%; margin-top:6px;" onclick="executeBuyMarketItem('${l.id}')">BUY NOW</button>` :
                `<div style="font-size:0.75rem; color:var(--accent-cyan); text-align:center; margin-top:8px;">YOUR ACTIVE LISTING</div>`
            }
        `;
        grid.appendChild(card);
    });
}

async function executeBuyMarketItem(listingId) {
    const { data, error } = await supabase.rpc('buy_market_item', {
        p_listing_id: listingId,
        p_buyer_id: currentUser.id
    });

    if (error || !data.success) {
        alert(error ? error.message : data.message);
    } else {
        alert(data.message);
        renderInventory();
    }
}

async function openListItemModal() {
    const select = document.getElementById('list-item-select');
    select.innerHTML = '';

    const { data: items } = await supabase
        .from('inventories')
        .select('*')
        .eq('owner_id', currentUser.id);

    if (!items || items.length === 0) return alert('No items available in your inventory to list!');

    items.forEach(i => {
        const opt = document.createElement('option');
        opt.value = i.id;
        opt.textContent = `${i.name} (${i.rarity})`;
        select.appendChild(opt);
    });

    document.getElementById('list-item-modal').classList.add('active');
}

async function submitMarketListing() {
    const itemId = document.getElementById('list-item-select').value;
    const price = Number(document.getElementById('list-item-price').value);

    if (!price || price <= 0) return alert('Enter a valid positive price!');

    await supabase.from('inventories').update({ owner_id: 'MARKET' }).eq('id', itemId);
    await supabase.from('market_listings').insert([{ seller_id: currentUser.id, item_id: itemId, price: price }]);

    closeModal('list-item-modal');
    renderInventory();
    renderMarketplace();
}

async function renderAuctions() {
    const grid = document.getElementById('auctions-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const { data: auctions } = await supabase
        .from('auctions')
        .select('id, current_bid, expires_at, profiles!seller_id(display_name), inventories(name, rarity, icon), highest_bidder:profiles!highest_bidder_id(display_name)');

    if (!auctions || auctions.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:var(--text-muted); padding:30px;">No live auctions right now.</div>';
        return;
    }

    auctions.forEach(a => {
        const card = document.createElement('div');
        card.className = `nexus-card rarity-${a.inventories.rarity}`;
        card.innerHTML = `
            <div style="font-size:2.5rem; text-align:center; margin-bottom:10px;">${a.inventories.icon}</div>
            <h3>${a.inventories.name}</h3>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:10px;">Seller: ${a.profiles?.display_name || 'System'}</div>
            <div class="stat-label">HIGHEST BID</div>
            <div class="mono text-gold" style="font-size:1.4rem; font-weight:700;">$${Number(a.current_bid).toLocaleString()} CASH</div>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">Bidder: <span class="text-cyan">${a.highest_bidder?.display_name || 'None'}</span></div>
            <button class="btn btn-gold btn-sm" style="width:100%; margin-top:12px;" onclick="executeRaiseBid('${a.id}', ${a.current_bid})">RAISE BID (+10%)</button>
        `;
        grid.appendChild(card);
    });
}

async function executeRaiseBid(auctionId, currentBid) {
    const nextBid = Math.floor(currentBid * 1.1);
    const { data, error } = await supabase.rpc('place_auction_bid', {
        p_auction_id: auctionId,
        p_bidder_id: currentUser.id,
        p_bid_amount: nextBid
    });

    if (error || !data.success) {
        alert(error ? error.message : data.message);
    } else {
        alert(`Bid successfully placed: $${nextBid.toLocaleString()}!`);
    }
}

async function openStartAuctionModal() {
    const select = document.getElementById('auction-item-select');
    select.innerHTML = '';

    const { data: items } = await supabase.from('inventories').select('*').eq('owner_id', currentUser.id);
    if (!items || items.length === 0) return alert('No items available to auction!');

    items.forEach(i => {
        const opt = document.createElement('option');
        opt.value = i.id;
        opt.textContent = `${i.name} (${i.rarity})`;
        select.appendChild(opt);
    });

    document.getElementById('start-auction-modal').classList.add('active');
}

async function submitAuctionCreation() {
    const itemId = document.getElementById('auction-item-select').value;
    const startBid = Number(document.getElementById('auction-start-bid').value);

    if (!startBid || startBid <= 0) return alert('Enter a valid starting bid!');

    await supabase.from('inventories').update({ owner_id: 'AUCTION' }).eq('id', itemId);
    await supabase.from('auctions').insert([{
        seller_id: currentUser.id,
        item_id: itemId,
        current_bid: startBid,
        expires_at: new Date(Date.now() + 600000).toISOString()
    }]);

    closeModal('start-auction-modal');
    renderInventory();
    renderAuctions();
}

/* ==========================================================================
   INVENTORY & LAB FORGE
   ========================================================================== */
async function renderInventory() {
    const grid = document.getElementById('inventory-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const { data: items } = await supabase
        .from('inventories')
        .select('*')
        .eq('owner_id', currentUser.id);

    if (!items || items.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:var(--text-muted); padding:30px;">Inventory is empty.</div>';
        return;
    }

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = `item-card rarity-${item.rarity}`;
        card.innerHTML = `
            <div class="item-icon">${item.icon}</div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong>${item.name}</strong>
                <span class="rarity-badge rarity-${item.rarity}">${item.rarity}</span>
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted);">Discovered by: ${item.discovered_by}</div>
            <div class="mono text-green">$${Number(item.value).toLocaleString()} CASH</div>
            <button class="btn btn-sm" style="width:100%; margin-top:4px;" onclick="executeEvolveItem('${item.id}', ${item.value}, '${item.name}')">🧪 EVOLVE ($25K)</button>
        `;
        grid.appendChild(card);
    });
}

async function executeEvolveItem(itemId, currentValue, currentName) {
    if (currentUser.cash < 25000) return alert('Evolution requires at least $25,000 cash balance!');

    const updatedName = currentName.replace('Prototype', '').replace('Damaged', '').trim() + ' Prime ⚡';

    await supabase.from('profiles').update({ cash: currentUser.cash - 25000 }).eq('id', currentUser.id);
    await supabase.from('inventories').update({
        name: updatedName,
        rarity: 'LEGENDARY',
        value: Math.floor(currentValue * 2.5),
        stage: 'Prime'
    }).eq('id', itemId);

    currentUser.cash -= 25000;
    updateUserStatsUI();
    renderInventory();
}

/* ==========================================================================
   BUSINESS EMPIRE
   ========================================================================== */
async function renderBusinesses() {
    const grid = document.getElementById('businesses-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const types = [
        { type: 'Warehouse', name: 'Logistics Warehouse', price: 100000, income: 500, icon: '📦' },
        { type: 'Store', name: 'Cyber Retail Store', price: 250000, income: 1500, icon: '🛒' },
        { type: 'Factory', name: 'Industrial Factory', price: 1000000, income: 8000, icon: '🏭' }
    ];

    const { data: myBusinesses } = await supabase
        .from('businesses')
        .select('*')
        .eq('owner_id', currentUser.id);

    types.forEach(b => {
        const owned = myBusinesses?.find(x => x.type === b.type);
        const card = document.createElement('div');
        card.className = 'nexus-card';
        card.innerHTML = `
            <div style="font-size:2.5rem; text-align:center;">${b.icon}</div>
            <h3>${b.name}</h3>
            <div style="margin:10px 0; font-size:0.85rem; color:var(--text-muted);">
                ${owned ? `<span class="text-green">OWNED (LEVEL ${owned.level})</span>` : `Cost: $${b.price.toLocaleString()}`}
            </div>
            <div class="mono text-gold">+${(b.income * (owned ? owned.level : 1)).toLocaleString()} / MIN</div>
            ${owned ? 
                `<button class="btn btn-gold btn-sm" style="width:100%; margin-top:10px;" onclick="upgradeFacility('${owned.id}', ${owned.level})">UPGRADE LVL ($${(b.price * owned.level).toLocaleString()})</button>` : 
                `<button class="btn btn-sm" style="width:100%; margin-top:10px;" onclick="purchaseFacility('${b.type}', '${b.name}', ${b.price}, ${b.income})">PURCHASE FACILITY</button>`
            }
        `;
        grid.appendChild(card);
    });
}

async function purchaseFacility(type, name, price, income) {
    if (currentUser.cash < price) return alert('Insufficient funds to purchase facility.');

    await supabase.from('profiles').update({ cash: currentUser.cash - price }).eq('id', currentUser.id);
    await supabase.from('businesses').insert([{
        owner_id: currentUser.id,
        name: `${currentUser.display_name}'s ${name}`,
        type: type,
        income_per_min: income,
        level: 1
    }]);

    currentUser.cash -= price;
    updateUserStatsUI();
    renderBusinesses();
}

async function upgradeFacility(bizId, currentLevel) {
    const cost = currentLevel * 100000;
    if (currentUser.cash < cost) return alert(`Need $${cost.toLocaleString()} cash to upgrade.`);

    await supabase.from('profiles').update({ cash: currentUser.cash - cost }).eq('id', currentUser.id);
    await supabase.from('businesses').update({ level: currentLevel + 1 }).eq('id', bizId);

    currentUser.cash -= cost;
    updateUserStatsUI();
    renderBusinesses();
}

/* ==========================================================================
   CHAT SYSTEM
   ========================================================================== */
async function renderMessagesContacts() {
    const sidebar = document.getElementById('chat-contacts-list');
    if (!sidebar) return;
    sidebar.innerHTML = '';

    const { data: players } = await supabase.from('profiles').select('id, display_name, username').neq('id', currentUser.id);
    if (!players) return;

    players.forEach(p => {
        const el = document.createElement('div');
        el.className = `chat-contact ${activeChatTargetId === p.id ? 'active' : ''}`;
        el.onclick = () => {
            activeChatTargetId = p.id;
            document.getElementById('chat-target-header').textContent = `Chatting with: ${p.display_name} (@${p.username})`;
            renderMessagesContacts();
            renderMessagesFeed();
        };
        el.innerHTML = `<strong>${p.display_name}</strong><br><span style="font-size:0.75rem; color:var(--text-muted);">@${p.username}</span>`;
        sidebar.appendChild(el);
    });
}

async function renderMessagesFeed() {
    if (!activeChatTargetId) return;
    const box = document.getElementById('chat-messages-box');
    if (!box) return;
    box.innerHTML = '';

    const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${activeChatTargetId}),and(sender_id.eq.${activeChatTargetId},receiver_id.eq.${currentUser.id})`)
        .order('created_at', { ascending: tr
