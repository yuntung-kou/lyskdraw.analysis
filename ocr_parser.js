// ocr_parser.js — 顏色偵測版 (v18)
// 核心改進：用像素顏色判斷星級，不再依賴 OCR 文字辨識「5星/4星」

// ═══════════════════════════════════════════════════════════
// 🔘 主入口：處理使用者上傳的圖片
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

    // ── 步驟一：逐張圖片進行 OCR 辨識 ──
    for (let i = 0; i < files.length; i++) {
      statusEl.innerText = `⏳ 辨識中... (${i + 1}/${files.length})`;
      const records = await extractRecordsFromImage(files[i]);

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

    // ── 步驟二：依每頁第一筆的時間降冪排序（最新頁排前面） ──
    pages.sort((pageA, pageB) => (pageB[0].time || 0) - (pageA[0].time || 0));
    const allRecords = pages.flat();

    // ── 步驟三：計算出金抽數 ──
    const result = countPulls(allRecords);

    if (result.pullEvents.length > 0) {
      // 將最靠近的一次出金抽數填入輸入框
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
        `⚠️ 只找到 ${result.fiveStarCount} 個5星（需要至少 2 個才能計算，請確保截圖包含上一次出金紀錄）`;
      statusEl.style.color = '#facc15';
    }

  } catch (err) {
    console.error('[OCR Error]', err);
    statusEl.innerText = '❌ 辨識失敗：' + (err.message || '未知錯誤');
    statusEl.style.color = '#ef4444';
  }
}


// ═══════════════════════════════════════════════════════════
// 🖼️ 從單張圖片萃取所有抽卡紀錄
// ═══════════════════════════════════════════════════════════
async function extractRecordsFromImage(file) {
  // ── 【關鍵】同時準備兩張畫布 ──
  // colorCanvas：保留原始色彩，用來做顏色偵測（判斷星級）
  // ocrCanvas  ：黑白高對比版本，給 Tesseract 辨識文字用
  const colorCanvas = await fileToCanvas(file);
  const { width, height } = colorCanvas;

  // 裁掉上方約 15%（說明文字、欄位標題等無用資訊）
  const cropTop = Math.floor(height * 0.15);
  const croppedHeight = height - cropTop;

  // 建立 OCR 專用畫布（灰階 + 反色 + 高對比 → 讓 Tesseract 更好辨識）
  const ocrCanvas = document.createElement('canvas');
  ocrCanvas.width = width;
  ocrCanvas.height = croppedHeight;
  const ocrCtx = ocrCanvas.getContext('2d');
  ocrCtx.filter = 'grayscale(100%) invert(100%) contrast(180%) brightness(110%)';
  ocrCtx.drawImage(colorCanvas, 0, -cropTop);

  // 執行 Tesseract OCR，取得每一行的文字 + 位置（bbox）
  const result = await Tesseract.recognize(ocrCanvas, 'chi_tra+eng');

  // 把辨識結果傳給解析函式，同時也傳入 colorCanvas 供顏色判斷
  return parseOCRLines(result.data.lines, colorCanvas, cropTop);
}


// ═══════════════════════════════════════════════════════════
// 🎨 顏色偵測核心：判斷這一行是幾星
// ═══════════════════════════════════════════════════════════
function detectStarFromColor(colorCanvas, bbox, cropTop) {
  // bbox 是從裁切後的 OCR 畫布取得的座標
  // 所以 Y 座標需要加回 cropTop，才能對應到原始 colorCanvas 上的位置
  const realY0 = bbox.y0 + cropTop;
  const realY1 = bbox.y1 + cropTop;
  const rowHeight = realY1 - realY0;

  if (rowHeight <= 0) return 3; // 異常行直接當 3 星

  const ctx = colorCanvas.getContext('2d');
  const canvasWidth = colorCanvas.width;

  // 取得這一整行的像素資料（R、G、B、A 四個值為一組）
  const imageData = ctx.getImageData(0, realY0, canvasWidth, rowHeight);
  const data = imageData.data;

  let goldCount = 0;   // 金色像素計數（5星）
  let purpleCount = 0; // 紫色像素計數（4星）
  const totalPixels = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];     // 紅色通道，0～255
    const g = data[i + 1]; // 綠色通道，0～255
    const b = data[i + 2]; // 藍色通道，0～255
    // data[i+3] 是透明度（Alpha），這裡不需要

    // ── 金色判斷條件（5星卡名是金/琥珀色）──
    // 金色特徵：紅 > 180（高）、綠 > 100（中）、藍 < 120（低）
    // 且紅 > 綠 > 藍（從紅到藍遞減）
    if (r > 180 && g > 100 && b < 120 && r > g && g > b) {
      goldCount++;
    }
    // ── 紫色判斷條件（4星卡名是藍紫色）──
    // 紫色特徵：藍 > 150（高）、藍 > 紅（藍色主導）、紅在合理範圍
    else if (b > 150 && b > r && r > 80 && r < 230 && g < 200) {
      purpleCount++;
    }
  }

  // 計算金色/紫色像素佔這一行的比例
  const goldRatio = goldCount / totalPixels;
  const purpleRatio = purpleCount / totalPixels;

  // 閾值設定：只要超過 2% 的像素是金色 → 判定為 5 星
  // 這個數字不需要很高，因為卡名文字本身只佔行的一部分
  if (goldRatio > 0.02) return 5;
  if (purpleRatio > 0.02) return 4;
  return 3; // 預設 3 星（白色文字）
}


// ═══════════════════════════════════════════════════════════
// 📄 解析每一行 OCR 結果，組合成結構化紀錄
// ═══════════════════════════════════════════════════════════
function parseOCRLines(lines, colorCanvas, cropTop) {
  const records = [];

  // ── 建立「已知卡名」字典（從 eventCards 和 standardCards 中整理出來）──
  let allKnownCards = [];
  if (typeof standardCards !== 'undefined') {
    allKnownCards.push(...Object.values(standardCards).flat());
  }
  if (typeof eventCards !== 'undefined') {
    eventCards.forEach(e => allKnownCards.push(...Object.values(e.cards).flat()));
  }
  allKnownCards = [...new Set(allKnownCards)]; // 去除重複卡名

  let lastValidTime = 0; // 上一次成功解析到的時間，作為備用

  for (const line of lines) {
    const text = line.text.trim();

    // ── 防線一：太短的行直接跳過 ──
    if (text.length < 5) continue;

    // ── 防線二：UI 文字與浮水印黑名單 ──
    // 只要這一行包含以下任何關鍵字，就不是抽卡紀錄，直接丟棄
    if (/DEEPSPACE|LIMITED|掉落|預覽|許願|記錄|伺服器|延遲|類型|名稱|時間|沒有資料|稍後|再來|UID|uid/.test(text)) continue;

    // ── 防線三：這一行連 4 個數字都沒有，不可能是含時間戳的紀錄 ──
    const digits = text.match(/\d/g);
    if (!digits || digits.length < 4) continue;

    // ── 🎨 顏色偵測：這是最重要的一步 ──
    // 直接看像素，不靠 OCR 文字判斷星級，完全不受文字辨識錯誤影響
    const star = detectStarFromColor(colorCanvas, line.bbox, cropTop);

    // ── 卡名辨識：策略 A（字典對答案）優先 ──
    let cardName = '未知';
    for (const known of allKnownCards) {
      if (text.includes(known)) {
        cardName = known;
        break;
      }
    }

    // ── 卡名辨識：策略 B（fallback，抓最長中文段落）──
    // 字典找不到時（可能是新卡），抓這一行裡最長的中文連續字串
    if (cardName === '未知') {
      const matches = text.match(/[\u4e00-\u9fa5·・]{2,}/g);
      if (matches) {
        // 過濾掉單一的 UI 功能字（星、類、型等）
        const filtered = matches.filter(m => !/^[星類型名稱時間掉落預覽]+$/.test(m));
        if (filtered.length > 0) {
          cardName = filtered.reduce((a, b) => a.length >= b.length ? a : b);
        }
      }
    }

    // ── 時間解析 ──
    // 比對「2026-02-10 12:57:31」這種格式（分隔符號容錯）
    const timeMatch = text.match(
      /202\d[-/.]\d{1,2}[-/.]\d{1,2}\s+\d{1,2}[:;.]\d{1,2}[:;.]\d{1,2}/
    );
    let time = lastValidTime;
    if (timeMatch) {
      const cleaned = timeMatch[0]
        .replace(/[-/.]/g, '-')   // 統一日期分隔符
        .replace(/[:;.]/g, ':')   // 統一時間分隔符
        .replace(/\s+/, 'T');     // 變成 ISO 格式
      const parsed = new Date(cleaned).getTime();
      if (!isNaN(parsed)) {
        time = parsed;
        lastValidTime = parsed;
      }
    }

    // 完全沒有時間資訊的行跳過（避免把純雜訊塞進去）
    if (time === 0) continue;

    records.push({ star, time, name: cardName, originalText: text });
  }

  return records;
}


// ═══════════════════════════════════════════════════════════
// 🖼️ 工具函式：把 File 物件轉成 Canvas
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
// 🔢 計算每次 5 星之間的抽數
// ═══════════════════════════════════════════════════════════
function countPulls(records) {
  // 找出所有 5 星紀錄，同時記下它們在陣列中的位置（index）
  const fiveStarPositions = records
    .map((r, pos) => ({ ...r, pos }))
    .filter(r => r.star === 5);

  // 至少需要 2 個 5 星才能計算「之間的抽數」
  if (fiveStarPositions.length < 2) {
    return { pullEvents: [], fiveStarCount: fiveStarPositions.length };
  }

  // 計算相鄰兩個 5 星之間的距離（= 中間有幾筆紀錄）
  // 因為陣列是「新 → 舊」排列，所以 [i+1].pos - [i].pos 就是保底計數
  const pullEvents = fiveStarPositions.slice(0, -1).map((curr, i) => ({
    name: curr.name,
    pulls: fiveStarPositions[i + 1].pos - curr.pos
  }));

  return { pullEvents, fiveStarCount: fiveStarPositions.length };
}
