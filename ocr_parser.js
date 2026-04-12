// ocr_parser.js — 顏色偵測版 (v18 修正)

// ═══════════════════════════════════════════════════════════
// 🔘 主入口
// ═══════════════════════════════════════════════════════════
async function handleOCR(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  const statusEl = document.getElementById('ocrStatus');
  statusEl.innerText = `⏳ 辨識中... (0/${files.length})`;
  statusEl.style.color = '#c084fc';

  try {
    let pages = [];
    let warnings = [];

    for (let i = 0; i < files.length; i++) {
      statusEl.innerText = `⏳ 辨識中... (${i + 1}/${files.length})`;
      const records = await extractRecordsFromImage(files[i]);

      console.log(`[第 ${i + 1} 張] 共讀取 ${records.length} 筆，其中 5 星：`,
        records.filter(r => r.star === 5).map(r => r.name));

      if (records.length < 14) {
        warnings.push(`第 ${i + 1} 張只讀取到 ${records.length} 筆`);
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

    pages.sort((pageA, pageB) => (pageB[0].time || 0) - (pageA[0].time || 0));
    const allRecords = pages.flat();
    const result = countPulls(allRecords);

    if (result.pullEvents.length > 0) {
      const firstGold = result.pullEvents[result.pullEvents.length - 1];
      document.getElementById('pulls').value = firstGold.pulls;

      let resultText = `✅ 辨識完成！\n\n`;
      const reversedEvents = [...result.pullEvents].reverse();
      reversedEvents.forEach(evt => {
        resultText += `${evt.name}：${evt.pulls} 抽\n`;
      });
      if (warnings.length > 0) {
        resultText += `\n(⚠️ ${warnings.join('；')})`;
      }
      statusEl.innerText = resultText;
      statusEl.style.color = '#4ade80';
    } else {
      statusEl.innerText =
        `⚠️ 只找到 ${result.fiveStarCount} 個5星（需要至少 2 個才能計算）`;
      statusEl.style.color = '#facc15';
    }

  } catch (err) {
    console.error('[OCR Error]', err);
    statusEl.innerText = '❌ 辨識失敗：' + (err.message || '未知錯誤');
    statusEl.style.color = '#ef4444';
  }
}


// ═══════════════════════════════════════════════════════════
// 🖼️ 從單張圖片萃取紀錄
// ═══════════════════════════════════════════════════════════
async function extractRecordsFromImage(file) {
  const colorCanvas = await fileToCanvas(file);
  const { width, height } = colorCanvas;
  const cropTop = Math.floor(height * 0.15);
  const croppedHeight = height - cropTop;

  const ocrCanvas = document.createElement('canvas');
  ocrCanvas.width = width;
  ocrCanvas.height = croppedHeight;
  const ocrCtx = ocrCanvas.getContext('2d');
  ocrCtx.filter = 'grayscale(100%) invert(100%) contrast(180%) brightness(110%)';
  ocrCtx.drawImage(colorCanvas, 0, -cropTop);

  const result = await Tesseract.recognize(ocrCanvas, 'chi_tra+eng');
  console.log('[OCR 原始行數]', result.data.lines.length);

  return parseOCRLines(result.data.lines, colorCanvas, cropTop);
}


// ═══════════════════════════════════════════════════════════
// 🎨 顏色偵測：判斷這一行是幾星
// ═══════════════════════════════════════════════════════════
function detectStarFromColor(colorCanvas, bbox, cropTop) {
  const realY0 = Math.max(0, bbox.y0 + cropTop);
  const realY1 = Math.min(colorCanvas.height, bbox.y1 + cropTop);
  const rowHeight = realY1 - realY0;

  if (rowHeight <= 0) return null;

  const ctx = colorCanvas.getContext('2d');
  let imageData;
  try {
    imageData = ctx.getImageData(0, realY0, colorCanvas.width, rowHeight);
  } catch (e) {
    return null;
  }
  const data = imageData.data;

  let goldCount = 0;
  let purpleCount = 0;
  const totalPixels = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // 金色（5星）：R > G > B 暖色調，且 R-B > 35 確保有足夠色差
    // 實測：5星行平均 R:178-198, G:161-182, B:117-137
    if (r > 140 && r > g && g > b && (r - b) > 35) {
      goldCount++;
    }
    // 紫色（4星）：B 最高且明顯大於 R，B-R > 25
    // 實測：4星行平均 R:154, G:143, B:192，B-R 約 38
    else if (b > r && b > g && (b - r) > 25 && b > 120) {
      purpleCount++;
    }
  }

  const goldRatio = goldCount / totalPixels;
  const purpleRatio = purpleCount / totalPixels;

  // 調試用：把這行取消註解，上傳圖片後在瀏覽器 console 觀察比例
  // console.log(`y=${bbox.y0} gold:${(goldRatio*100).toFixed(2)}% purple:${(purpleRatio*100).toFixed(2)}%`);

  // 實測：5星行金色比例約 9-14%，4星行紫色比例約 11%，閾值 0.5% 已足夠
  if (goldRatio > 0.005) return 5;
  if (purpleRatio > 0.005) return 4;
  return 3;
}


// ═══════════════════════════════════════════════════════════
// 📄 解析每一行 OCR 結果 (v19 終極卡名校正版)
// ═══════════════════════════════════════════════════════════
function parseOCRLines(lines, colorCanvas, cropTop) {
  const records = [];

  let allKnownCards = [];
  if (typeof standardCards !== 'undefined') {
    allKnownCards.push(...Object.values(standardCards).flat());
  }
  if (typeof eventCards !== 'undefined') {
    eventCards.forEach(e => allKnownCards.push(...Object.values(e.cards).flat()));
  }
  allKnownCards = [...new Set(allKnownCards)];

  let lastValidTime = Date.now();

  for (const line of lines) {
    const text = line.text.trim();

    if (text.length < 5) continue;
    if (/DEEPSPACE|LIMITED|掉落|預覽|許願|記錄|伺服器|延遲|類型|名稱|時間|沒有資料|稍後|再來|UID|uid/.test(text)) continue;

    const digits = text.match(/\d/g);
    if (!digits || digits.length < 4) continue;

    // 🌟 1. 基礎去空白
    const textNoSpace = text.replace(/\s+/g, '');
    // 🌟 2. 拔除干擾字眼 (把黏在一起的 "5星", "4星" 拔掉，避免被當成名字的一部分)
    const cleanText = textNoSpace.replace(/[345]星/g, '').replace(/\[Mini\]/ig, '');

    let star;
    const colorResult = detectStarFromColor(colorCanvas, line.bbox, cropTop);
    if (colorResult !== null) {
      star = colorResult;
    } else {
      if (/(5|S|s|五|§)[星生皇里室量]/.test(textNoSpace)) star = 5;
      else if (/(4|A|a|四)[星生皇里室量]/.test(textNoSpace)) star = 4;
      else star = 3;
    }

    let cardName = '未知';

    // 🌟 3. 精確比對 (去除空白對齊)
    for (const known of allKnownCards) {
      if (cleanText.includes(known.replace(/\s+/g, ''))) {
        cardName = known;
        break;
      }
    }

    // 🌟 4. 模糊比對 (Fuzzy Match)：專治 OCR 錯字
    if (cardName === '未知') {
      let maxScore = 0;
      let bestMatch = '未知';
      // 內建深空常見 OCR 錯字轉換表 (繁簡互通)
      const variants = { '溫': '温', '繾': '缱', '綣': '绻', '晝': '昼', '跡': '迹', '戀': '恋' };

      for (const known of allKnownCards) {
        const knownChars = known.replace(/\s+/g, '').split('');
        let score = 0;
        for (const char of knownChars) {
          if (cleanText.includes(char)) {
            score++;
          } else if (variants[char] && cleanText.includes(variants[char])) {
            score++; // 即使讀成錯字(如 温)也算得分
          }
        }
        // 只要對中 50% 以上的字元，且分數最高，就認定是它
        const matchRate = score / knownChars.length;
        if (matchRate >= 0.5 && score > maxScore) {
          maxScore = score;
          bestMatch = known;
        }
      }
      if (bestMatch !== '未知') cardName = bestMatch;
    }

    // 🌟 5. 終極保底 (真的爛到認不出卡名，但認得出男主的處理)
    if (cardName === '未知') {
      const leads = ['祁煜', '沈星回', '黎深', '秦徹', '夏以晝'];
      let foundLead = leads.find(l => cleanText.includes(l));
      
      const matches = cleanText.match(/[\u4e00-\u9fa5]{2,}/g);
      if (matches) {
        // 把男主名字剃除，剩下的中文字拿來當卡名 (避免抓到 星沈星回)
        const filtered = matches
          .map(m => m.replace(/祁煜|沈星回|黎深|秦徹|夏以晝/g, ''))
          .filter(m => m.length >= 2 && !/^[星類型名稱時間掉落預覽]+$/.test(m));
        if (filtered.length > 0) {
          cardName = filtered.reduce((a, b) => a.length >= b.length ? a : b);
        }
      }
      
      // 如果過濾完還是空的 (代表名字全變成亂碼)，但有男主名且是5星
      if ((cardName === '未知' || cardName.trim() === '') && foundLead && star === 5) {
         cardName = `${foundLead} (未知卡名)`;
      }
    }

    // 時間解析
    const timeMatch = text.match(
      /202\d[-/.]\d{1,2}[-/.]\d{1,2}\s+\d{1,2}[:;.]\d{1,2}[:;.]\d{1,2}/
    );
    let time = lastValidTime;
    if (timeMatch) {
      const cleaned = timeMatch[0]
        .replace(/[-/.]/g, '-')
        .replace(/[:;.]/g, ':')
        .replace(/\s+/, 'T');
      const parsed = new Date(cleaned).getTime();
      if (!isNaN(parsed)) { time = parsed; lastValidTime = parsed; }
    }

    records.push({ star, time, name: cardName, originalText: text });
  }

  return records;
}

// ═══════════════════════════════════════════════════════════
// 🖼️ File → Canvas
// ═══════════════════════════════════════════════════════════
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


// ═══════════════════════════════════════════════════════════
// 🔢 計算抽數
// ═══════════════════════════════════════════════════════════
function countPulls(records) {
  const fiveStarPositions = records
    .map((r, pos) => ({ ...r, pos }))
    .filter(r => r.star === 5);

  if (fiveStarPositions.length < 2) {
    return { pullEvents: [], fiveStarCount: fiveStarPositions.length };
  }

  const pullEvents = fiveStarPositions.slice(0, -1).map((curr, i) => ({
    name: curr.name,
    pulls: fiveStarPositions[i + 1].pos - curr.pos
  }));

  return { pullEvents, fiveStarCount: fiveStarPositions.length };
}
