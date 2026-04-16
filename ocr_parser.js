// ═══════════════════════════════════════════════════════════
//  ocr_parser.js — 分區濾鏡 + 智慧常駐池辨識 (v24 最終修復版)
// ═══════════════════════════════════════════════════════════

async function handleOCR(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const statusEl = document.getElementById('ocrStatus');
    statusEl.innerText = `⏳ 辨識中... (0/${files.length})`;
    statusEl.style.color = '#c084fc';

    try {
        let pages = []; let warnings = []; let isStandardGlobal = false;
        for (let i = 0; i < files.length; i++) {
            statusEl.innerText = `⏳ 辨識中... (${i + 1}/${files.length})`;
            const records = await extractRecordsFromImage(files[i]);
            
            if (records._isStandardPool) isStandardGlobal = true; 

            if (records.length < 5) warnings.push(`第 ${i + 1} 張僅讀取到 ${records.length} 筆`);
            if (records.length > 0) {
                const validTimeRecord = records.find(r => r._hasRealTime);
                records._pageTime = validTimeRecord ? validTimeRecord.time : 0;
                pages.push(records);
            }
        }
        if (pages.length === 0) { statusEl.innerText = '⚠️ 未能辨識，請確認截圖清晰'; statusEl.style.color = '#facc15'; return; }

        pages.sort((a, b) => b._pageTime - a._pageTime);
        const allRecords = pages.flat();
        const result = countPulls(allRecords);

        if (result.pullEvents.length > 0) {
            const targetGold = result.pullEvents[result.pullEvents.length - 1]; 
            const pendingPulls = result.pendingPulls;

            let finalRaw = targetGold.raw;
            if (isStandardGlobal) {
                finalRaw += " 極空迴音"; 
            }

            if (typeof window.autoFillFromOCR === 'function') {
                window.autoFillFromOCR(targetGold.pulls, targetGold.name, targetGold.time, pendingPulls, finalRaw);
            }

            let resText = `✅ 辨識完成！\n\n`;
            [...result.pullEvents].reverse().forEach(evt => { resText += `${evt.name}：${evt.pulls} 抽\n`; });
            if (pendingPulls > 0) resText += `\n💡 偵測到出金後已墊 ${pendingPulls} 抽`;
            if (warnings.length > 0) resText += `\n(⚠️ ${warnings.join('；')})`;
            statusEl.innerText = resText; statusEl.style.color = '#4ade80';
        } else {
            statusEl.innerText = `⚠️ 只找到 ${result.fiveStarCount} 個5星 (需至少2個才能計算，請確認截圖範圍)`;
            statusEl.style.color = '#facc15';
        }
    } catch (err) { statusEl.innerText = '❌ 失敗：' + (err.message || '未知'); statusEl.style.color = '#ef4444'; }
}

async function extractRecordsFromImage(file) {
    const colorCanvas = await fileToCanvas(file);
    const { width, height } = colorCanvas;
    
    // 將畫面分為上下兩部分處理：前 30% 為標題與卡池按鈕區，後 70% 為列表區
    const splitY = Math.floor(height * 0.30);
    
    const ocrCanvas = document.createElement('canvas');
    ocrCanvas.width = width; 
    ocrCanvas.height = height; 
    const ctx = ocrCanvas.getContext('2d');
    
    // 1. 上半部：使用較溫和的濾鏡，避免「極空迴音」等灰底白字按鈕被高對比洗白
    ctx.filter = 'grayscale(100%) invert(100%) contrast(120%)';
    ctx.drawImage(colorCanvas, 0, 0, width, splitY, 0, 0, width, splitY);

    // 2. 下半部：使用高強度的對比濾鏡，強化黑色背景上的列表白字
    ctx.filter = 'grayscale(100%) invert(100%) contrast(180%) brightness(110%)';
    ctx.drawImage(colorCanvas, 0, splitY, width, height - splitY, 0, splitY, width, height - splitY);

    const result = await Tesseract.recognize(ocrCanvas, 'chi_tra+eng');
    
    // 檢查全域是否偵測到常駐池特徵
    const fullText = result.data.text || "";
    const isStandardPool = /極空|迴音|回音/.test(fullText.replace(/\s+/g, ''));

    const rows = [];
    for (const line of result.data.lines) {
        // 忽略位於上半部 (y1 < splitY) 的文字，不把它們當作抽卡紀錄行來解析
        if (line.bbox.y1 < splitY) continue;

        const text = line.text.trim();
        if (text.length < 2) continue;
        
        const yCenter = (line.bbox.y0 + line.bbox.y1) / 2;
        let foundRow = rows.find(r => {
            const overlap = Math.max(0, Math.min(r.bbox.y1, line.bbox.y1) - Math.max(r.bbox.y0, line.bbox.y0));
            const minHeight = Math.min(r.bbox.y1 - r.bbox.y0, line.bbox.y1 - line.bbox.y0);
            return overlap > minHeight * 0.3;
        });
        
        if (foundRow) {
            if (line.bbox.x0 < foundRow.bbox.x0) { foundRow.text = text + " " + foundRow.text; } 
            else { foundRow.text = foundRow.text + " " + text; }
            foundRow.bbox.x0 = Math.min(foundRow.bbox.x0, line.bbox.x0);
            foundRow.bbox.y0 = Math.min(foundRow.bbox.y0, line.bbox.y0);
            foundRow.bbox.x1 = Math.max(foundRow.bbox.x1, line.bbox.x1);
            foundRow.bbox.y1 = Math.max(foundRow.bbox.y1, line.bbox.y1);
            foundRow.yCenter = (foundRow.bbox.y0 + foundRow.bbox.y1) / 2;
        } else {
            rows.push({ text: text, yCenter: yCenter, bbox: { ...line.bbox } });
        }
    }
    rows.sort((a, b) => a.yCenter - b.yCenter);
    
    // 傳入 0 作為 cropTop，因為 rows 的 bbox 已經是對齊原圖的絕對座標
    const records = parseOCRLines(rows, colorCanvas, 0); 
    records._isStandardPool = isStandardPool;
    return records;
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
    const totalPixels = data.length / 4;
    if (gCount / totalPixels > 0.003) return 5; 
    if (pCount / totalPixels > 0.003) return 4; 
    return 3;
}

function parseOCRLines(rows, colorCanvas, cropTop) {
    const records = [];
    let known = [];
    if (typeof standardCards !== 'undefined') known.push(...Object.values(standardCards).flat());
    if (typeof eventCards !== 'undefined') eventCards.forEach(e => known.push(...Object.values(e.cards).flat()));
    known = [...new Set(known)];
    let lastTime = Date.now();

    for (const row of rows) {
        const rawText = row.text.trim();
        if (rawText.length < 4 || /DEEPSPACE|LIMITED|掉落|預覽|許願|記錄|伺服器|延遲|沒有資料|稍後|再來|UID|uid|類型|名稱|時間/i.test(rawText)) continue;
        const textNoSpace = rawText.replace(/\s+/g, '');
        const cleanText = textNoSpace.replace(/[345]星/g, '').replace(/\[Mini\]/ig, '');
        
        const hasName = ['祁煜', '沈星回', '黎深', '秦徹', '夏以晝'].some(n => cleanText.includes(n));
        const hasStarStr = /[345]星/.test(textNoSpace);
        const hasDate = /202\d/.test(rawText) || /-\d{2}-\d{2}/.test(rawText);
        if (!hasName && !hasStarStr && !hasDate) continue;

        const star = detectStarFromColor(colorCanvas, row.bbox, cropTop) || (/(5|S|s|五|§)[星生皇里室量]/.test(textNoSpace) ? 5 : (/(4|A|a|四)[星生皇里室量]/.test(textNoSpace) ? 4 : 3));

        let cardName = '未知';
        for (const k of known) { if (cleanText.includes(k.replace(/\s+/g, ''))) { cardName = k; break; } }
        
        if (cardName === '未知') {
            let maxS = 0;
            for (const k of known) {
                const kChars = k.replace(/\s+/g, '').split('');
                let s = 0; kChars.forEach(c => { if (cleanText.includes(c) || (VARIANT_CHARS[c] && cleanText.includes(VARIANT_CHARS[c]))) s++; });
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

        const tM = rawText.match(/(202\d)?[-/.]?\d{1,2}[-/.]\d{1,2}\s+\d{1,2}[:;.]\d{1,2}[:;.]\d{1,2}/);
        let time = lastTime; let hasRealTime = false;
        if (tM) { 
            let timeStr = tM[0];
            if (!timeStr.startsWith('202')) timeStr = new Date().getFullYear() + '-' + timeStr.replace(/^[-/.]/, '');
            const parsed = new Date(timeStr.replace(/[-/.]/g, '-').replace(/[:;.]/g, ':').replace(/\s+/, 'T')).getTime(); 
            if (!isNaN(parsed)) { time = parsed; lastTime = parsed; hasRealTime = true; } 
        }
        records.push({ star, time, name: cardName, raw: rawText, _hasRealTime: hasRealTime });
    }
    return records;
}

const VARIANT_CHARS = { '溫': '温', '繾': '缱', '綣': '绻', '晝': '昼', '跡': '迹', '戀': '恋' };

function fileToCanvas(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { 
            const c = document.createElement('canvas'); 
            c.width = img.width; 
            c.height = img.height; 
            c.getContext('2d').drawImage(img, 0, 0); 
            resolve(c); 
        };
        img.onerror = () => reject(new Error('圖片載入失敗'));
        img.src = URL.createObjectURL(file);
    });
}

function countPulls(records) {
    const pos = records.map((r, i) => ({ ...r, i })).filter(r => r.star === 5);
    const pendingPulls = pos.length > 0 ? pos[0].i : records.length; 
    if (pos.length < 2) return { pullEvents: [], fiveStarCount: pos.length, pendingPulls, pos };
    return { 
        pullEvents: pos.slice(0, -1).map((c, i) => ({ name: c.name, pulls: pos[i+1].i - c.i, time: c.time, raw: c.raw })), 
        fiveStarCount: pos.length, pendingPulls, pos 
    };
}
