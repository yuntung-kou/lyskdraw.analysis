// ════════════════════════════════════════════════════════════
//  storage.js — LocalStorage 存取、全域常數與資料遷移
// ════════════════════════════════════════════════════════════

const leadIcons = { '祁煜': '🐟', '沈星回': '🌟', '黎深': '🍐', '秦徹': '🚘', '夏以晝': '🍎' };

window.currentPendingPulls = 0;

// ── DB CRUD ───────────────────────────────────────────────
const getDB = () => JSON.parse(localStorage.getItem('db_v4')) || [];

const setDB = (db) => {
    const toSave = db.map(({ _evTime, _sortTime, _entryOrder, luck, ...rest }) => rest);
    localStorage.setItem('db_v4', JSON.stringify(toSave));
};

// ── 墊抽數存取 ─────────────────────────────────────────────
const getP  = (type) => parseInt(localStorage.getItem('p_' + type)) || 0;
const _setP = (type, v) => localStorage.setItem('p_' + type, v);
const setP  = (type, v) => { _setP(type, v); renderUI(); };

// ── 一次性資料遷移 ─────────────────────────────────────────
function migrateDB() {
    const db = getDB();
    let changed = false;
    db.forEach(r => {
        if (r.res === 'oshi_spook') { r.res = 'wai_std'; changed = true; }
    });
    if (changed) setDB(db);
}
