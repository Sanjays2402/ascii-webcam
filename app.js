// ASCII Webcam — 15 iteration upgrade
const $ = id => document.getElementById(id);
const video = $('video'), hiddenCanvas = $('hiddenCanvas');
const hCtx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
const output = $('asciiOutput');
const recordCanvas = $('recordCanvas');
const recCtx = recordCanvas.getContext('2d');

const charRamps = {
  simple:   ' .:-=+*#%@',
  detailed: ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  blocks:   ' ░▒▓█',
  minimal:  ' .:░▓█',
  binary:   ' 0101',
  braille:  ' ⠁⠃⠇⡇⣇⣧⣷⣿',
};

// ── ITER 1: persistent settings
let colorMode = (localStorage.getItem('aw-color') ?? '1') === '1';
let invertMode = localStorage.getItem('aw-invert') === '1';
let lightTheme = localStorage.getItem('aw-theme') === 'light';
let running = false;
let cols = +localStorage.getItem('aw-res') || 120;
let ramp = localStorage.getItem('aw-ramp') || 'detailed';
let effect = localStorage.getItem('aw-effect') || 'none';

// Apply restored values
$('resolution').value = cols;
$('resVal').textContent = cols;
$('charRamp').value = ramp;
$('effect').value = effect;
$('colorBtn').classList.toggle('btn-active', colorMode);
$('colorBtn').textContent = colorMode ? '🎨 Color' : '◻ Mono';
$('invertBtn').classList.toggle('btn-active', invertMode);
if (lightTheme) document.body.classList.add('light');

let lastTime = performance.now();
let frameCount = 0;
let prevFrame = null; // for edge detection
let matrixDrops = [];
let charCount = 0;

// ── ITER 10: MediaRecorder for video recording
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

async function startWebcam() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = stream;
    await video.play();
    
    $('startScreen').style.display = 'none';
    $('toolbar').style.display = '';
    $('hud').style.display = '';
    output.style.display = '';
    
    running = true;
    requestAnimationFrame(render);
  } catch (err) {
    $('startScreen').innerHTML = `
      <div class="error-msg">
        <h3 style="font-size:22px;margin-bottom:10px">📹 Camera access denied</h3>
        <p style="font-size:13px;color:var(--muted)">Allow camera permissions and reload the page.</p>
      </div>`;
  }
}
window.startWebcam = startWebcam;

function render() {
  if (!running) return;
  const rampStr = charRamps[$('charRamp').value] || charRamps.detailed;
  cols = +$('resolution').value;
  const effectMode = $('effect').value;
  
  const vw = video.videoWidth, vh = video.videoHeight;
  if (vw === 0 || vh === 0) { requestAnimationFrame(render); return; }
  
  // Char aspect correction
  const aspect = vw / vh;
  const rows = Math.floor(cols / aspect * 0.5);
  
  hiddenCanvas.width = cols;
  hiddenCanvas.height = rows;
  
  // ── ITER 2: selfie-mirror + better sampling
  hCtx.save();
  hCtx.translate(cols, 0);
  hCtx.scale(-1, 1);
  hCtx.drawImage(video, 0, 0, cols, rows);
  hCtx.restore();
  
  const imageData = hCtx.getImageData(0, 0, cols, rows);
  const pixels = imageData.data;
  
  // ── ITER 7: edge detection (Sobel) — stays crisp and dramatic
  let edgeMap = null;
  if (effectMode === 'edge') {
    edgeMap = new Uint8Array(cols * rows);
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const L = (i) => 0.299 * pixels[i] + 0.587 * pixels[i+1] + 0.114 * pixels[i+2];
        const tl = L(((y-1)*cols+(x-1))*4), tc = L(((y-1)*cols+x)*4), tr = L(((y-1)*cols+(x+1))*4);
        const ml = L((y*cols+(x-1))*4),                               mr = L((y*cols+(x+1))*4);
        const bl = L(((y+1)*cols+(x-1))*4), bc = L(((y+1)*cols+x)*4), br = L(((y+1)*cols+(x+1))*4);
        const gx = -tl + tr - 2*ml + 2*mr - bl + br;
        const gy = -tl - 2*tc - tr + bl + 2*bc + br;
        edgeMap[y*cols+x] = Math.min(255, Math.sqrt(gx*gx + gy*gy));
      }
    }
  }
  
  // ── ITER 8: matrix rain effect
  if (effectMode === 'matrix') {
    if (matrixDrops.length !== cols) {
      matrixDrops = new Array(cols).fill(0).map(() => Math.random() * rows);
    }
    for (let i = 0; i < cols; i++) {
      matrixDrops[i] = (matrixDrops[i] + 0.3 + Math.random() * 0.4) % (rows * 1.5);
    }
  }
  
  let html = '';
  let plain = '';
  charCount = 0;
  
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = (y * cols + x) * 4;
      let r = pixels[idx], g = pixels[idx+1], b = pixels[idx+2];
      let brightness;
      
      if (edgeMap) {
        brightness = edgeMap[y*cols+x] / 255;
      } else {
        brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      }
      
      // ── ITER 4: posterize effect (4 levels)
      if (effectMode === 'posterize') {
        brightness = Math.round(brightness * 3) / 3;
        r = Math.round(r / 64) * 64;
        g = Math.round(g / 64) * 64;
        b = Math.round(b / 64) * 64;
      }
      
      let adj = invertMode ? 1 - brightness : brightness;
      
      // ── ITER 8 cont.: matrix overlay — ghost characters fade to drop
      if (effectMode === 'matrix') {
        const drop = matrixDrops[x];
        const dist = Math.abs(y - drop);
        if (dist < 1) { adj = 1; r = g = 255; b = 255; }
        else if (dist < 8) {
          adj = Math.max(adj * 0.5, 1 - dist / 8);
          r = 0; g = Math.max(120, 220 - dist * 14); b = Math.max(40, 120 - dist * 8);
        } else {
          adj *= 0.3;
          r *= 0.2; g *= 0.8; b *= 0.2;
        }
      }
      
      const charIdx = Math.floor(adj * (rampStr.length - 1));
      let ch = rampStr[charIdx] || ' ';
      
      if (colorMode) {
        if (ch === ' ') ch = '&nbsp;';
        else if (ch === '<') ch = '&lt;';
        else if (ch === '>') ch = '&gt;';
        else if (ch === '&') ch = '&amp;';
        // ── ITER 5: perceptual color boost — saturate output slightly
        const boost = 1.2;
        const avg = (r + g + b) / 3;
        r = Math.min(255, avg + (r - avg) * boost);
        g = Math.min(255, avg + (g - avg) * boost);
        b = Math.min(255, avg + (b - avg) * boost);
        html += `<span style="color:rgb(${r|0},${g|0},${b|0})">${ch}</span>`;
      } else {
        plain += ch;
      }
      if (ch !== ' ' && ch !== '&nbsp;') charCount++;
    }
    if (colorMode) html += '\n'; else plain += '\n';
  }
  
  if (colorMode) output.innerHTML = html;
  else output.textContent = plain;
  
  // ── ITER 3: auto-fit font size to viewport (both dims)
  const mainEl = document.querySelector('.main');
  const maxW = mainEl.clientWidth - 20;
  const maxH = mainEl.clientHeight - 20;
  const charW = maxW / cols;
  const charH = maxH / rows;
  const size = Math.max(3, Math.min(18, Math.min(charW, charH * 1.7)));
  output.style.fontSize = size + 'px';
  output.style.lineHeight = (size * 0.95) + 'px';
  
  // ── ITER 6: FPS + stats in HUD
  frameCount++;
  const now = performance.now();
  if (now - lastTime >= 500) {
    const fps = Math.round((frameCount * 1000) / (now - lastTime));
    $('fps').textContent = fps;
    $('fps').style.color = fps >= 30 ? '#10b981' : fps >= 15 ? '#f59e0b' : '#ef4444';
    $('chars').textContent = charCount;
    $('res').textContent = `${cols}×${rows}`;
    frameCount = 0;
    lastTime = now;
  }
  
  // ── ITER 11: capture to record canvas when recording
  if (isRecording) {
    const size2 = parseFloat(output.style.fontSize) || 10;
    recordCanvas.width = Math.ceil(mainEl.clientWidth);
    recordCanvas.height = Math.ceil(mainEl.clientHeight);
    recCtx.fillStyle = lightTheme ? '#fff' : '#05050a';
    recCtx.fillRect(0, 0, recordCanvas.width, recordCanvas.height);
    recCtx.font = `500 ${size2}px 'JetBrains Mono',monospace`;
    recCtx.textBaseline = 'top';
    const lineH = size2 * 0.95;
    const offsetX = (recordCanvas.width - cols * size2 * 0.6) / 2;
    const offsetY = (recordCanvas.height - rows * lineH) / 2;
    // draw from plain text (easier than HTML); use color when colorMode
    const rampNow = charRamps[$('charRamp').value] || charRamps.detailed;
    for (let y2 = 0; y2 < rows; y2++) {
      for (let x2 = 0; x2 < cols; x2++) {
        const pIdx = (y2 * cols + x2) * 4;
        const r2 = pixels[pIdx], g2 = pixels[pIdx+1], b2 = pixels[pIdx+2];
        const bri = edgeMap ? edgeMap[y2*cols+x2]/255 : (0.299*r2+0.587*g2+0.114*b2)/255;
        const adj2 = invertMode ? 1 - bri : bri;
        const ch2 = rampNow[Math.floor(adj2 * (rampNow.length - 1))] || ' ';
        if (ch2 === ' ') continue;
        recCtx.fillStyle = colorMode ? `rgb(${r2},${g2},${b2})` : (lightTheme ? '#000' : '#e7e7ee');
        recCtx.fillText(ch2, offsetX + x2 * size2 * 0.6, offsetY + y2 * lineH);
      }
    }
  }
  
  requestAnimationFrame(render);
}

// ── ITER 12: Screenshot — render HTML onto canvas and download
function screenshot() {
  const mainEl = document.querySelector('.main');
  const w = mainEl.clientWidth, h = mainEl.clientHeight;
  const size2 = parseFloat(output.style.fontSize) || 10;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  cx.fillStyle = lightTheme ? '#f8f9fa' : '#05050a';
  cx.fillRect(0, 0, w, h);
  cx.font = `500 ${size2}px 'JetBrains Mono',monospace`;
  cx.textBaseline = 'top';
  
  const spans = output.querySelectorAll('span');
  if (spans.length) {
    const rowCount = output.textContent.split('\n').length;
    const lineH = size2 * 0.95;
    const offsetX = (w - cols * size2 * 0.6) / 2;
    const offsetY = (h - rowCount * lineH) / 2;
    let col = 0, row = 0;
    spans.forEach(s => {
      const ch = s.textContent;
      if (ch === '\n') { row++; col = 0; return; }
      cx.fillStyle = s.style.color || (lightTheme ? '#000' : '#e7e7ee');
      cx.fillText(ch.replace(/\u00A0/g, ' '), offsetX + col * size2 * 0.6, offsetY + row * lineH);
      col++;
      if (col >= cols) { col = 0; row++; }
    });
  } else {
    const text = output.textContent;
    const lines = text.split('\n');
    const lineH = size2 * 0.95;
    const offsetX = (w - cols * size2 * 0.6) / 2;
    const offsetY = (h - lines.length * lineH) / 2;
    cx.fillStyle = lightTheme ? '#000' : '#e7e7ee';
    lines.forEach((line, i) => cx.fillText(line, offsetX, offsetY + i * lineH));
  }
  
  const link = document.createElement('a');
  link.download = `ascii-webcam-${Date.now()}.png`;
  link.href = c.toDataURL('image/png');
  link.click();
  toast('📸 Screenshot saved');
}

// ── ITER 13: copy ASCII to clipboard
async function copyASCII() {
  try {
    await navigator.clipboard.writeText(output.textContent);
    toast('📋 Copied to clipboard');
  } catch { toast('❌ Copy failed'); }
}

// ── ITER 14: toggle video recording (webm via MediaRecorder on recordCanvas)
function toggleRecord() {
  if (!isRecording) {
    recordedChunks = [];
    const stream = recordCanvas.captureStream(30);
    const opts = { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' };
    try { mediaRecorder = new MediaRecorder(stream, opts); } catch { toast('❌ Recording not supported'); return; }
    mediaRecorder.ondataavailable = e => e.data.size > 0 && recordedChunks.push(e.data);
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `ascii-webcam-${Date.now()}.webm`;
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    mediaRecorder.start();
    isRecording = true;
    $('recBtn').classList.add('btn-active');
    $('recDot').classList.add('show');
    toast('⏺ Recording…');
  } else {
    mediaRecorder.stop();
    isRecording = false;
    $('recBtn').classList.remove('btn-active');
    $('recDot').classList.remove('show');
    toast('💾 Video saved');
  }
}

// ── Controls wiring
$('resolution').oninput = e => {
  cols = +e.target.value;
  $('resVal').textContent = cols;
  localStorage.setItem('aw-res', cols);
};
$('charRamp').onchange = e => localStorage.setItem('aw-ramp', e.target.value);
$('effect').onchange = e => localStorage.setItem('aw-effect', e.target.value);
$('colorBtn').onclick = () => {
  colorMode = !colorMode;
  $('colorBtn').classList.toggle('btn-active', colorMode);
  $('colorBtn').textContent = colorMode ? '🎨 Color' : '◻ Mono';
  localStorage.setItem('aw-color', colorMode ? '1' : '0');
};
$('invertBtn').onclick = () => {
  invertMode = !invertMode;
  $('invertBtn').classList.toggle('btn-active', invertMode);
  localStorage.setItem('aw-invert', invertMode ? '1' : '0');
};
$('themeBtn').onclick = () => {
  lightTheme = !lightTheme;
  document.body.classList.toggle('light', lightTheme);
  localStorage.setItem('aw-theme', lightTheme ? 'light' : 'dark');
  $('themeBtn').textContent = lightTheme ? '🌙' : '☀';
};
$('snapBtn').onclick = screenshot;
$('copyBtn').onclick = copyASCII;
$('recBtn').onclick = toggleRecord;
$('fsBtn').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
};

// ── ITER 15: comprehensive keyboard shortcuts
addEventListener('keydown', e => {
  if (!running || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (k === 's') screenshot();
  else if (k === 'c') copyASCII();
  else if (k === 'r') toggleRecord();
  else if (k === 'f') $('fsBtn').click();
  else if (k === 't') $('themeBtn').click();
  else if (k === 'i') $('invertBtn').click();
  else if (k === 'm') $('colorBtn').click();
  else if (k === 'h') document.body.classList.toggle('hidden-ui');
  else if (k === 'arrowup') { cols = Math.min(240, cols + 10); $('resolution').value = cols; $('resVal').textContent = cols; }
  else if (k === 'arrowdown') { cols = Math.max(40, cols - 10); $('resolution').value = cols; $('resVal').textContent = cols; }
});

// ── Toast
function toast(msg) {
  let t = $('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast'; t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1600);
}
