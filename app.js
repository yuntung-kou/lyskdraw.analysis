// ════════════════════════════════════════════════════════════
//  app.js — 戀與深空抽卡分析器 (支援四欄內嵌體質統計)
// ════════════════════════════════════════════════════════════

const leadIcons = { '祁煜': '🐟', '沈星回': '🌟', '黎深': '🍐', '秦徹': '🚘', '夏以晝': '🍎' };

window.currentPendingPulls = 0;

const getDB = () => JSON.parse(localStorage.getItem('db_v4')) || [];
const setDB = (db) => {
    const toSave = db.map(({ _evTime, _sortTime, _entryOrder, luck, ...rest }) => rest);
    localStorage.setItem('db_v4', JSON.stringify(toSave));
};
const getP  = (type) => parseInt(localStorage.getItem('p_' + type)) || 0;
const _setP = (type, v) => localStorage.setItem('p_' + type, v);
const setP  = (type, v) => { _setP(type, v); renderUI(); };

// ── 主題 ──────────────────────────────────────────────────
function initTheme() {
    const saved = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = saved;
    document.getElementById('themeBtn').textContent = saved === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    document.getElementById('themeBtn').textContent = next === 'dark' ? '☀️' : '🌙';
}

// ── 主推設定 ──────────────────────────────────────────────
function toggleOshiEdit() {
    const group = document.getElementById('oshiGroup');
    const btn   = document.getElementById('oshiToggleBtn');
    const isHidden = group.style.display === 'none';
    group.style.display = isHidden ? 'flex' : 'none';
    btn.innerText = isHidden ? '[收起]' : '[設定]';
}

function updateOshiSummary() {
    const oshis = JSON.parse(localStorage.getItem('oshis')) || [];
    document.getElementById('oshiSummary').innerHTML = oshis.length > 0
        ? `💖 主推守護中：${oshis.map(name => leadIcons[name] || '').join('')}`
        : `💖 尚未設定主推`;
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

// ── 活動資料解析 ───────────────────────────────────────────
function parseEventTime(e) {
    try {
        const startStr = e.duration.split('-')[0];
        const [m, d] = startStr.split('.');
        return new Date(`${e.year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00`).getTime();
    } catch (err) { return 0; }
}

function updateBannerRecommendations() {
    const mainPool = document.querySelector('input[name="mainPool"]:checked').value;
    const subPoolGroup = document.getElementById('subPoolGroup');
    
    if (mainPool === '常駐') {
        if(subPoolGroup) subPoolGroup.style.opacity = '0.3';
        dropdownData.bannerName = ['極空迴音'];
        dropdownData.upCardName = typeof standardCards !== 'undefined' ? [...new Set(Object.values(standardCards).flat())] : [];
        document.getElementById('bannerName').value = '極空迴音';
        return;
    }
    
    if(subPoolGroup) subPoolGroup.style.opacity = '1';
    if (typeof eventCards === 'undefined') return;
    const subPool  = document.querySelector('input[name="subPool"]:checked').value;

    const filteredEvents = eventCards.filter(e => {
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

// ── 下拉選單 ───────────────────────────────────────────────
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

const filterDropdown = renderDropdown;
const showDropdown   = renderDropdown;

function hideDropdownDelayed(inputId) {
    setTimeout(() => {
        const w = document.getElementById(inputId + 'ListWrapper');
        if (w) w.style.display = 'none';
    }, 150);
}

// ── 活動查詢 Helper ────────────────────────────────────────
function findEvent(eventName, mainPool) {
    if (typeof eventCards === 'undefined') return null;
    const matches = eventCards.filter(e => e.eventName === eventName);
    return matches.find(e => mainPool === '復刻' ? e.poolType.includes('復刻') : !e.poolType.includes('復刻')) || matches[0];
}

function findTrueLead(cardName) {
    if (typeof standardCards !== 'undefined') {
        for (const lead in standardCards) {
            if (standardCards[lead].includes(cardName)) return lead;
        }
    }
    if (typeof eventCards !== 'undefined') {
        for (const event of eventCards) {
            for (const lead in event.cards) {
                if (event.cards[lead]?.includes(cardName)) return lead;
            }
        }
    }
    return null;
}

// ── 自動填入 ───────────────────────────────────────────────
window.autoFillFromUpCard = function () {
    const upCardName = document.getElementById('upCardName').value;
    if (!upCardName || typeof eventCards === 'undefined') return;
    const currentMainPool = document.querySelector('input[name="mainPool"]:checked').value;
    if (currentMainPool === '常駐') return; 
    
    const matchingEvents = eventCards.filter(e => Object.values(e.cards).some(cards => cards.includes(upCardName)));
    if (matchingEvents.length > 0) {
        const best = matchingEvents.find(e =>
            (currentMainPool === '復刻' && e.poolType.includes('復刻')) ||
            (currentMainPool === '限定' && !e.poolType.includes('復刻'))
        ) || matchingEvents[0];
        document.getElementById('bannerName').value = best.eventName;
        window.autoFillBannerInfo(best);
    }
};

window.autoFillBannerInfo = function (forcedEvent = null) {
    const bannerName = document.getElementById('bannerName').value;
    if (bannerName === '極空迴音') return;
    
    const event = forcedEvent || findEvent(bannerName, document.querySelector('input[name="mainPool"]:checked').value);
    if (event) {
        const isRerun = event.poolType.includes('復刻');
        document.querySelector(`input[name="mainPool"][value="${isRerun ? '復刻' : '限定'}"]`).checked = true;
        if (event.poolType.includes('混池'))      document.querySelector('input[name="subPool"][value="混池"]').checked = true;
        else if (event.poolType.includes('日卡')) document.querySelector('input[name="subPool"][value="日卡"]').checked = true;
        else                                      document.querySelector('input[name="subPool"][value="單人"]').checked = true;
    }
    onPoolChange();
};

window.updatePulledCardList = function () {
    const bannerName = document.getElementById('bannerName').value;
    const pulledLead = document.querySelector('input[name="pulledLead"]:checked').value;
    let options = [];
    if (bannerName && bannerName !== '極空迴音' && typeof eventCards !== 'undefined') {
        const event = findEvent(bannerName, document.querySelector('input[name="mainPool"]:checked').value);
        if (event?.cards?.[pulledLead]) options.push(...event.cards[pulledLead]);
    }
    if (typeof standardCards !== 'undefined' && standardCards[pulledLead]) options.push(...standardCards[pulledLead]);
    dropdownData.cardName = [...new Set(options)];
};

window.autoFillFromOCR = function (pulls, cardName, latestTime, pendingPulls, rawText = '') {
    window.currentPendingPulls = pendingPulls || 0;
    document.getElementById('pulls').value = pulls;
    if (!cardName || cardName === '未知' || cardName.includes('未知卡名')) return;
    document.getElementById('cardName').value = cardName;

    let foundLead = findTrueLead(cardName);
    let matchedEvent = null;
    
    if (typeof eventCards !== 'undefined') {
        const possibleEvents = eventCards.filter(ev => Object.values(ev.cards).some(c => c.includes(cardName)));
        if (possibleEvents.length > 0) {
            const year = latestTime ? new Date(latestTime).getFullYear().toString() : null;
            matchedEvent = possibleEvents.find(ev => ev.year === year) || possibleEvents[0];
        } else if (latestTime) {
            matchedEvent = eventCards.slice().reverse().find(ev => parseEventTime(ev) <= latestTime);
        }
    }

    if (rawText.includes('極空迴音')) {
        document.querySelector(`input[name="mainPool"][value="常駐"]`).checked = true;
        document.getElementById('bannerName').value = '極空迴音';
    } else if (matchedEvent) {
        const isRerun = matchedEvent.poolType.includes('復刻');
        document.querySelector(`input[name="mainPool"][value="${isRerun ? '復刻' : '限定'}"]`).checked = true;
        if (matchedEvent.poolType.includes('混池'))      document.querySelector('input[name="subPool"][value="混池"]').checked = true;
        else if (matchedEvent.poolType.includes('日卡')) document.querySelector('input[name="subPool"][value="日卡"]').checked = true;
        else                                             document.querySelector('input[name="subPool"][value="單人"]').checked = true;
        document.getElementById('bannerName').value = matchedEvent.eventName;
    }

    if (!foundLead && matchedEvent) {
        for (const lead in matchedEvent.cards) {
            if (matchedEvent.cards[lead].includes(cardName)) { foundLead = lead; break; }
        }
    }
    if (foundLead) {
        const radio = document.querySelector(`input[name="pulledLead"][value="${foundLead}"]`);
        if (radio) radio.checked = true;
    }

    const mainPoolValue = document.querySelector('input[name="mainPool"]:checked').value;
    const poolKey = mainPoolValue === '限定' ? 'lim' : (mainPoolValue === '復刻' ? 're' : 'std');
    
    let progress = window.currentPendingPulls;
    if (poolKey !== 'std') {
        const isUpCard = !!(matchedEvent && foundLead && matchedEvent.cards[foundLead]?.includes(cardName));
        progress = isUpCard ? window.currentPendingPulls : (70 + window.currentPendingPulls);
    }
    setP(poolKey, progress);

    onPoolChange();
};

// ── 幸運判定 ───────────────────────────────────────────────
const judgeS = (p) =>
    p <= 16 ? { t: '天選之子 ✨', c: '#16a34a', s:  2 } :
    p <= 40 ? { t: '幸運兒 🌟',  c: '#4ade80', s:  1 } :
    p <= 61 ? { t: '平凡人 😐',  c: '#facc15', s:  0 } :
    p <= 65 ? { t: '小不幸運 🌧️', c: '#fb923c', s: -1 } :
              { t: '小倒霉鬼 🌩️', c: '#dc2626', s: -2 };

const judgeT = (p) =>
    p <= 30 ? { t: '天選之子 ✨', c: '#16a34a', s:  2 } :
    p <= 62 ? { t: '幸運兒 🌟',  c: '#4ade80', s:  1 } :
    p <= 65 ? { t: '平凡人 😐',  c: '#facc15', s:  0 } :
    p <= 68 ? { t: '小不幸運 🌧️', c: '#fb923c', s: -1 } :
              { t: '小倒霉鬼 🌩️', c: '#dc2626', s: -2 };

// ── 手動修改已墊抽數 ───────────────────────────────────────
function editPending(type) {
    const max = type === 'std' ? 69 : 139;
    const v = prompt(`手動修改『已墊抽數』\n(請輸入您目前已經墊了幾抽，0~${max})：`, getP(type));
    if (v !== null && !isNaN(parseInt(v))) setP(type, parseInt(v));
}

// ── 新增紀錄 ───────────────────────────────────────────────
function addRecord() {
    const banner     = document.getElementById('bannerName').value.trim();
    const main       = document.querySelector('input[name="mainPool"]:checked').value;
    const sub        = document.querySelector('input[name="subPool"]:checked').value;
    const pulledLead = document.querySelector('input[name="pulledLead"]:checked').value;
    const card       = document.getElementById('cardName').value.trim();
    const pulls      = parseInt(document.getElementById('pulls').value);

    if (!banner) return alert('請輸入卡池名稱！');
    if (isNaN(pulls) || pulls < 1 || pulls > 70) return alert('請輸入 1-70 抽！');

    const event = findEvent(banner, main);
    const isUpCard = !!(event && card && event.cards[pulledLead]?.includes(card));
    const oshis = JSON.parse(localStorage.getItem('oshis')) || [];

    let judgeResult;
    if (main === '常駐') {
        judgeResult = 'std'; 
    } else {
        judgeResult = isUpCard
            ? (sub === '混池' && oshis.length > 0 && !oshis.includes(pulledLead) ? 'wai_lim' : 'target')
            : 'wai_std';
    }

    const poolKey  = main === '限定' ? 'lim' : (main === '復刻' ? 're' : 'std');
    const currentP = getP(poolKey);

    const rec = { id: Date.now(), main, sub, lead: pulledLead, banner, card, pulls, res: judgeResult };

    if (judgeResult === 'target' || judgeResult === 'std') {
        rec.total = currentP + pulls;
        _setP(poolKey, window.currentPendingPulls); 
    } else {
        rec.total = pulls;
        _setP(poolKey, currentP + pulls); 
    }

    window.currentPendingPulls = 0;
    const db = getDB();
    db.push(rec);
    setDB(db);
    document.getElementById('cardName').value = '';
    document.getElementById('pulls').value = '';
    renderUI();
}

function deleteRec(id) {
    const db = getDB();
    const rec = db.find(r => r.id === id);
    if (!rec) return;

    if (confirm(`確定刪除 ${rec.card} (${rec.pulls}抽) 嗎？\n\n⚠️ 注意：系統不會自動扣除右上角的「已墊抽數」。\n如果您要重新輸入這筆資料，請務必手動點擊右上角 ✏️，將墊抽數字改回正確的狀態（或歸零），否則抽數會被重複疊加！`)) { 
        setDB(db.filter(r => r.id !== id)); 
        renderUI(); 
    }
}

function clearAll() {
    if (confirm('確定清空所有資料？')) {
        localStorage.removeItem('db_v4');
        _setP('lim', 0);
        _setP('re', 0);
        _setP('std', 0);
        window.currentPendingPulls = 0;
        renderUI();
    }
}

// ── 四欄式統計面板 ────────────────────────────────────────
// 替換原有的 updateLuckStats 函式 (包含內部的 getLuckHtml 修改)
function updateLuckStats(db = getDB()) {
    // 依據平均抽數產生體質標籤 HTML (若無資料回傳 ---)
    function getLuckHtml(avgPulls, isTarget) {
        if (avgPulls === 0) return '<span style="color:var(--text-sub)">---</span>';
        
        let mainHtml = '';
        let percentText = '';

        if (isTarget) {
            const pullCount = Math.max(1, Math.min(140, Math.round(avgPulls)));
            const beatPercent = (typeof beatPercentTable !== 'undefined') ? beatPercentTable[pullCount] : 0;
            if      (beatPercent >= 85)   mainHtml = '<span class="title-god">✨ 天選之子</span>';
            else if (beatPercent >= 63.5) mainHtml = '<span class="title-lucky">🌟 幸運兒</span>';
            else if (beatPercent >= 48)   mainHtml = '<span class="title-plain">😐 平凡人</span>';
            else if (beatPercent >= 32.5) mainHtml = '<span class="title-unlucky">🌧️ 小不幸運</span>';
            else                          mainHtml = '<span class="title-bad">🌩️ 小倒霉鬼</span>';
            
            percentText = `超越 ${beatPercent}% 玩家`;
        } else {
            const p = avgPulls;
            if (p <= 16) mainHtml = '<span class="title-god">✨ 天選之子</span>';
            else if (p <= 40) mainHtml = '<span class="title-lucky">🌟 幸運兒</span>';
            else if (p <= 61) mainHtml = '<span class="title-plain">😐 平凡人</span>';
            else if (p <= 65) mainHtml = '<span class="title-unlucky">🌧️ 小不幸運</span>';
            else mainHtml = '<span class="title-bad">🌩️ 小倒霉鬼</span>';
        }

        // 將百分比文字以 block 形式與小字體附加於下方，維持與鑽石數大小一致 (11px)
        const percentHtml = percentText ? `<span style="display:block; font-size:11px; color:var(--text-sub); font-weight:normal; margin-top:3px;">${percentText}</span>` : '';
        
        return mainHtml + percentHtml;
    }

    // 填充單一卡片的 Helper
    function populateCard(prefix, pulls, targetCount, total5Count, avg, luckHtml, showDiamonds) {
        document.getElementById(`stat${prefix}Pulls`).innerText = pulls;
        const diaEl = document.getElementById(`stat${prefix}Diamonds`);
        if (showDiamonds && diaEl) {
            diaEl.innerText = `(${(pulls * 150).toLocaleString()} 鑽)`;
            diaEl.style.visibility = 'visible';
        } else if (diaEl) {
            diaEl.style.visibility = 'hidden';
        }
        document.getElementById(`stat${prefix}Luck`).innerHTML = luckHtml;

        if (prefix === 'Std') {
            document.getElementById(`stat${prefix}Count`).innerText = total5Count;
            document.getElementById(`stat${prefix}Avg`).innerText = avg > 0 ? avg.toFixed(1) : '0.0';
        } else {
            document.getElementById(`stat${prefix}Count`).innerText = `${targetCount}/${total5Count}`;
            document.getElementById(`stat${prefix}Avg`).innerText = avg > 0 ? avg.toFixed(1) : '0.0';
        }
    }

    // 1. 限定池
    const dbLim = db.filter(r => r.main === '限定');
    const limPulls = dbLim.reduce((sum, r) => sum + r.pulls, 0);
    const limTargets = dbLim.filter(r => r.res === 'target');
    const limAvg = limTargets.length > 0 ? limTargets.reduce((s, r) => s + r.total, 0) / limTargets.length : 0;
    populateCard('Lim', limPulls, limTargets.length, dbLim.length, limAvg, getLuckHtml(limAvg, true), true);

    // 2. 常駐池
    const dbStd = db.filter(r => r.main === '常駐');
    const stdPulls = dbStd.reduce((sum, r) => sum + r.pulls, 0);
    const stdAvg = dbStd.length > 0 ? dbStd.reduce((s, r) => s + r.total, 0) / dbStd.length : 0;
    populateCard('Std', stdPulls, 0, dbStd.length, stdAvg, getLuckHtml(stdAvg, false), false);

    // 3. 復刻池
    const dbRe = db.filter(r => r.main === '復刻');
    const rePulls = dbRe.reduce((sum, r) => sum + r.pulls, 0);
    const reTargets = dbRe.filter(r => r.res === 'target');
    const reAvg = reTargets.length > 0 ? reTargets.reduce((s, r) => s + r.total, 0) / reTargets.length : 0;
    populateCard('Re', rePulls, reTargets.length, dbRe.length, reAvg, getLuckHtml(reAvg, true), true);

    // 4. 自訂副池 (根據下拉選單即時篩選)
    const subType = document.getElementById('statSubPoolSelect').value;
    const dbSub = db.filter(r => r.sub === subType && (r.main === '限定' || r.main === '復刻'));
    const subPulls = dbSub.reduce((sum, r) => sum + r.pulls, 0);
    const subTargets = dbSub.filter(r => r.res === 'target');
    const subAvg = subTargets.length > 0 ? subTargets.reduce((s, r) => s + r.total, 0) / subTargets.length : 0;
    populateCard('Sub', subPulls, subTargets.length, dbSub.length, subAvg, getLuckHtml(subAvg, true), true);
}

// ── 工具函式 ───────────────────────────────────────────────
function getEventDate(eventName, mainPool) {
    if (mainPool === '常駐') return 0;
    const target = findEvent(eventName, mainPool);
    return target ? parseEventTime(target) : 0;
}

// ── 一次性資料遷移 ─────────────────────────────────────────
function migrateDB() {
    const db = getDB();
    let changed = false;
    db.forEach(r => {
        if (r.res === 'oshi_spook') { r.res = 'wai_std'; changed = true; }
    });
    if (changed) setDB(db);
}

// ── 主渲染函式 ─────────────────────────────────────────────
function renderUI() {
    document.getElementById('pLim').innerText = 140 - getP('lim');
    document.getElementById('pRe').innerText  = 140 - getP('re');
    document.getElementById('pStd').innerText = 70 - getP('std');

    const db    = getDB();
    const oshis = JSON.parse(localStorage.getItem('oshis')) || [];

    let dbChanged = false;
    db.forEach(r => {
        if (r.card && r.card !== '未知' && r.main !== '常駐') {
            const trueLead = findTrueLead(r.card);
            if (trueLead) {
                if (r.lead !== trueLead) { r.lead = trueLead; dbChanged = true; }
                const event    = findEvent(r.banner, r.main);
                const isUpCard = event?.cards[trueLead]?.includes(r.card);
                const newRes   = isUpCard
                    ? (r.sub === '混池' && oshis.length > 0 && !oshis.includes(trueLead) ? 'wai_lim' : 'target')
                    : 'wai_std';
                if (r.res !== newRes) { r.res = newRes; dbChanged = true; }
            }
        }
        const evTime   = getEventDate(r.banner, r.main);
        r._evTime      = evTime;
        r._sortTime    = evTime || r.id;
        r._entryOrder  = r.id;
        
        if (r.res === 'target') r.luck = judgeT(r.total);
        else if (r.main === '常駐') r.luck = judgeS(r.total);
        else r.luck = judgeS(r.pulls);
    });

    if (dbChanged) setDB(db);

    db.sort((a, b) => b._sortTime - a._sortTime || b._entryOrder - a._entryOrder);

    updateLuckStats(db);

    // ── 巔峰榜 ──
    let peakHTML = '';
    if (db.length > 0) {
        const targets = db.filter(r => r.res === 'target');
        if (targets.length > 0) {
            const best = [...targets].sort((a, b) => b.luck.s - a.luck.s || a.total - b.total)[0];
            peakHTML += `<div class="peak-item"><span class="peak-label-best">🏆 巔峰紀錄:</span> <span>${best.lead ? (oshis.includes(best.lead) ? '💖' : '') + (leadIcons[best.lead] || '') + best.lead : ''} ${best.banner} (${best.total}抽)</span></div>`;
        }
        const waiR = db.filter(r => ['wai_std', 'wai_lim', 'wai'].includes(r.res));
        if (waiR.length > 0) {
            const counts = {};
            waiR.forEach(r => counts[r.lead] = (counts[r.lead] || 0) + 1);
            let maxC = 0, maxL = [];
            for (const l in counts) {
                if (counts[l] > maxC) { maxC = counts[l]; maxL = [l]; }
                else if (counts[l] === maxC) maxL.push(l);
            }
            peakHTML += `<div class="peak-item" style="margin-top:4px;"><span class="peak-label-spook">💔 歪卡常客:</span> <span>${maxL.map(l => (leadIcons[l] || '') + l).join('、')} (${maxC}次)</span></div>`;
        }
    }
    document.getElementById('peakBoard').innerHTML =
        peakHTML || '<div style="text-align:center;font-size:12px;color:var(--text-sub)">尚無資料</div>';

    // ── 紀錄列表 ──
    const filterSelect = document.getElementById('recordFilterSelect');
    const filterVal    = filterSelect ? filterSelect.value : '全部';
    const displayDb    = filterVal !== '全部' ? db.filter(r => r.main === filterVal) : db;

    document.getElementById('recordList').innerHTML = displayDb.map(r => {
        let cardTypeStr, statusColor;
        if      (r.main === '常駐')   { cardTypeStr = '🎫 常駐'; statusColor = '#3b82f6'; }
        else if (r.res === 'target')  { cardTypeStr = '🎯 限定'; statusColor = 'var(--primary)'; }
        else if (r.res === 'wai_lim') { cardTypeStr = '💔 限定'; statusColor = '#ef4444'; }
        else                          { cardTypeStr = '☠️ 歪卡'; statusColor = '#475569'; }

        const d       = new Date(r._evTime || r.id);
        const dateStr = r._evTime && r.main !== '常駐'
            ? `[${d.getFullYear().toString().slice(2)}/${(d.getMonth() + 1).toString().padStart(2, '0')}]`
            : '[無期效]';
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

// ── 啟動 ───────────────────────────────────────────────────
migrateDB();
initTheme();
loadOshis();
updateBannerRecommendations();
renderUI();
