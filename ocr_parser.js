// ocr_parser.js — 精準打擊版 v16

async function handleOCR(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  const statusEl = document.getElementById('ocrStatus');
  statusEl.innerText = `⏳ 辨識中... (0/${files.length})`;
  statusEl.style.color = '#c084fc';

  try {
    let pages = [];
    let warnings = [];

    // 1. 逐張辨識
    for (let i = 0; i < files.length; i++) {
      statusEl.innerText = `⏳ 辨識中... (${i + 1}/${files.length})`;
      const records = await extractRecordsFromImage(files[i]);
      
      if (records.length < 14) {
        warnings.push(`第${i + 1}張讀取 ${records.length} 筆`);
      }

      if (records.length > 0) {
        pages.push(records);
      }
    }

    if (pages.length === 0) {
      statusEl.innerText = '⚠️ 未能辨識任何紀錄，請確認截圖清晰';
      statusEl.style.color = '#facc15';
      return;
    }

    // 2. 排序並攤平紀錄
    pages.sort((pageA, pageB) => pageB[0].time - pageA[0].time);
    let allRecords = [];
    pages.forEach(page => {
      allRecords = allRecords.concat(page);
    });

    const result = countPulls(allRecords);

    // 3. 處理多金結果與文字輸出
    if (result.pullEvents.length > 0) {
      // 帶入「最先出（最舊）」的五星數字
      const firstGold = result.pullEvents[result.pullEvents.length - 1];
      document.getElementById('pulls').value = firstGold.pulls;

      let resultText = `✅ 辨識完成！\n\n`;
      
      // 反轉陣列，讓畫面顯示順序為「先出 -> 後出」（如：問劍觀花 -> 深海醉金）
      const reversedEvents = [...result.pullEvents].reverse();
      reversedEvents.forEach(evt => {
          resultText += `${evt.name}：${evt.pulls}抽\n`;
      });

      if (warnings.length > 0) {
          resultText += `\n(⚠️ ${warnings.join('；')})`;
      }

      statusEl.innerText = resultText;
      statusEl.style.color = '#4ade80';
    } else {
      statusEl.innerText = `⚠️ 只找到 ${result.fiveStarCount} 個5星 (需要至少2個才能計算，請確保截圖包含上一次出金紀錄喔)`;
      statusEl.style.color = '#facc15';
    }

  } catch (err) {
    console.error('[OCR Error]', err);
    statusEl.innerText = '❌ 辨識失敗：' + (err.message || '未知錯誤');
    statusEl.style.color = '#ef4444';
  }
}

// ── 從單張圖片萃取紀錄 ────────────────────────────────────────
async function extractRecordsFromImage(file) {
  const canvas = await fileToCanvas(file);
  const { width, height } = canvas;

  const cropTop = Math.floor(height * 0.15); 
  const tableHeight = height - cropTop; 

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = tableHeight;
  const ctx = tempCanvas.getContext('2d');
  
  ctx.filter = 'grayscale(100%) invert(100%) contrast(180%) brightness(110%)';
  ctx.drawImage(canvas, 0, -cropTop);

  const result = await Tesseract.recognize(tempCanvas, 'chi_tra+eng');
  return parseOCRText(result.data.text);
}

// ── 圖片轉 Canvas ─────────────────────────────────────────────
function fileToCanvas(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('圖片載入失敗'));
    img.src = URL.createObjectURL(file);
  });
}

// ── 解析 OCR 文字與提取名稱 ──────────────────────────
function parseOCRText(text) {
  const records = [];
  const lines = text.split('\n');
  
  let lastValidTime = Date.now(); 

  for (const line of lines) {
    const cleanLine = line.trim();
    
    // 【防線1】長度過短或純頁碼，直接丟棄
    if (cleanLine.length < 10) continue;
    if (/^\s*<?\s*\d+\s*>?\s*$/.test(cleanLine)) continue;

    // 【防線2】UI 黑名單：只要包含這些遊戲介面文字，一律踢除
    if (/掉落|預覽|許願|紀錄|伺服器|延遲|類型|名稱|時間|沒有資料|最近|再來/.test(cleanLine)) continue;

    // 【防線3】數字特徵：一筆正常的紀錄一定有時間戳，必定包含許多數字
    // 如果這一行連 4 個數字都湊不齊，那絕對不是抽卡紀錄
    const digits = cleanLine.match(/\d/g);
    if (!digits || digits.length < 4) continue;

    let star = 3;

    if (/(5|S|s|五|§)\s*[星生皇里室量]/.test(cleanLine) || /^[^0-9]*(5)/.test(cleanLine)) {
      star = 5;
    } else if (/(4|A|a|四)\s*[星生皇里室量]/.test(cleanLine) || /^[^0-9]*(4)/.test(cleanLine)) {
      star = 4;
    }

    // 嘗試抓取思念名稱
    let cardName = "未知";
    const parts = cleanLine.replace(/\s+/g, ' ').split(' '); 
    if (parts.length >= 2) {
       let nameParts = [];
       for (let i = 1; i < parts.length; i++) {
           if (parts[i].startsWith('202')) break;
           nameParts.push(parts[i]);
       }
       cardName = nameParts.join('').trim() || cardName;
       
       if (cardName.includes('·')) cardName = cardName.split('·')[1].trim();
       else if (cardName.includes('.')) cardName = cardName.split('.')[1].trim();
       else if (cardName.includes('・')) cardName = cardName.split('・')[1].trim();
    }

    const timeMatch = cleanLine.match(/202\d[-/.]\d{1,2}[-/.]\d{1,2}\s+\d{1,2}[:;.]\d{1,2}[:;.]\d{1,2}/);
    let time = lastValidTime;
    
    if (timeMatch) {
      let timeStr = timeMatch[0].replace(/[-/.]/g, '-').replace(/[:;.]/g, ':').replace(/\s+/, 'T');
      const parsedTime = new Date(timeStr).getTime();
      if (!isNaN(parsedTime)) {
        time = parsedTime;
        lastValidTime = time; 
      }
    }

    records.push({ star, time, name: cardName, originalText: cleanLine });
  }

  return records;
}

// ── 計算所有 5 星之間的抽數 ────────────────────────────────────
function countPulls(records) {
  const fiveStarPositions = records
    .map((r, pos) => ({ ...r, pos }))
    .filter(r => r.star === 5);

  if (fiveStarPositions.length < 2) {
    return { pullEvents: [], fiveStarCount: fiveStarPositions.length };
  }

  let pullEvents = [];
  
  for (let i = 0; i < fiveStarPositions.length - 1; i++) {
    const currentEvent = fiveStarPositions[i];       // 較新的五星
    const previousEvent = fiveStarPositions[i + 1];  // 較舊的五星
    
    const pulls = previousEvent.pos - currentEvent.pos;
    pullEvents.push({ name: currentEvent.name, pulls: pulls });
  }

  return { pullEvents: pullEvents, fiveStarCount: fiveStarPositions.length };
}
