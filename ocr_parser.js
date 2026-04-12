// ═══════════════════════════════════════════════════════════
//  ocr_parser.js — 光學辨識與分析引擎 (關注點分離版)
// ═══════════════════════════════════════════════════════════

async function handleOCR(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const statusEl = document.getElementById('ocrStatus');
    statusEl.innerText = `⏳ 辨識中... (0/${files.length})`;
    statusEl.style.color = '#c084fc';

    try {
        let pages = []; let warnings = [];
        for (let i = 0; i < files.length; i++) {
            statusEl.innerText = `⏳ 辨識中... (${i + 1}/${files.length})`;
            const records = await extractRecordsFromImage(files[i]);
            if (records.length < 14) warnings.push(`第 ${i + 1} 張讀取到 ${records.length} 筆`);
            if (records.length > 0) pages.push(records);
        }
        if (pages.length === 0) { statusEl.innerText = '⚠️ 未能辨識，請確認截圖清晰'; statusEl.style.color = '#facc15'; return; }

        pages.sort((a, b) => (b[0].time || 0) - (a[0].time || 0));
        const allRecords = pages.flat();
        const result = countPulls(allRecords);

        if (result.pullEvents.length > 0) {
            const firstGold = result.pullEvents[result.pullEvents.length - 1];
            
            // 🌟 將整理好的純資料拋給 app.js 進行 UI 更新
            if (typeof window.autoFillFromOCR === 'function') {
                window.autoFillFromOCR(firstGold.pulls, firstGold.name);
            }

            // 僅處理辨識狀態的文字反饋
            let resText = `✅ 辨識完成！\n\n`;
            [...result.pullEvents].reverse().forEach(evt => { resText += `${evt.name}：${evt.pulls} 抽\n`; });
            if (warnings.length > 0) resText += `\n(⚠️ ${warnings.join('；')})`;
            statusEl.innerText = resText; statusEl.style.color = '#4ade80';
        } else {
            statusEl.innerText = `⚠️ 只找到 ${result.fiveStarCount} 個5星 (需至少2個才能計算)`;
            statusEl.style.color = '#facc15';
        }
    } catch (err) { statusEl.innerText = '❌ 失敗：' + (err.message || '未知'); statusEl.style.color = '#ef4444'; }
}

async function extractRecordsFromImage(file) {
    const colorCanvas = await fileToCanvas(file);
    const { width, height } = colorCanvas;
    const cropTop = Math.floor(height * 0.15);
    const ocrCanvas = document.createElement('canvas');
    ocrCanvas.width = width; ocrCanvas.height = height - cropTop;
    const ctx = ocrCanvas.getContext('2d');
    ctx.filter = 'grayscale(100%) invert(100%) contrast(180%) brightness(110%)';
    ctx.drawImage(colorCanvas, 0, -cropTop);
    const result = await Tesseract.recognize(ocrCanvas, 'chi_tra+eng');
    return parseOCRLines(result.data.lines, colorCanvas, cropTop);
}

function detectStarFromColor(colorCanvas, bbox, cropTop) {
    const y0 = Math.max(0, bbox.y0 + cropTop);
    const h = bbox.y1 - bbox.y0;
    if (h <= 0) return null;
    const ctx = colorCanvas.getContext('2d');
    const data = ctx.getImageData(0, y0, colorCanvas.width, h).data;
    let gCount = 0, pCount = 0;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        if (r > 140 && r > g && g > b && (r - b) > 35) gCount++;
        else if (b > r && b > g && (b - r) > 25 && b > 120) pCount++;
    }
    const gR = gCount / (data.length / 4), pR = pCount / (data.length / 4);
    if (gR > 0.005) return 5; if (pR > 0.005) return 4; return 3;
}

function parseOCRLines(lines, colorCanvas, cropTop) {
    const records = [];
    let known = [];
    if (typeof standardCards !== 'undefined') known.push(...Object.values(standardCards).flat());
    if (typeof eventCards !== 'undefined') eventCards.forEach(e => known.push(...Object.values(e.cards).flat()));
    known = [...new Set(known)];
    let lastTime = Date.now();

    for (const line of lines) {
        const rawText = line.text.trim();
        if (rawText.length < 5 || /DEEPSPACE|LIMITED|掉落|預覽|許願|記錄|伺服器|延遲|類型|名稱|時間|沒有資料|稍後|再來|UID|uid/.test(rawText)) continue;
        if (!(rawText.match(/\d/g) || []).length >= 4) continue;

        const textNoSpace = rawText.replace(/\s+/g, '');
        const cleanText = textNoSpace.replace(/[345]星/g, '').replace(/\[Mini\]/ig, '');
        const star = detectStarFromColor(colorCanvas, line.bbox, cropTop) || (/(5|S|s|五|§)[星生皇里室量]/.test(textNoSpace) ? 5 : (/(4|A|a|四)[星生皇里室量]/.test(textNoSpace) ? 4 : 3));

        let cardName = '未知';
        for (const k of known) { if (cleanText.includes(k.replace(/\s+/g, ''))) { cardName = k; break; } }
        if (cardName === '未知') {
            let maxS = 0; const vars = { '溫': '温', '繾': '缱', '綣': '绻', '晝': '昼', '跡': '迹', '戀': '恋' };
            for (const k of known) {
                const kChars = k.replace(/\s+/g, '').split('');
                let s = 0; kChars.forEach(c => { if (cleanText.includes(c) || (vars[c] && cleanText.includes(vars[c]))) s++; });
                if (s / kChars.length >= 0.5 && s > maxS) { maxS = s; cardName = k; }
            }
        }
        if (cardName === '未知') {
            const m = cleanText.match(/[\u4e00-\u9fa5]{2,}/g);
            if (m) {
                const f = m.map(s => s.replace(/祁煜|沈星回|黎深|秦徹|夏以晝/g, '')).filter(s => s.length >= 2 && !/^[星類型名稱時間掉落預覽]+$/.test(s));
                if (f.length > 0) cardName = f.reduce((a, b) => a.length >= b.length ? a : b);
            }
            const foundLead = ['祁煜', '沈星回', '黎深', '秦徹', '夏以晝'].find(l => cleanText.includes(l));
            if (cardName === '未知' && foundLead && star === 5) cardName = `${foundLead} (未知卡名)`;
        }

        const tM = rawText.match(/202\d[-/.]\d{1,2}[-/.]\d{1,2}\s+\d{1,2}[:;.]\d{1,2}[:;.]\d{1,2}/);
        let time = lastTime;
        if (tM) { const parsed = new Date(tM[0].replace(/[-/.]/g, '-').replace(/[:;.]/g, ':').replace(/\s+/, 'T')).getTime(); if (!isNaN(parsed)) { time = parsed; lastTime = parsed; } }
        records.push({ star, time, name: cardName });
    }
    return records;
}

function fileToCanvas(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); resolve(c); };
        img.onerror = () => reject(new Error('失敗'));
        img.src = URL.createObjectURL(file);
    });
}

function countPulls(records) {
    const pos = records.map((r, i) => ({ ...r, i })).filter(r => r.star === 5);
    if (pos.length < 2) return { pullEvents: [], fiveStarCount: pos.length };
    return { pullEvents: pos.slice(0, -1).map((c, i) => ({ name: c.name, pulls: pos[i+1].i - c.i })), fiveStarCount: pos.length };
}
