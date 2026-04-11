const leadIcons = { '祁煜': '🐟', '沈星回': '🌟', '黎深': '🍐', '秦徹': '🚘', '夏以晝': '🍎' };

let dropdownData = { bannerName: [], upCardName: [], cardName: [] };

// ── localStorage helpers ──────────────────────────────────────
const getDB = () => JSON.parse(localStorage.getItem('db_v4')) || [];
const setDB = db => localStorage.setItem('db_v4', JSON.stringify(db));
const getP  = type => parseInt(localStorage.getItem('p_' + type)) || 0;
const setP  = (type, v) => { localStorage.setItem('p_' + type, v); renderUI(); };

// ── 深淺色主題 (支援跟隨系統預設) ──────────────────────────────
function initTheme() {
    let saved = localStorage.getItem('theme');
    
    // 如果沒有手動設定過，則讀取系統預設設定
    if (!saved) {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        saved = prefersDark ? 'dark' : 'light';
    }
    
    document.documentElement.dataset.theme = saved;
    document.getElementById('themeBtn').textContent = saved === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    document.getElementById('themeBtn').textContent = next === 'dark' ? '☀️' : '🌙';
}

// ── 下拉選單 ──────────────────────────────────────────────────
function renderDropdown(inputId) {
    const wrapper = document.getElementById(inputId + 'ListWrapper');
    const input   = document.getElementById(inputId);
    const val     = input.value.toLowerCase();
    wrapper.innerHTML = '';
    let count = 0;
    for (const item of dropdownData[inputId]) {
        if (!item.toLowerCase().includes(val)) continue;
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
    }
    wrapper.style.display = count > 0 ? 'block' : 'none';
}

function filterDropdown(inputId) { renderDropdown(inputId); }
const showDropdown = filterDropdown;

function hideDropdownDelayed(inputId) {
    setTimeout(() => {
        const wrapper = document.getElementById(inputId + 'ListWrapper');
        if (wrapper) wrapper.style.display = 'none';
    }, 150);
}

// ── 主推設定 ──────────────────────────────────────────────────
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
        ? `💖 主推守護中：${oshis.map(n => leadIcons[n] || '').join('')}`
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
    document.querySelectorAll('input[name="oshi"]').forEach(cb => cb.checked = oshis.includes(cb.value));
    updateOshiSummary();
}

// ── 卡池資料 ──────────────────────────────────────────────────
function parseEventTime(e) {
    try {
        const [m, d] = e.duration.split('-')[0].split('.');
        if (!m || !d) return 0;
        return new Date(`${e.year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T00:00:00`).getTime();
    } catch { return 0; }
}

function initEventData() {
    if (typeof eventCards === 'undefined') return;

    const cardsWithTime = eventCards.flatMap(e => {
        const t = parseEventTime(e);
        return Object.values(e.cards).flat().map(c => ({ name: c, time: t }));
    });
    cardsWithTime.sort((a, b) => b.time - a.time);
    dropdownData.upCardName = [...new Set(cardsWithTime.map(c => c.name))];

    onPoolChange();
}

function updateBannerRecommendations() {
    if (typeof eventCards === 'undefined') return;
    const mainPool = document.querySelector('input[name="mainPool"]:checked').value;
    const subPool  = document.querySelector('input[name="subPool"]:checked').value;

    const filtered = eventCards
        .filter(e => {
            const isRerun = e.poolType.includes('復刻');
            if (mainPool === '限定' && isRerun) return false;
            if (mainPool === '復刻' && !isRerun) return false;
            if (subPool === '混池') return e.poolType.includes('混池');
            if (subPool === '日卡') return e.poolType.includes('日卡');
            return e.poolType.includes('單人') || e.poolType.includes('生日') || e.poolType.includes('免五') || e.poolType === '復刻';
        })
        .sort((a, b) => parseEventTime(b) - parseEventTime(a));

    dropdownData.bannerName = [...new Set(filtered.map(f => f.eventName))];
}

function onPoolChange() {
    updateBannerRecommendations();
    updatePulledCardList();
}

window.autoFillFromUpCard = function () {
    const upCardName = document.getElementById('upCardName').value;
    if (!upCardName || typeof eventCards === 'undefined') return;
    const currentMainPool = document.querySelector('input[name="mainPool"]:checked').value;
    const matchingEvents  = eventCards.filter(e => Object.values(e.cards).some(cards => cards.includes(upCardName)));
    if (!matchingEvents.length) return;
    const bestEvent = matchingEvents.find(e =>
        currentMainPool === '復刻' ? e.poolType.includes('復刻') : !e.poolType.includes('復刻')
    ) || matchingEvents[0];
    document.getElementById('bannerName').value = bestEvent.eventName;
    window.autoFillBannerInfo(bestEvent);
};

window.autoFillBannerInfo = function (forcedEvent = null) {
    if (typeof eventCards === 'undefined') return;
    let event = forcedEvent;
    if (!event) {
        const bannerName     = document.getElementById('bannerName').value;
        const currentMainPool = document.querySelector('input[name="mainPool"]:checked').value;
        const matches = eventCards.filter(e => e.eventName === bannerName);
        event = matches.find(e =>
            currentMainPool === '復刻' ? e.poolType.includes('復刻') : !e.poolType.includes('復刻')
        ) || matches[0];
    }
    if (!event) return;

    document.querySelector(`input[name="mainPool"][value="${event.poolType.includes('復刻') ? '復刻' : '限定'}"]`).checked = true;
    if (event.poolType.includes('混池'))     document.querySelector('input[name="subPool"][value="混池"]').checked = true;
    else if (event.poolType.includes('日卡')) document.querySelector('input[name="subPool"][value="日卡"]').checked = true;
    else                                      document.querySelector('input[name="subPool"][value="單人"]').checked = true;

    const upInput   = document.getElementById('upCardName');
    const validCards = Object.values(event.cards).flat();
    if (!validCards.includes(upInput.value)) upInput.value = validCards[0] || '';

    onPoolChange();
};

window.updatePulledCardList = function () {
    const bannerName = document.getElementById('bannerName').value;
    const pulledLead = document.querySelector('input[name="pulledLead"]:checked').value;
    let options = [];
    if (bannerName && typeof eventCards !== 'undefined') {
        const event = eventCards.find(e => e.eventName === bannerName);
        if (event?.cards?.[pulledLead]) options.push(...event.cards[pulledLead]);
    }
    if (typeof standardCards !== 'undefined' && standardCards[pulledLead]) options.push(...standardCards[pulledLead]);
    dropdownData.cardName = [...new Set(options)];
};

function getEventDate(eventName, mainPool) {
    if (typeof eventCards === 'undefined') return 0;
    const matches = eventCards.filter(e => e.eventName === eventName);
    if (!matches.length) return 0;
    const target = matches.length > 1
        ? (mainPool === '復刻'
            ? matches.find(e => e.poolType.includes('復刻')) || matches.at(-1)
            : matches.find(e => !e.poolType.includes('復刻')) || matches[0])
        : matches[0];
    return parseEventTime(target);
}

// ── 幸運判定 ──────────────────────────────────────────────────
const judgeS = p => {
    if (p <=  7) return { t: '天選之子 ✨', c: '#16a34a', s:  2 };
    if (p <= 24) return { t: '幸運兒 🌟',   c: '#4ade80', s:  1 };
    if (p <= 35) return { t: '平凡人 😐',   c: '#facc15', s:  0 };
    if (p <= 45) return { t: '小不幸運 🌧️', c: '#fb923c', s: -1 };
    return             { t: '小倒霉鬼 🌩️', c: '#dc2626', s: -2 };
};

const judgeT = p => {
    if (p <=  26) return { t: '天選之子 ✨', c: '#16a34a', s:  2 };
    if (p <=  65) return { t: '幸運兒 🌟',   c: '#4ade80', s:  1 };
    if (p <=  85) return { t: '平凡人 😐',   c: '#facc15', s:  0 };
    if (p <= 110) return { t: '小不幸運 🌧️', c: '#fb923c', s: -1 };
    return              { t: '小倒霉鬼 🌩️', c: '#dc2626', s: -2 };
};

// ── 墊池 ──────────────────────────────────────────────────────
function editPending(type) {
    const v = prompt('手動修改墊池進度：', getP(type));
    if (v !== null && !isNaN(parseInt(v))) setP(type, parseInt(v));
}

// ── 新增 / 刪除紀錄 ──────────────────────────────────────────
function addRecord() {
    const banner    = document.getElementById('bannerName').value.trim();
    const main      = document.querySelector('input[name="mainPool"]:checked').value;
    const sub       = document.querySelector('input[name="subPool"]:checked').value;
    const pulledLead = document.querySelector('input[name="pulledLead"]:checked').value;
    const card      = document.getElementById('cardName').value.trim();
    const pulls     = parseInt(document.getElementById('pulls').value);

    if (!banner) return alert('請輸入卡池名稱！');
    if (isNaN(pulls) || pulls < 1 || pulls > 70) return alert('請輸入 1-70 抽！');

    const oshis    = JSON.parse(localStorage.getItem('oshis')) || [];
    const event    = typeof eventCards !== 'undefined' ? eventCards.find(e => e.eventName === banner) : null;
    const poolKey  = main === '限定' ? 'lim' : 're';
    const currentP = getP(poolKey);

    let judgeResult = 'wai';
    if (event?.cards?.[pulledLead] && (!card || event.cards[pulledLead].includes(card))) judgeResult = 'target';
    else if (oshis.includes(pulledLead)) judgeResult = 'oshi_spook';

    const rec = { id: Date.now(), main, sub, lead: pulledLead, banner, card, pulls, res: judgeResult };
    if (judgeResult === 'target') {
        rec.total = currentP + pulls;
        rec.luck  = judgeT(rec.total);
        setP(poolKey, 0);
    } else {
        rec.total = pulls;
        rec.luck  = judgeS(pulls);
        setP(poolKey, currentP + pulls);
    }

    const db = getDB();
    db.push(rec);
    setDB(db);

    document.getElementById('cardName').value = '';
    document.getElementById('pulls').value    = '';
    document.getElementById('ocrInput').value = '';
    document.getElementById('ocrStatus').innerText   = '請上傳抽卡紀錄';
    document.getElementById('ocrStatus').style.color = 'var(--text-sub)';

    renderUI();
}

function deleteRec(id) {
    if (!confirm('確定刪除此筆紀錄？')) return;
    setDB(getDB().filter(r => r.id !== id));
    renderUI();
}

// ── 渲染 UI ───────────────────────────────────────────────────
function renderUI() {
    document.getElementById('pLim').innerText = getP('lim');
    document.getElementById('pRe').innerText  = getP('re');

    const db    = getDB();
    const oshis = JSON.parse(localStorage.getItem('oshis')) || [];

    db.forEach(r => {
        r._sortTime   = getEventDate(r.banner, r.main) || r.id;
        r._entryOrder = r.id;
    });
    db.sort((a, b) => b._sortTime - a._sortTime || b._entryOrder - a._entryOrder);

    const calcOverall = filter => {
        const items = db.filter(r => r.main === filter && r.res === 'target');
        if (!items.length) return '---';
        const avg = items.reduce((a, b) => a + b.luck.s, 0) / items.length;
        if (avg >= 1.5)  return '<span class="title-god">✨ 天選之子</span>';
        if (avg >= 0.5)  return '<span class="title-lucky">🌟 幸運兒</span>';
        if (avg >= -0.5) return '<span class="title-plain">😐 平凡人</span>';
        if (avg >= -1.5) return '<span class="title-unlucky">🌧️ 小不幸運</span>';
        return '<span class="title-bad">🌩️ 小倒霉鬼</span>';
    };
    document.getElementById('luckLim').innerHTML = `<h5>限定池體質</h5>${calcOverall('限定')}`;
    document.getElementById('luckRe').innerHTML  = `<h5>復刻池體質</h5>${calcOverall('復刻')}`;

    let peakHTML = '';
    if (db.length > 0) {
        const targets = db.filter(r => r.res === 'target');
        if (targets.length > 0) {
            const best = [...targets].sort((a, b) => b.luck.s - a.luck.s || a.total - b.total)[0];
            const bestLeadStr = best.lead ? `${oshis.includes(best.lead) ? '💖' : ''}${leadIcons[best.lead] || ''}${best.lead}` : '';
            peakHTML += `<div class="peak-item"><span class="peak-label-best">🏆 巔峰紀錄:</span> <span>${bestLeadStr} ${best.banner} (${best.total}抽)</span></div>`;
        }
        const waiRecords = db.filter(r => r.res === 'wai');
        if (waiRecords.length > 0) {
            const counts = {};
            waiRecords.forEach(r => counts[r.lead] = (counts[r.lead] || 0) + 1);
            const maxCount = Math.max(...Object.values(counts));
            const maxLeads = Object.keys(counts).filter(l => counts[l] === maxCount);
            peakHTML += `<div class="peak-item" style="margin-top:4px;"><span class="peak-label-spook">💔 歪卡常客:</span> <span>${maxLeads.map(l => `${leadIcons[l]||''}${l}`).join('、')} (${maxCount}次)</span></div>`;
        }
        document.getElementById('peakBoard').innerHTML = peakHTML || '<div style="text-align:center;font-size:12px;color:#94a3b8">尚無目標數據</div>';
    } else {
        document.getElementById('peakBoard').innerHTML = '<div style="text-align:center;font-size:12px;color:#94a3b8">尚無資料</div>';
    }

    document.getElementById('recordList').innerHTML = db.map(r => {
        let cardTypeStr, statusColor;
        if (r.res === 'target') {
            cardTypeStr = '🎯 限定 UP';
            statusColor = 'var(--primary)';
        } else {
            const isStandard = typeof standardCards !== 'undefined' && standardCards[r.lead]?.includes(r.card);
            if (isStandard) {
                cardTypeStr = '💔 歪常駐'; statusColor = '#475569';
            } else if (r.sub === '混池') {
                cardTypeStr = '💔 歪其他限定'; statusColor = '#ef4444';
            } else {
                cardTypeStr = '💔 歪卡'; statusColor = '#ef4444';
            }
            if (r.res === 'oshi_spook') {
                cardTypeStr = '💖 防歪主推 (' + cardTypeStr.replace('💔 ', '') + ')';
                statusColor = 'var(--oshi-color)';
            }
        }

        const d       = new Date(r._sortTime);
        const dateStr = r._sortTime !== r.id
            ? `[${d.getFullYear().toString().slice(2)}/${(d.getMonth()+1).toString().padStart(2,'0')}]`
            : '[未知]';
        const barWidth = Math.min((r.pulls / 70) * 100, 100);

        // 修改：使用 CSS 變數 var(--text-main) 取代寫死的 color:white;
        return `
        <div class="h-record-card">
            <div class="h-bar-bg" style="width:${barWidth}%; background-color:${r.luck.c};"></div>
            <div class="h-content">
                <div class="h-left">
                    <div class="h-tags">
                        ${r.main === '復刻' ? '<span class="tag tag-re">復刻</span>' : ''}
                        <span class="tag tag-lim">${r.sub}</span>
                        <span class="tag" style="background-color:${statusColor};">${cardTypeStr}</span>
                    </div>
                    <span class="h-title">
                        <span style="font-size:15px; font-weight:bold; color:var(--text-main);">${r.card || '未知'}</span>
                        <span style="font-size:12px; color:var(--text-main); font-weight:normal;"> | ${r.banner}</span>
                        <span class="h-date">${dateStr}</span>
                    </span>
                </div>
                <div class="h-right">
                    <div class="h-pulls"><span class="pull-num">${r.pulls}</span> 抽</div>
                    <div class="h-luck">${r.luck.t}</div>
                    <button class="del-btn-icon" onclick="deleteRec(${r.id})" title="刪除紀錄">🗑️</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function clearAll() {
    if (!confirm('確定清空所有資料？此操作無法復原。')) return;
    localStorage.removeItem('db_v4');
    localStorage.removeItem('p_lim');
    localStorage.removeItem('p_re');
    renderUI();
}

// ── 初始化 ────────────────────────────────────────────────────
initTheme();
loadOshis();
initEventData();
renderUI();
