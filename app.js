// ════════════════════════════════════════════════════════════
//  app.js — 戀與深空抽卡分析器 主邏輯
//
//  依賴（需在 index.html 中 app.js 之前載入）：
//    - love_and_deepspace_events.js   → eventCards 陣列
//    - love_and_deepspace_standard.js → standardCards 物件
//    - ocr_parser.js                  → handleOCR()
// ════════════════════════════════════════════════════════════


// ────────────────────────────────────────────────────────────
//  § 常數與資料工具
// ────────────────────────────────────────────────────────────

// 各攻略角色對應的 emoji 圖示
const leadIcons = {
    '祁煜': '🐟',
    '沈星回': '🌟',
    '黎深': '🍐',
    '秦徹': '🚘',
    '夏以晝': '🍎'
};

const getDB  = () => JSON.parse(localStorage.getItem('db_v4')) || [];
const setDB  = (db) => localStorage.setItem('db_v4', JSON.stringify(db));
const getP   = (type) => parseInt(localStorage.getItem('p_' + type)) || 0;
const setP   = (type, v) => { localStorage.setItem('p_' + type, v); renderUI(); };


// ────────────────────────────────────────────────────────────
//  § 深淺色主題
// ────────────────────────────────────────────────────────────

function initTheme() {
    let saved = localStorage.getItem('theme');
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


// ────────────────────────────────────────────────────────────
//  § 主推（Oshi）管理
// ────────────────────────────────────────────────────────────

function toggleOshiEdit() {
    const group = document.getElementById('oshiGroup');
    const btn   = document.getElementById('oshiToggleBtn');
    const isHidden = group.style.display === 'none';
    group.style.display = isHidden ? 'flex' : 'none';
    btn.innerText = isHidden ? '[收起]' : '[設定]';
}

function updateOshiSummary() {
    const oshis   = JSON.parse(localStorage.getItem('oshis')) || [];
    const summary = document.getElementById('oshiSummary');
    if (oshis.length > 0) {
        const icons = oshis.map(name => leadIcons[name] || '').join('');
        summary.innerHTML = `💖 主推守護中：${icons}`;
    } else {
        summary.innerHTML = `💖 尚未設定主推`;
    }
}

function saveOshis() {
    const oshis = Array.from(document.querySelectorAll('input[name="oshi"]:checked')).map(cb => cb.value);
    localStorage.setItem('oshis', JSON.stringify(oshis));
    updateOshiSummary();
    renderUI();
}

function loadOshis() {
    const oshis = JSON.parse(localStorage.getItem('oshis')) || [];
    document.querySelectorAll('input[name="oshi"]').forEach(cb => {
        cb.checked = oshis.includes(cb.value);
    });
    updateOshiSummary();
}


// ────────────────────────────────────────────────────────────
//  § 卡池事件資料初始化
// ────────────────────────────────────────────────────────────

function parseEventTime(e) {
    try {
        const startStr = e.duration.split('-')[0];
        const [m, d] = startStr.split('.');
        if (!m || !d) return 0;
        return new Date(`${e.year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T00:00:00`).getTime();
    } catch (err) {
        return 0;
    }
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

    let filtered = [];
    eventCards.forEach(e => {
        const isRerun = e.poolType.includes('復刻');

        if (mainPool === '限定' && isRerun) return;
        if (mainPool === '復刻' && !isRerun) return;

        let matchSub = false;
        if (subPool === '混池' && e.poolType.includes('混池')) matchSub = true;
        if (subPool === '日卡' && e.poolType.includes('日卡')) matchSub = true;
        if (subPool === '單人' && (
            e.poolType.includes('單人') ||
            e.poolType.includes('生日') ||
            e.poolType.includes('免五') ||
            e.poolType === '復刻'
        )) matchSub = true;

        if (matchSub) filtered.push({ name: e.eventName, time: parseEventTime(e) });
    });

    filtered.sort((a, b) => b.time - a.time);
    dropdownData.bannerName = [...new Set(filtered.map(f => f.name))];
}

function onPoolChange() {
    updateBannerRecommendations();
    updatePulledCardList();
}


// ────────────────────────────────────────────────────────────
//  § 自動完成下拉選單
// ────────────────────────────────────────────────────────────

let dropdownData = {
    bannerName: [],
    upCardName: [],
    cardName:   []
};

function renderDropdown(inputId) {
    const wrapper = document.getElementById(inputId + 'ListWrapper');
    const input   = document.getElementById(inputId);
    const val     = input.value.toLowerCase();
    const list    = dropdownData[inputId];

    wrapper.innerHTML = '';
    let count = 0;

    for (const item of list) {
        if (!item.toLowerCase().includes(val)) continue;

        const div = document.createElement('div');
        div.className = 'autocomplete-item';
        div.innerText = item;
        div.onmousedown = function() {
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


// ────────────────────────────────────────────────────────────
//  § 自動填入（卡池資訊互查）
// ────────────────────────────────────────────────────────────

window.autoFillFromUpCard = function() {
    const upCardName = document.getElementById('upCardName').value;
    if (!upCardName || typeof eventCards === 'undefined') return;

    const currentMainPool = document.querySelector('input[name="mainPool"]:checked').value;

    const matchingEvents = eventCards.filter(e =>
        Object.values(e.cards).some(cards => cards.includes(upCardName))
    );

    if (matchingEvents.length > 0) {
        let bestEvent = matchingEvents.find(e =>
            (currentMainPool === '復刻' && e.poolType.includes('復刻')) ||
            (currentMainPool === '限定' && !e.poolType.includes('復刻'))
        );
        if (!bestEvent) bestEvent = matchingEvents[0];

        document.getElementById('bannerName').value = bestEvent.eventName;
        window.autoFillBannerInfo(bestEvent);
    }
};

window.autoFillBannerInfo = function(forcedEvent = null) {
    const bannerName = document.getElementById('bannerName').value;
    if (typeof eventCards === 'undefined') return;

    let event = forcedEvent;
    if (!event) {
        const currentMainPool = document.querySelector('input[name="mainPool"]:checked').value;
        const matches = eventCards.filter(e => e.eventName === bannerName);
        event = matches.find(e =>
            (currentMainPool === '復刻' && e.poolType.includes('復刻')) ||
            (currentMainPool === '限定' && !e.poolType.includes('復刻'))
        );
        if (!event) event = matches[0];
    }

    if (event) {
        const isRerun = event.poolType.includes('復刻');
        document.querySelector(`input[name="mainPool"][value="${isRerun ? '復刻' : '限定'}"]`).checked = true;

        if      (event.poolType.includes('混池')) document.querySelector('input[name="subPool"][value="混池"]').checked = true;
        else if (event.poolType.includes('日卡')) document.querySelector('input[name="subPool"][value="日卡"]').checked = true;
        else                                       document.querySelector('input[name="subPool"][value="單人"]').checked = true;

        const upInput  = document.getElementById('upCardName');
        const validCards = Object.values(event.cards).flat();
        if (!validCards.includes(upInput.value)) {
            upInput.value = validCards[0] || '';
        }
    }
    onPoolChange();
};

window.updatePulledCardList = function() {
    const bannerName = document.getElementById('bannerName').value;
    const pulledLead = document.querySelector('input[name="pulledLead"]:checked').value;

    let options = [];

    if (bannerName && typeof eventCards !== 'undefined') {
        const event = eventCards.find(e => e.eventName === bannerName);
        if (event && event.cards && event.cards[pulledLead]) {
            options.push(...event.cards[pulledLead]);
        }
    }

    if (typeof standardCards !== 'undefined' && standardCards[pulledLead]) {
        options.push(...standardCards[pulledLead]);
    }

    dropdownData.cardName = Array.from(new Set(options));
};


// ────────────────────────────────────────────────────────────
//  § 幸運判定
// ────────────────────────────────────────────────────────────

const judgeS = (p) => {
    if (p <=  7) return { t: '天選之子 ✨', c: '#16a34a', s:  2 };
    if (p <= 24) return { t: '幸運兒 🌟',   c: '#4ade80', s:  1 };
    if (p <= 35) return { t: '平凡人 😐',   c: '#facc15', s:  0 };
    if (p <= 45) return { t: '小不幸運 🌧️', c: '#fb923c', s: -1 };
    return             { t: '小倒霉鬼 🌩️', c: '#dc2626', s: -2 };
};

const judgeT = (p) => {
    if (p <=  26) return { t: '天選之子 ✨', c: '#16a34a', s:  2 };
    if (p <=  65) return { t: '幸運兒 🌟',   c: '#4ade80', s:  1 };
    if (p <=  85) return { t: '平凡人 😐',   c: '#facc15', s:  0 };
    if (p <= 110) return { t: '小不幸運 🌧️', c: '#fb923c', s: -1 };
    return              { t: '小倒霉鬼 🌩️', c: '#dc2626', s: -2 };
};


// ────────────────────────────────────────────────────────────
//  § 墊抽管理
// ────────────────────────────────────────────────────────────

function editPending(type) {
    const v = prompt('手動修改『已墊抽數』\n(請輸入您目前已經墊了幾抽，0~139)：', getP(type));
    if (v !== null && !isNaN(parseInt(v))) setP(type, parseInt(v));
}


// ────────────────────────────────────────────────────────────
//  § 紀錄 CRUD（新增 / 刪除 / 清空）
// ────────────────────────────────────────────────────────────

function addRecord() {
    const banner     = document.getElementById('bannerName').value.trim();
    const main       = document.querySelector('input[name="mainPool"]:checked').value;
    const sub        = document.querySelector('input[name="subPool"]:checked').value;
    const pulledLead = document.querySelector('input[name="pulledLead"]:checked').value;
    const card       = document.getElementById('cardName').value.trim();
    const pulls      = parseInt(document.getElementById('pulls').value);

    if (!banner)                            return alert('請輸入卡池名稱！');
    if (isNaN(pulls) || pulls < 1 || pulls > 70) return alert('請輸入 1-70 抽！');

    const oshis = JSON.parse(localStorage.getItem('oshis')) || [];
    const event = typeof eventCards !== 'undefined'
        ? eventCards.find(e => e.eventName === banner)
        : null;

    const isUpCard = event && event.cards[pulledLead] &&
                     (!card || event.cards[pulledLead].includes(card));

    let judgeResult;
    if (isUpCard) {
        const isOtherOshiInMixed = sub === '混池' && oshis.length > 0 && !oshis.includes(pulledLead);
        judgeResult = isOtherOshiInMixed ? 'wai_lim' : 'target';
    } else {
        if (oshis.includes(pulledLead)) {
            judgeResult = 'oshi_spook';
        } else {
            judgeResult = 'wai_std';
        }
    }

    const poolKey  = main === '限定' ? 'lim' : 're';
    const currentP = getP(poolKey);

    let rec = { id: Date.now(), main, sub, lead: pulledLead, banner, card, pulls, res: judgeResult };

    if (judgeResult === 'target') {
        rec.total = currentP + pulls;
        rec.luck  = judgeT(rec.total);
        setP(poolKey, 0);
    } else {
        rec.total = pulls;
        rec.luck  = judgeS(pulls);
        setP(poolKey, currentP + pulls);
    }

    let db = getDB();
    db.push(rec);
    setDB(db);

    document.getElementById('cardName').value = '';
    document.getElementById('pulls').value = '';
    document.getElementById('ocrInput').value = '';
    document.getElementById('ocrStatus').innerText = '請上傳抽卡紀錄';
    document.getElementById('ocrStatus').style.color = 'var(--text-sub)';

    renderUI();
}

function deleteRec(id) {
    if (!confirm('確定刪除此筆紀錄？')) return;
    let db = getDB();
    db = db.filter(r => r.id !== id);
    setDB(db);
    renderUI();
}

function clearAll() {
    if (!confirm('確定清空所有資料？此操作無法復原。')) return;
    localStorage.removeItem('db_v4');
    localStorage.removeItem('p_lim');
    localStorage.removeItem('p_re');
    renderUI();
}


// ────────────────────────────────────────────────────────────
//  § UI 渲染
// ────────────────────────────────────────────────────────────

function getEventDate(eventName, mainPool) {
    if (typeof eventCards === 'undefined') return 0;
    const matches = eventCards.filter(e => e.eventName === eventName);
    if (matches.length === 0) return 0;

    let target = matches[0];
    if (matches.length > 1) {
        target = mainPool === '復刻'
            ? matches.find(e => e.poolType.includes('復刻')) || matches[matches.length - 1]
            : matches.find(e => !e.poolType.includes('復刻')) || matches[0];
    }
    return parseEventTime(target);
}

window.updateLuckStats = function() {
    const db        = getDB();
    const mainFilter = document.getElementById('mainPoolLuckSelect').value;
    const subFilter  = document.getElementById('subPoolLuckSelect').value;

    const calcOverall = (items) => {
        if (!items.length) return '---';
        const avg = items.reduce((a, b) => a + b.luck.s, 0) / items.length;
        if (avg >= 1.5)  return '<span class="title-god">✨ 天選之子</span>';
        if (avg >= 0.5)  return '<span class="title-lucky">🌟 幸運兒</span>';
        if (avg >= -0.5) return '<span class="title-plain">😐 平凡人</span>';
        if (avg >= -1.5) return '<span class="title-unlucky">🌧️ 小不幸運</span>';
        return               '<span class="title-bad">🌩️ 小倒霉鬼</span>';
    };

    let mainItems = db.filter(r => r.res === 'target');
    if (mainFilter !== '綜合') mainItems = mainItems.filter(r => r.main === mainFilter);
    document.getElementById('luckMainVal').innerHTML = calcOverall(mainItems);

    const subItems = db.filter(r => r.res === 'target' && r.sub === subFilter);
    document.getElementById('luckSubVal').innerHTML = calcOverall(subItems);
};

function renderUI() {
    document.getElementById('pLim').innerText = 140 - getP('lim');
    document.getElementById('pRe').innerText  = 140 - getP('re');

    let db     = getDB();
    const oshis = JSON.parse(localStorage.getItem('oshis')) || [];

    db.forEach(r => {
        const evTime = getEventDate(r.banner, r.main);
        r._sortTime   = evTime ? evTime : r.id;     
        r._entryOrder = r.id;
    });
    db.sort((a, b) => b._sortTime - a._sortTime || b._entryOrder - a._entryOrder);

    updateLuckStats();

    let peakHTML = '';
    if (db.length > 0) {
        const targets = db.filter(r => r.res === 'target');
        if (targets.length > 0) {
            const best = [...targets].sort((a, b) => b.luck.s - a.luck.s || a.total - b.total)[0];
            const bestLeadStr = best.lead
                ? `${oshis.includes(best.lead) ? '💖' : ''}${leadIcons[best.lead] || ''}${best.lead}`
                : '';
            peakHTML += `<div class="peak-item"><span class="peak-label-best">🏆 巔峰紀錄:</span> <span>${bestLeadStr} ${best.banner} (${best.total}抽)</span></div>`;
        }

        const waiRecords = db.filter(r => ['wai_std','wai_lim','wai','oshi_spook'].includes(r.res));
        if (waiRecords.length > 0) {
            const counts = {};
            waiRecords.forEach(r => counts[r.lead] = (counts[r.lead] || 0) + 1);
            let maxCount = 0; let maxLeads = [];
            for (const lead in counts) {
                if (counts[lead] > maxCount)       { maxCount = counts[lead]; maxLeads = [lead]; }
                else if (counts[lead] === maxCount) { maxLeads.push(lead); }
            }
            const waiLeadStr = maxLeads.map(l => `${leadIcons[l] || ''}${l}`).join('、');
            peakHTML += `<div class="peak-item" style="margin-top:4px;"><span class="peak-label-spook">💔 歪卡常客:</span> <span>${waiLeadStr} (${maxCount}次)</span></div>`;
        }

        document.getElementById('peakBoard').innerHTML =
            peakHTML || '<div style="text-align:center;font-size:12px;color:var(--text-sub)">尚無目標數據</div>';
    } else {
        document.getElementById('peakBoard').innerHTML =
            `<div style="text-align:center;font-size:12px;color:var(--text-sub)">尚無資料</div>`;
    }

    document.getElementById('recordList').innerHTML = db.map(r => {

        let cardTypeStr, statusColor;
        if (r.res === 'target') {
            cardTypeStr = '🎯 限定'; statusColor = 'var(--primary)';
        } else if (r.res === 'wai_lim') {
            cardTypeStr = '💔 限定'; statusColor = '#ef4444';
        } else if (r.res === 'oshi_spook') {
            cardTypeStr = '💖 防歪主推'; statusColor = 'var(--oshi-color)';
        } else {
            let isUpCard = false;
            if (typeof eventCards !== 'undefined') {
                const ev = eventCards.find(e => e.eventName === r.banner);
                if (ev && ev.cards[r.lead] && (!r.card || ev.cards[r.lead].includes(r.card))) {
                    isUpCard = true;
                }
            }
            if (isUpCard) {
                cardTypeStr = '💔 限定'; statusColor = '#ef4444';
            } else {
                cardTypeStr = '☠️ 常駐'; statusColor = '#475569';
            }
        }

        const evTime = getEventDate(r.banner, r.main);
        const d = new Date(evTime || r.id);
        const dateStr = evTime ? `[${d.getFullYear().toString().slice(2)}/${(d.getMonth()+1).toString().padStart(2,'0')}]` : '[未知]';
        
        const barWidth = Math.min((r.pulls / 70) * 100, 100);

        // 💡 針對大於 55 抽的項目，給予 luck-high class
        const luckClass = r.pulls > 55 ? 'luck-high' : 'luck-low';
        
        // 💡 新增：判斷淺色模式下是否需要改為黑字
        let isBlackText = false;
        // 條件一：平凡人、小不幸運、小倒霉鬼 (s <= 0) 且 未達62抽 (< 62)
        if (r.luck.s <= 0 && r.pulls < 62) {
            isBlackText = true;
        } 
        // 條件二：幸運兒 (s === 1) 且 55~62抽 (>= 55 且 <= 62)
        else if (r.luck.s === 1 && r.pulls >= 55 && r.pulls <= 62) {
            isBlackText = true;
        }
        
        const fullLuckClass = `h-luck ${luckClass} ${isBlackText ? 'luck-black-light' : ''}`;
        
        // 確保給予行內白字樣式，若需黑字則透過 CSS 的 !important 覆蓋
        const luckInlineStyle = r.pulls <= 55 ? `background-color: ${r.luck.c}BF; color: #ffffff;` : '';

        return `
        <div class="h-record-card">
            <div class="h-bar-bg" style="width: ${barWidth}%; background-color: ${r.luck.c};"></div>
            <div class="h-content">
                <div class="h-left">
                    <div class="h-tags">
                        ${r.main === '復刻' ? '<span class="tag tag-re">復刻</span>' : ''}
                        <span class="tag tag-lim">${r.sub}</span>
                        <span class="tag" style="background-color: ${statusColor};">${cardTypeStr}</span>
                    </div>
                    <span class="h-title">
                        <span style="font-size: 15px; font-weight: bold; color: var(--text-main);">${r.card || '未知'}</span>
                        <span style="font-size: 12px; color: var(--text-main); font-weight: normal;"> | ${r.banner}</span>
                        <span class="h-date" style="font-size: 12px;">${dateStr}</span>
                    </span>
                </div>
                <div class="h-right">
                    <div class="h-pulls"><span class="pull-num">${r.pulls}</span> 抽</div>
                    <div class="${fullLuckClass}" style="${luckInlineStyle}">${r.luck.t}</div>
                    <button class="del-btn-icon" onclick="deleteRec(${r.id})" title="刪除紀錄">🗑️</button>
                </div>
            </div>
        </div>
        `;
    }).join('');
}


// ────────────────────────────────────────────────────────────
//  § 頁面啟動入口
// ────────────────────────────────────────────────────────────
initTheme();
loadOshis();
initEventData();
renderUI();
