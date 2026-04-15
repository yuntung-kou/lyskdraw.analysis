// ════════════════════════════════════════════════════════════
//  app.js — 戀與深空抽卡分析器 (標籤動態核發 + 拔除防歪標籤)
// ════════════════════════════════════════════════════════════

const leadIcons = { '祁煜': '🐟', '沈星回': '🌟', '黎深': '🍐', '秦徹': '🚘', '夏以晝': '🍎' };

window.currentPendingPulls = 0; 

const getDB  = () => JSON.parse(localStorage.getItem('db_v4')) || [];
const setDB  = (db) => localStorage.setItem('db_v4', JSON.stringify(db));
const getP   = (type) => parseInt(localStorage.getItem('p_' + type)) || 0;
const _setP  = (type, v) => localStorage.setItem('p_' + type, v);
const setP   = (type, v) => { _setP(type, v); renderUI(); };

function initTheme() {
    let saved = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = saved;
    document.getElementById('themeBtn').textContent = saved === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    document.getElementById('themeBtn').textContent = next === 'dark' ? '☀️' : '🌙';
}

function toggleOshiEdit() {
    const group = document.getElementById('oshiGroup');
    const btn   = document.getElementById('oshiToggleBtn');
    const isHidden = group.style.display === 'none';
    group.style.display = isHidden ? 'flex' : 'none';
    btn.innerText = isHidden ? '[收起]' : '[設定]';
}

function updateOshiSummary() {
    const oshis = JSON.parse(localStorage.getItem('oshis')) || [];
    const summary = document.getElementById('oshiSummary');
    summary.innerHTML = oshis.length > 0 ? `💖 主推守護中：${oshis.map(name => leadIcons[name] || '').join('')}` : `💖 尚未設定主推`;
}

function saveOshis() {
    const oshis = Array.from(document.querySelectorAll('input[name="oshi"]:checked')).map(cb => cb.value);
    localStorage.setItem('oshis', JSON.stringify(oshis));
    updateOshiSummary();
    renderUI();
}

function loadOshis() {
    const oshis = JSON.parse(localStorage.getItem('oshis')) || [];
    document.querySelectorAll('input[name="oshi"]').forEach(cb => { cb.checked = oshis.includes(cb.value); });
    updateOshiSummary();
}

function parseEventTime(e) {
    try {
        const startStr = e.duration.split('-')[0];
        const [m, d] = startStr.split('.');
        return new Date(`${e.year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T00:00:00`).getTime();
    } catch (err) { return 0; }
}

function updateBannerRecommendations() {
    if (typeof eventCards === 'undefined') return;
    const mainPool = document.querySelector('input[name="mainPool"]:checked').value;
    const subPool  = document.querySelector('input[name="subPool"]:checked').value;

    let filteredEvents = eventCards.filter(e => {
        const isRerun = e.poolType.includes('復刻');
        if (mainPool === '限定' && isRerun) return false;
        if (mainPool === '復刻' && !isRerun) return false;
        if (subPool === '混池' && e.poolType.includes('混池')) return true;
        if (subPool === '日卡' && e.poolType.includes('日卡')) return true;
        return subPool === '單人' && (e.poolType.includes('單人') || e.poolType.includes('生日') || e.poolType.includes('免五') || e.poolType === '復刻');
    });

    filteredEvents.sort((a, b) => parseEventTime(b) - parseEventTime(a));
    dropdownData.bannerName = [...new Set(filteredEvents.map(e => e.eventName))];
    dropdownData.upCardName = [...new Set(filteredEvents.flatMap(e => Object.values(e.cards).flat()))];
}

function onPoolChange() {
    updateBannerRecommendations();
    updatePulledCardList();
}

let dropdownData = { bannerName: [], upCardName: [], cardName: [] };
function renderDropdown(inputId) {
    const wrapper = document.getElementById(inputId + 'ListWrapper');
    const input   = document.getElementById(inputId);
    const val     = input.value.toLowerCase();
    const list    = dropdownData[inputId];
    wrapper.innerHTML = '';
    let count = 0;
    list.forEach(item => {
        if (!item.toLowerCase().includes(val)) return;
        const div = document.createElement('div');
        div.className = 'autocomplete-item';
        div.innerText = item;
        div.onmousedown = () => {
            input.value = item;
            wrapper.style.display = 'none';
            if (inputId === 'bannerName') autoFillBannerInfo();
            if (inputId === 'upCardName') autoFillFromUpCard();
        };
        wrapper.appendChild(div);
        count++;
    });
    wrapper.style.display = count > 0 ? 'block' : 'none';
}

function filterDropdown(inputId) { renderDropdown(inputId); }
function showDropdown(inputId)  { renderDropdown(inputId); }
function hideDropdownDelayed(inputId) { setTimeout(() => { const w = document.getElementById(inputId + 'ListWrapper'); if (w) w.style.display = 'none'; }, 150); }

function findEvent(eventName, mainPool) {
    if (typeof eventCards === 'undefined') return null;
    const matches = eventCards.filter(e => e.eventName === eventName);
    return matches.find(e => mainPool === '復刻' ? e.poolType.includes('復刻') : !e.poolType.includes('復刻')) || matches[0];
}

window.autoFillFromUpCard = function() {
    const upCardName = document.getElementById('upCardName').value;
    if (!upCardName || typeof eventCards === 'undefined') return;
    const currentMainPool = document.querySelector('input[name="mainPool"]:checked').value;
    const matchingEvents = eventCards.filter(e => Object.values(e.cards).some(cards => cards.includes(upCardName)));
    if (matchingEvents.length > 0) {
        let best = matchingEvents.find(e => (currentMainPool === '復刻' && e.poolType.includes('復刻')) || (currentMainPool === '限定' && !e.poolType.includes('復刻'))) || matchingEvents[0];
        document.getElementById('bannerName').value = best.eventName;
        window.autoFillBannerInfo(best);
    }
};

window.autoFillBannerInfo = function(forcedEvent = null) {
    const bannerName = document.getElementById('bannerName').value;
    let event = forcedEvent || findEvent(bannerName, document.querySelector('input[name="mainPool"]:checked').value);
    if (event) {
        const isRerun = event.poolType.includes('復刻');
        document.querySelector(`input[name="mainPool"][value="${isRerun ? '復刻' : '限定'}"]`).checked = true;
        if (event.poolType.includes('混池')) document.querySelector('input[name="subPool"][value="混池"]').checked = true;
        else if (event.poolType.includes('日卡')) document.querySelector('input[name="subPool"][value="日卡"]').checked = true;
        else document.querySelector('input[name="subPool"][value="單人"]').checked = true;
    }
    onPoolChange();
};

window.updatePulledCardList = function() {
    const bannerName = document.getElementById('bannerName').value;
    const pulledLead = document.querySelector('input[name="pulledLead"]:checked').value;
    let options = [];
    if (bannerName && typeof eventCards !== 'undefined') {
        const event = findEvent(bannerName, document.querySelector('input[name="mainPool"]:checked').value);
        if (event?.cards?.[pulledLead]) options.push(...event.cards[pulledLead]);
    }
    if (typeof standardCards !== 'undefined' && standardCards[pulledLead]) options.push(...standardCards[pulledLead]);
    dropdownData.cardName = [...new Set(options)];
};

window.autoFillFromOCR = function(pulls, cardName, latestTime, pendingPulls) {
    window.currentPendingPulls = pendingPulls || 0;
    document.getElementById('pulls').value = pulls;
    if (!cardName || cardName === '未知' || cardName.includes('未知卡名')) return;
    document.getElementById('cardName').value = cardName;

    let foundLead = null;
    let isStandard = false;
    for (const lead in standardCards) { if (standardCards[lead].includes(cardName)) { foundLead = lead; isStandard = true; break; } }

    let matchedEvent = null;
    if (typeof eventCards !== 'undefined') {
        let possibleEvents = eventCards.filter(ev => Object.values(ev.cards).some(c => c.includes(cardName)));
        if (possibleEvents.length > 0) {
            const year = latestTime ? new Date(latestTime).getFullYear().toString() : null;
            matchedEvent = possibleEvents.find(ev => ev.year === year) || possibleEvents[0];
        } else if (latestTime) {
            matchedEvent = eventCards.slice().reverse().find(ev => parseEventTime(ev) <= latestTime);
        }
    }

    if (matchedEvent) {
        const isRerun = matchedEvent.poolType.includes('復刻');
        document.querySelector(`input[name="mainPool"][value="${isRerun ? '復刻' : '限定'}"]`).checked = true;
        if (matchedEvent.poolType.includes('混池')) document.querySelector('input[name="subPool"][value="混池"]').checked = true;
        else if (matchedEvent.poolType.includes('日卡')) document.querySelector('input[name="subPool"][value="日卡"]').checked = true;
        else document.querySelector('input[name="subPool"][value="單人"]').checked = true;
        document.getElementById('bannerName').value = matchedEvent.eventName;
    }

    if (!foundLead && matchedEvent) {
        for (const lead in matchedEvent.cards) { if (matchedEvent.cards[lead].includes(cardName)) { foundLead = lead; break; } }
    }
    if (foundLead) {
        const radio = document.querySelector(`input[name="pulledLead"][value="${foundLead}"]`);
        if (radio) radio.checked = true;
    }

    const poolKey = (matchedEvent?.poolType.includes('復刻')) ? 're' : 'lim';
    let isUpCard = false;
    if (matchedEvent && foundLead) isUpCard = matchedEvent.cards[foundLead]?.includes(cardName);
    
    const progress = isUpCard ? window.currentPendingPulls : (70 + window.currentPendingPulls);
    setP(poolKey, progress);

    onPoolChange();
    updatePulledCardList();
};

// 🌟 全新評估標準：根據官方機率分佈對應 前15%, 33%, 51%, 69% 玩家落點
// 判斷單次出金 (70抽底)：前15%(<=16抽), 前33%(<=40抽), 前51%(<=61抽), 前69%(<=62抽)
const judgeS = (p) => p <= 16 ? { t: '天選之子 ✨', c: '#16a34a', s: 2 } : p <= 40 ? { t: '幸運兒 🌟', c: '#4ade80', s: 1 } : p <= 61 ? { t: '平凡人 😐', c: '#facc15', s: 0 } : p <= 62 ? { t: '小不幸運 🌧️', c: '#fb923c', s: -1 } : { t: '小倒霉鬼 🌩️', c: '#dc2626', s: -2 };
// 判斷限定出金 (140抽底)：前15%(<=30抽), 前33%(<=61抽), 前51%(<=65抽), 前69%(<=68抽)
const judgeT = (p) => p <= 30 ? { t: '天選之子 ✨', c: '#16a34a', s: 2 } : p <= 61 ? { t: '幸運兒 🌟', c: '#4ade80', s: 1 } : p <= 65 ? { t: '平凡人 😐', c: '#facc15', s: 0 } : p <= 68 ? { t: '小不幸運 🌧️', c: '#fb923c', s: -1 } : { t: '小倒霉鬼 🌩️', c: '#dc2626', s: -2 };

function editPending(type) {
    const v = prompt('手動修改『已墊抽數』\n(請輸入您目前已經墊了幾抽，0~139)：', getP(type));
    if (v !== null && !isNaN(parseInt(v))) setP(type, parseInt(v));
}

function addRecord() {
    const banner = document.getElementById('bannerName').value.trim();
    const main = document.querySelector('input[name="mainPool"]:checked').value;
    const sub = document.querySelector('input[name="subPool"]:checked').value;
    const pulledLead = document.querySelector('input[name="pulledLead"]:checked').value;
    const card = document.getElementById('cardName').value.trim();
    const pulls = parseInt(document.getElementById('pulls').value);

    if (!banner) return alert('請輸入卡池名稱！');
    if (isNaN(pulls) || pulls < 1 || pulls > 70) return alert('請輸入 1-70 抽！');

    const event = findEvent(banner, main);
    const isUpCard = event && event.cards[pulledLead] && (!card || event.cards[pulledLead].includes(card));
    const oshis = JSON.parse(localStorage.getItem('oshis')) || [];

    // 🌟 完全移除 oshi_spook：如果是限定卡，檢查是否為歪限定；如果不是限定卡，一律算作常駐 (wai_std)
    let judgeResult = isUpCard ? 
        (sub === '混池' && oshis.length > 0 && !oshis.includes(pulledLead) ? 'wai_lim' : 'target') : 
        'wai_std';
        
    const poolKey = main === '限定' ? 'lim' : 're';
    const currentP = getP(poolKey);
    
    // 建立新紀錄（不寫死 luck 標籤，讓 renderUI 動態核發）
    let rec = { id: Date.now(), main, sub, lead: pulledLead, banner, card, pulls, res: judgeResult };

    if (judgeResult === 'target') {
        rec.total = currentP + pulls; 
        _setP(poolKey, window.currentPendingPulls); 
    } else {
        rec.total = pulls; 
        const isStandard = typeof standardCards !== 'undefined' && Object.values(standardCards).flat().includes(card);
        _setP(poolKey, isStandard ? (70 + window.currentPendingPulls) : (currentP + pulls));
    }

    window.currentPendingPulls = 0; 
    let db = getDB(); db.push(rec); setDB(db);
    document.getElementById('cardName').value = ''; document.getElementById('pulls').value = '';
    renderUI();
}

function deleteRec(id) { if (confirm('確定刪除此筆紀錄？')) { setDB(getDB().filter(r => r.id !== id)); renderUI(); } }
function clearAll() { if (confirm('確定清空所有資料？')) { localStorage.removeItem('db_v4'); _setP('lim', 0); _setP('re', 0); window.currentPendingPulls = 0; renderUI(); } }

function updateLuckStats() {
    const db = getDB();
    
    // 計算基本統計數據
    const totalPulls = db.reduce((sum, r) => sum + r.pulls, 0);
    document.getElementById('statTotalPulls').innerText = totalPulls;

    // 💎 計算並顯示等值的鑽石數量 (總抽數 x 150)
    const totalDiamonds = totalPulls * 150;
    const diamondEl = document.getElementById('statTotalDiamonds');
    if (diamondEl) diamondEl.innerText = `(${totalDiamonds.toLocaleString()} 鑽)`;

    const avgFiveStar = db.length > 0 ? (totalPulls / db.length).toFixed(1) : '0.0';
    document.getElementById('statAvgFiveStar').innerText = avgFiveStar;

    const targetsOnly = db.filter(r => r.res === 'target');
    const avgLimited = targetsOnly.length > 0 ? (targetsOnly.reduce((sum, r) => sum + r.total, 0) / targetsOnly.length).toFixed(1) : '0.0';
    document.getElementById('statAvgLimited').innerText = avgLimited;

    // 體質鑑定與精確幸運度百分比
    const mainF = document.getElementById('mainPoolLuckSelect').value;
    const subF = document.getElementById('subPoolLuckSelect').value;
    
    const calcPercentile = (avgPulls) => {
        if (!avgPulls || avgPulls <= 0) return '';
        let pullCount = Math.max(1, Math.min(140, Math.round(parseFloat(avgPulls))));
        if (typeof beatPercentTable === 'undefined') return ''; 
        let beatPercent = beatPercentTable[pullCount];
        return `幸運度超過了約 ${beatPercent}% 的玩家`;
    };

    const getStats = (items) => {
        if (!items.length) return { text: '---', percentile: '' };
        
        // 使用動態計算出的 luck.s 來決定平均分數
        const avgScore = items.reduce((a, b) => a + b.luck.s, 0) / items.length;
        const avgLimitedPulls = items.reduce((a, b) => a + b.total, 0) / items.length;
        
        let beatPercent = 0;
        if (typeof beatPercentTable !== 'undefined') {
            let pullCount = Math.max(1, Math.min(140, Math.round(avgLimitedPulls)));
            beatPercent = beatPercentTable[pullCount];
        }
        
        // 🌟 總面板體質：直接掛鉤真正的 % 數標準 (前15%, 33%, 51%, 69%)
        let text = '';
        if (beatPercent >= 85) text = '<span class="title-god">✨ 天選之子</span>';
        else if (beatPercent >= 67) text = '<span class="title-lucky">🌟 幸運兒</span>';
        else if (beatPercent >= 49) text = '<span class="title-plain">😐 平凡人</span>';
        else if (beatPercent >= 31) text = '<span class="title-unlucky">🌧️ 小不幸運</span>';
        else text = '<span class="title-bad">🌩️ 小倒霉鬼</span>';

        return { text, percentile: calcPercentile(avgLimitedPulls) };
    };

    const mainItems = db.filter(r => r.res === 'target' && (mainF === '綜合' || r.main === mainF));
    const subItems = db.filter(r => r.res === 'target' && r.sub === subF);

    const mainRes = getStats(mainItems);
    document.getElementById('luckMainVal').innerHTML = mainRes.text;
    document.getElementById('luckMainPercentile').innerHTML = mainRes.percentile;

    const subRes = getStats(subItems);
    document.getElementById('luckSubVal').innerHTML = subRes.text;
    document.getElementById('luckSubPercentile').innerHTML = subRes.percentile;
}

function getEventDate(eventName, mainPool) {
    const target = findEvent(eventName, mainPool);
    return target ? parseEventTime(target) : 0;
}

function renderUI() {
    document.getElementById('pLim').innerText = 140 - getP('lim');
    document.getElementById('pRe').innerText  = 140 - getP('re');
    let db = getDB();
    const oshis = JSON.parse(localStorage.getItem('oshis')) || [];

    // 🌟 資料清洗與動態標籤重算
    db.forEach(r => {
        // 1. 自動修正舊資料，把舊的防歪主推改成常駐
        if (r.res === 'oshi_spook') r.res = 'wai_std';
        
        // 2. 設定排序時間
        const evTime = getEventDate(r.banner, r.main);
        r._evTime = evTime; r._sortTime = evTime || r.id; r._entryOrder = r.id;
        
        // 3. 每次重整頁面時「重新判定幸運度」，確保舊資料完美對齊你的新標準！
        r.luck = (r.res === 'target') ? judgeT(r.total) : judgeS(r.pulls);
    });
    
    // 將修正後的資料回存 (這樣就算換設備，舊的防歪標籤也死透了)
    setDB(db);

    db.sort((a, b) => b._sortTime - a._sortTime || b._entryOrder - a._entryOrder);
    
    updateLuckStats();

    let peakHTML = '';
    if (db.length > 0) {
        const targets = db.filter(r => r.res === 'target');
        if (targets.length > 0) {
            const best = [...targets].sort((a, b) => b.luck.s - a.luck.s || a.total - b.total)[0];
            peakHTML += `<div class="peak-item"><span class="peak-label-best">🏆 巔峰紀錄:</span> <span>${best.lead ? (oshis.includes(best.lead) ? '💖' : '') + (leadIcons[best.lead] || '') + best.lead : ''} ${best.banner} (${best.total}抽)</span></div>`;
        }
        // 從統計中移除 oshi_spook
        const waiR = db.filter(r => ['wai_std','wai_lim'].includes(r.res));
        if (waiR.length > 0) {
            const counts = {}; waiR.forEach(r => counts[r.lead] = (counts[r.lead] || 0) + 1);
            let maxC = 0; let maxL = [];
            for (const l in counts) { if (counts[l] > maxC) { maxC = counts[l]; maxL = [l]; } else if (counts[l] === maxC) maxL.push(l); }
            peakHTML += `<div class="peak-item" style="margin-top:4px;"><span class="peak-label-spook">💔 歪卡常客:</span> <span>${maxL.map(l => (leadIcons[l] || '') + l).join('、')} (${maxC}次)</span></div>`;
        }
    }
    document.getElementById('peakBoard').innerHTML = peakHTML || '<div style="text-align:center;font-size:12px;color:var(--text-sub)">尚無資料</div>';

    document.getElementById('recordList').innerHTML = db.map(r => {
        let cardTypeStr, statusColor;
        
        // 徹底只剩下三種狀態：目標限定、非主推限定、常駐
        if (r.res === 'target') { 
            cardTypeStr = '🎯 限定'; 
            statusColor = 'var(--primary)'; 
        } else if (r.res === 'wai_lim') { 
            cardTypeStr = '💔 限定'; 
            statusColor = '#ef4444'; 
        } else { 
            cardTypeStr = '☠️ 常駐'; 
            statusColor = '#475569'; 
        }
        
        const d = new Date(r._evTime || r.id);
        const dateStr = r._evTime ? `[${d.getFullYear().toString().slice(2)}/${(d.getMonth()+1).toString().padStart(2,'0')}]` : '[未知]';
        const isBlack = r.pulls > 55 && r.pulls <= 62 && r.luck.s <= 1;

        return `
        <div class="h-record-card">
            <div class="h-bar-bg" style="width: ${Math.min((r.pulls / 70) * 100, 100)}%; background-color: ${r.luck.c};"></div>
            <div class="h-content">
                <div class="h-left">
                    <div class="h-tags">${r.main === '復刻' ? '<span class="tag tag-re">復刻</span>' : ''}<span class="tag tag-lim">${r.sub}</span><span class="tag" style="background-color: ${statusColor};">${cardTypeStr}</span></div>
                    <span class="h-title"><span style="font-size: 15px; font-weight: bold; color: var(--text-main);">${r.card || '未知'}</span><span style="font-size: 12px; font-weight: normal;"> | ${r.banner}</span><span class="h-date">${dateStr}</span></span>
                </div>
                <div class="h-right">
                    <div class="h-pulls"><span class="pull-num">${r.pulls}</span> 抽</div>
                    <div class="h-luck ${r.pulls > 55 ? 'luck-high' : ''} ${isBlack ? 'luck-black-light' : ''}" style="${r.pulls <= 55 ? 'background-color:' + r.luck.c + 'BF;color:#fff;' : ''}">${r.luck.t}</div>
                    <button class="del-btn-icon" onclick="deleteRec(${r.id})">🗑️</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

initTheme(); loadOshis(); updateBannerRecommendations(); renderUI();
