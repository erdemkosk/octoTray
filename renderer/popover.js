const $ = (id) => document.getElementById(id);

function prettifyToolName(name) {
  if (name === 'chamber') return 'Chamber';
  const m = /^tool(\d+)$/i.exec(name);
  if (!m) return name;
  const n = Number(m[1]);
  return n === 0 ? 'Hotend' : `Hotend ${n + 1}`;
}

/** Ignore OctoPrint extras (e.g. stray keys like "w") that would render as a bogus row. */
function isPrinterTempHead(name) {
  return /^tool\d+$/i.test(name) || name === 'chamber';
}

function formatSeconds(sec) {
  if (sec == null || Number.isNaN(sec) || sec < 0) return '—';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(r).padStart(2, '0')}s`;
  return `${r}s`;
}

/**
 * Progress toward setpoint (like job %): 100% when within ~0.5°C of target.
 * Heating (actual <= target): actual/target. Cooling (actual > target): target/actual.
 */
function towardSetpointPercent(actual, target) {
  if (target == null || target <= 0) return null;
  const a = Math.max(0, Number(actual) || 0);
  const t = Number(target);
  if (Math.abs(a - t) < 0.5) return 100;
  if (a <= t) return Math.min(100, (a / t) * 100);
  return Math.min(100, (t / a) * 100);
}

function tempBarFillStyle(actual, target) {
  const pct = towardSetpointPercent(actual, target);
  if (pct == null) {
    return { width: '0%', background: 'rgba(140, 140, 140, 0.35)' };
  }
  const a = Number(actual) || 0;
  const t = Number(target) || 0;
  const atTemp = Math.abs(a - t) < 0.5;
  let bg;
  if (atTemp) {
    bg = '#e53935';
  } else {
    const u = pct / 100;
    const h = 210 * (1 - u);
    bg = `hsl(${h.toFixed(0)}, 78%, ${Math.round(42 + u * 12)}%)`;
  }
  return { width: `${pct.toFixed(1)}%`, background: bg };
}

/** CSP blocks inline style="" on injected HTML; set via JS instead. */
function applyTempBarFill(row, fillStyle) {
  const fill = row.querySelector('.temp-bar-fill');
  if (!fill) return;
  fill.style.width = fillStyle.width;
  fill.style.background = fillStyle.background;
}

function scheduleResizePopover() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const doc = document.documentElement;
      const h = Math.ceil(
        Math.max(doc.scrollHeight, doc.offsetHeight, document.body?.scrollHeight || 0)
      );
      if (h > 0 && window.octotray?.setPopoverHeight) {
        window.octotray.setPopoverHeight(h);
      }
    });
  });
}

function render(snapshot) {
  const errBox = $('errorBox');
  const errText = $('errorText');

  if (snapshot.error) {
    errBox.classList.remove('hidden');
    errText.textContent = snapshot.error;
  } else {
    errBox.classList.add('hidden');
  }

  $('hostLine').textContent = snapshot.baseUrl
    ? snapshot.baseUrl.replace(/^https?:\/\//, '')
    : '';

  const printer = snapshot.printer;
  const job = snapshot.job;

  $('stateText').textContent = printer?.state?.text ?? (snapshot.error ? '—' : 'Unknown');

  const tempsEl = $('temps');
  tempsEl.innerHTML = '';

  const bed = printer?.temperature?.bed;
  if (bed && (bed.actual != null || bed.target != null)) {
    const act = bed.actual != null ? Math.round(bed.actual) : '—';
    const tgt = bed.target != null && bed.target > 0 ? Math.round(bed.target) : 'off';
    const bedPct = towardSetpointPercent(bed.actual, bed.target);
    const bedFill = tempBarFillStyle(bed.actual, bed.target);
    const pctLabel = bedPct != null ? ` · ${Math.round(bedPct)}%` : '';
    const row = document.createElement('div');
    row.className = 'temp-block bed';
    row.innerHTML = `
      <div class="temp-head">
        <span class="temp-name">Bed</span>
        <span class="temp-nums"><strong>${act}°C</strong> · target ${typeof tgt === 'number' ? `${tgt}°C` : tgt}${pctLabel}</span>
      </div>
      <div class="temp-bar"><span class="temp-bar-fill"></span></div>
    `;
    applyTempBarFill(row, bedFill);
    tempsEl.appendChild(row);
  }

  const temp = printer?.temperature;
  if (temp && typeof temp === 'object') {
    for (const [name, data] of Object.entries(temp)) {
      if (name === 'bed' || !data || typeof data !== 'object') continue;
      if (!isPrinterTempHead(name)) continue;
      const actual = data.actual;
      const target = data.target;
      if (actual == null && target == null) continue;
      const act = actual != null ? Math.round(actual) : '—';
      const tgt = target != null && target > 0 ? Math.round(target) : 'off';
      const tp = towardSetpointPercent(actual, target);
      const tf = tempBarFillStyle(actual, target);
      const pLab = tp != null ? ` · ${Math.round(tp)}%` : '';
      const row = document.createElement('div');
      row.className = 'temp-block tool';
      row.innerHTML = `
        <div class="temp-head">
          <span class="temp-name">${prettifyToolName(name)}</span>
          <span class="temp-nums"><strong>${act}°C</strong> · target ${typeof tgt === 'number' ? `${tgt}°C` : tgt}${pLab}</span>
        </div>
        <div class="temp-bar"><span class="temp-bar-fill"></span></div>
      `;
      applyTempBarFill(row, tf);
      tempsEl.appendChild(row);
    }
  }

  if (!tempsEl.children.length) {
    const empty = document.createElement('p');
    empty.className = 'muted small';
    empty.style.margin = '0';
    empty.textContent = 'No temperature data.';
    tempsEl.appendChild(empty);
  }

  const file = job?.job?.file?.name;
  $('fileName').textContent = file || 'No active job';

  const p = job?.progress;
  const pct = p && typeof p.completion === 'number' ? Math.max(0, Math.min(100, p.completion)) : 0;
  $('progressBar').style.width = `${pct}%`;
  $('progressPct').textContent = `${pct.toFixed(1)}%`;

  const left = p?.printTimeLeft;
  const elapsed = p?.printTime;
  $('timeLine').textContent =
    left != null || elapsed != null
      ? `${formatSeconds(elapsed)} elapsed · ${formatSeconds(left)} remaining`
      : '—';

  const sec = (snapshot.pollIntervalMs || 5000) / 1000;
  const pollLabel = Number.isInteger(sec) ? `${sec}s` : `${sec.toFixed(1)}s`;
  $('pollLine').textContent = `Updates every ${pollLabel}`;

  scheduleResizePopover();
}

async function bindBrandLogo() {
  const img = document.querySelector('.brand-logo');
  if (!img || !window.octotray?.getTrayLogoUrls) return;
  const { src, srcset } = await window.octotray.getTrayLogoUrls();
  if (src) {
    img.src = src;
    if (srcset) img.srcset = srcset;
    else img.removeAttribute('srcset');
  }
}

async function init() {
  await bindBrandLogo();
  const o = window.octotray;
  render(await o.getStatus());
  o.onStatusUpdate((snap) => render(snap));
  $('btnClose').addEventListener('click', () => window.close());
}

init();
