const state = {
  token: sessionStorage.getItem('gtax_dashboard_token') || '',
  health: null,
  drive: {
    stack: [],
    folder: null,
    files: [],
    selected: null,
    search: '',
    nextPageToken: '',
    loadingMore: false
  },
  sheet: {
    spreadsheet: null,
    selectedSheet: '',
    range: '',
    grid: { headers: [], rows: [] },
    activeCell: null
  }
};

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value;
  }
}

function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(Number(bytes))) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes);
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatDate(iso) {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('de-DE');
}

function columnLetter(colIndex) {
  let idx = colIndex;
  let out = '';
  while (idx >= 0) {
    out = String.fromCharCode((idx % 26) + 65) + out;
    idx = Math.floor(idx / 26) - 1;
  }
  return out;
}

async function api(path, query = {}) {
  const url = new URL(path, window.location.origin);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const headers = {};
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const res = await fetch(url, {
    method: 'GET',
    headers,
    cache: 'no-store'
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    const detail = json.error || `${res.status} ${res.statusText}`;
    throw new Error(detail);
  }

  return json;
}

async function fetchAuthorizedBlob(path, query = {}) {
  const url = new URL(path, window.location.origin);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const headers = {};
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const res = await fetch(url, {
    method: 'GET',
    headers,
    cache: 'no-store'
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || `${res.status} ${res.statusText}`);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const fileNameMatch = disposition.match(/filename=\"?([^\";]+)\"?/i);
  const fileName = fileNameMatch ? fileNameMatch[1] : 'file.bin';

  return { blob, fileName };
}

function switchView(view) {
  document.querySelectorAll('.view').forEach((el) => {
    el.classList.toggle('active', el.id === `${view}-view`);
  });
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.remove('active');
  });
  document.getElementById(`view-${view}`).classList.add('active');
}

function renderHealth(health) {
  const chip = document.getElementById('health-chip');
  if (!chip) return;

  const success = Boolean(health && health.ok);
  chip.classList.remove('warning', 'success');
  chip.classList.add(success ? 'success' : 'warning');
  chip.textContent = success ? 'Connected' : 'Attention';

  setText('session-status', success ? 'Online' : 'Fehler');
}

function pushCurrentFolderToStack() {
  const folder = state.drive.folder;
  if (!folder) return;
  const idx = state.drive.stack.findIndex((item) => item.id === folder.id);
  if (idx >= 0) {
    state.drive.stack = state.drive.stack.slice(0, idx + 1);
    return;
  }
  state.drive.stack.push({ id: folder.id, name: folder.name || 'Ordner' });
}

function renderBreadcrumb() {
  const host = document.getElementById('drive-breadcrumb');
  host.innerHTML = '';

  state.drive.stack.forEach((item, idx) => {
    const btn = document.createElement('button');
    btn.className = `crumb ${idx === state.drive.stack.length - 1 ? 'active' : ''}`;
    btn.textContent = item.name;
    btn.addEventListener('click', async () => {
      state.drive.stack = state.drive.stack.slice(0, idx + 1);
      await loadDrive(item.id, false);
    });
    host.appendChild(btn);
  });
}

function fileIcon(mimeType, isFolder) {
  if (isFolder) return '[DIR]';
  if (mimeType.includes('spreadsheet')) return '[XLS]';
  if (mimeType.includes('document')) return '[DOC]';
  if (mimeType.includes('presentation')) return '[PPT]';
  if (mimeType.includes('image')) return '[IMG]';
  if (mimeType.includes('pdf')) return '[PDF]';
  return '[FILE]';
}

function renderDriveRows() {
  const body = document.getElementById('drive-rows');
  body.innerHTML = '';

  state.drive.files.forEach((file) => {
    const tr = document.createElement('tr');
    tr.className = 'drive-row';
    if (state.drive.selected && state.drive.selected.id === file.id) {
      tr.classList.add('selected');
    }

    tr.innerHTML = `
      <td>
        <span class="file-name">
          <span class="file-icon">${fileIcon(file.mimeType, file.isFolder)}</span>
          <span>${file.name}</span>
        </span>
      </td>
      <td>${file.isFolder ? 'Ordner' : file.mimeType}</td>
      <td>${formatDate(file.modifiedTime)}</td>
      <td>${file.isFolder ? '-' : formatBytes(file.size)}</td>
    `;

    tr.addEventListener('click', () => {
      state.drive.selected = file;
      renderDriveRows();
      renderDetails();
    });

    tr.addEventListener('dblclick', async () => {
      if (file.isFolder) {
        state.drive.stack.push({ id: file.id, name: file.name });
        await loadDrive(file.id, false);
      } else {
        openSelectedFile(false);
      }
    });

    body.appendChild(tr);
  });

  setText('drive-file-count', String(state.drive.files.length));
}

function renderDetails() {
  const host = document.getElementById('file-details');
  const selected = state.drive.selected;

  const openBtn = document.getElementById('open-file-btn');
  const dlBtn = document.getElementById('download-file-btn');

  if (!selected) {
    host.classList.add('empty');
    host.textContent = 'Keine Datei ausgewaehlt';
    openBtn.disabled = true;
    dlBtn.disabled = true;
    return;
  }

  host.classList.remove('empty');
  host.innerHTML = `
    <dl>
      <dt>Name</dt><dd>${selected.name}</dd>
      <dt>Typ</dt><dd>${selected.isFolder ? 'Ordner' : selected.mimeType}</dd>
      <dt>Owner</dt><dd>${selected.owner || '-'}</dd>
      <dt>Geaendert</dt><dd>${formatDate(selected.modifiedTime)}</dd>
      <dt>Groesse</dt><dd>${selected.isFolder ? '-' : formatBytes(selected.size)}</dd>
      <dt>Download</dt><dd>${selected.capabilities && selected.capabilities.canDownload === false ? 'gesperrt' : 'erlaubt'}</dd>
      <dt>ID</dt><dd><code>${selected.id}</code></dd>
    </dl>
  `;

  openBtn.disabled = false;
  dlBtn.disabled = false;
}

function updateDriveMoreButton() {
  const btn = document.getElementById('drive-more-btn');
  if (!btn) return;

  const hasMore = Boolean(state.drive.nextPageToken);
  btn.disabled = state.drive.loadingMore || !hasMore;
  btn.textContent = state.drive.loadingMore
    ? 'Laedt...'
    : (hasMore ? 'Mehr laden' : 'Keine weiteren Dateien');
}

async function loadDrive(folderId, updateStack = true, append = false) {
  if (append && !state.drive.nextPageToken) {
    updateDriveMoreButton();
    return;
  }

  const effectiveFolderId = folderId || (state.drive.folder ? state.drive.folder.id : undefined);
  state.drive.loadingMore = append;
  updateDriveMoreButton();

  try {
    const data = await api('/api/drive', {
      folderId: effectiveFolderId,
      pageToken: append ? state.drive.nextPageToken : undefined,
      search: state.drive.search || undefined,
      limit: 120
    });

    state.drive.folder = data.folder;
    state.drive.nextPageToken = data.nextPageToken || '';

    if (append) {
      const seen = new Set(state.drive.files.map((file) => file.id));
      (data.files || []).forEach((file) => {
        if (!seen.has(file.id)) {
          state.drive.files.push(file);
          seen.add(file.id);
        }
      });
    } else {
      state.drive.files = data.files || [];
      state.drive.selected = null;
    }

    if (!append) {
      if (updateStack) {
        pushCurrentFolderToStack();
      } else if (state.drive.stack.length === 0 && state.drive.folder) {
        state.drive.stack.push({ id: state.drive.folder.id, name: state.drive.folder.name });
      }
    }

    setText('drive-folder-name', data.folder ? data.folder.name : '-');
    renderBreadcrumb();
    renderDriveRows();
    renderDetails();
  } finally {
    state.drive.loadingMore = false;
    updateDriveMoreButton();
  }
}

async function openSelectedFile(forceDownload) {
  const selected = state.drive.selected;
  if (!selected) return;

  if (selected.isFolder) {
    state.drive.stack.push({ id: selected.id, name: selected.name });
    await loadDrive(selected.id, false);
    return;
  }

  const isGoogleNative = selected.mimeType.startsWith('application/vnd.google-apps.');
  const endpoint = isGoogleNative ? '/api/drive-export' : '/api/drive-content';

  try {
    const { blob, fileName } = await fetchAuthorizedBlob(endpoint, { fileId: selected.id });
    const objectUrl = URL.createObjectURL(blob);

    if (forceDownload) {
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      window.open(objectUrl, '_blank', 'noopener');
    }

    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    alert(`Datei konnte nicht geladen werden: ${error.message}`);
  }
}

function renderSheetTabs() {
  const host = document.getElementById('sheet-tabs');
  host.innerHTML = '';

  const sheets = state.sheet.spreadsheet && state.sheet.spreadsheet.sheets
    ? state.sheet.spreadsheet.sheets
    : [];

  sheets.forEach((sheet) => {
    const btn = document.createElement('button');
    btn.className = `tab ${sheet.title === state.sheet.selectedSheet ? 'active' : ''}`;
    btn.textContent = sheet.title;
    btn.addEventListener('click', async () => {
      await loadSheet(sheet.title);
    });
    host.appendChild(btn);
  });
}

function renderSheetGrid() {
  const head = document.getElementById('sheet-head');
  const body = document.getElementById('sheet-body');

  head.innerHTML = '';
  body.innerHTML = '';

  const headers = state.sheet.grid.headers || [];
  const rows = state.sheet.grid.rows || [];

  const trHead = document.createElement('tr');
  trHead.innerHTML = '<th class="row-index"></th>';
  headers.forEach((_, idx) => {
    const th = document.createElement('th');
    th.textContent = columnLetter(idx);
    trHead.appendChild(th);
  });
  head.appendChild(trHead);

  rows.forEach((row, rowIdx) => {
    const tr = document.createElement('tr');

    const indexCell = document.createElement('td');
    indexCell.className = 'row-index';
    indexCell.textContent = String(rowIdx + 1);
    tr.appendChild(indexCell);

    row.forEach((value, colIdx) => {
      const td = document.createElement('td');
      td.textContent = value;
      td.dataset.row = String(rowIdx + 1);
      td.dataset.col = String(colIdx + 1);

      td.addEventListener('click', () => {
        document.querySelectorAll('#sheet-grid td.active-cell').forEach((el) => el.classList.remove('active-cell'));
        td.classList.add('active-cell');

        const cellLabel = `${columnLetter(colIdx)}${rowIdx + 1}`;
        const shownValue = String(value || '');
        document.getElementById('formula-value').value = `${cellLabel} = ${shownValue}`;
      });

      tr.appendChild(td);
    });

    body.appendChild(tr);
  });

  setText('sheet-row-count', String(rows.length));
}

async function loadSheet(sheetTitle) {
  const data = await api('/api/sheet', {
    sheet: sheetTitle,
    limitRows: 400,
    limitCols: 26
  });

  state.sheet.spreadsheet = data.spreadsheet;
  state.sheet.selectedSheet = data.selectedSheet;
  state.sheet.range = data.range;
  state.sheet.grid = data.grid;

  setText('sheet-title', `${data.spreadsheet.title} / ${data.selectedSheet}`);
  setText('sheet-range', data.range);

  renderSheetTabs();
  renderSheetGrid();
}

async function runSheetBatchPreview() {
  try {
    const response = await api('/api/sheet-batch', {
      ranges: `${state.sheet.selectedSheet}!A1:C6,${state.sheet.selectedSheet}!D1:F6`
    });

    const rows = response.valueRanges && response.valueRanges[0] && response.valueRanges[0].values
      ? response.valueRanges[0].values.length
      : 0;

    document.getElementById('formula-value').value = `batchGet OK: ${response.valueRanges.length} ranges, range1 rows=${rows}`;
  } catch (error) {
    document.getElementById('formula-value').value = `batchGet Fehler: ${error.message}`;
  }
}

async function boot() {
  try {
    switchView('drive');

    const health = await api('/api/health');
    state.health = health;
    renderHealth(health);

    await loadDrive(undefined, true);
    await loadSheet('');
  } catch (error) {
    setText('session-status', 'Fehler');
    const chip = document.getElementById('health-chip');
    chip.classList.remove('success');
    chip.classList.add('warning');
    chip.textContent = 'Error';
    alert(`Init fehlgeschlagen: ${error.message}`);
  }
}

function wireEvents() {
  document.getElementById('view-drive').addEventListener('click', () => switchView('drive'));
  document.getElementById('view-sheets').addEventListener('click', () => switchView('sheets'));

  document.getElementById('refresh-all').addEventListener('click', async () => {
    await boot();
  });

  document.getElementById('drive-search-btn').addEventListener('click', async () => {
    state.drive.search = document.getElementById('drive-search').value.trim();
    await loadDrive(state.drive.folder ? state.drive.folder.id : undefined, false);
  });
  document.getElementById('drive-search').addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      state.drive.search = document.getElementById('drive-search').value.trim();
      await loadDrive(state.drive.folder ? state.drive.folder.id : undefined, false);
    }
  });
  document.getElementById('drive-more-btn').addEventListener('click', async () => {
    await loadDrive(state.drive.folder ? state.drive.folder.id : undefined, false, true);
  });

  document.getElementById('drive-reset-btn').addEventListener('click', async () => {
    document.getElementById('drive-search').value = '';
    state.drive.search = '';
    if (state.drive.stack.length > 0) {
      const root = state.drive.stack[0];
      state.drive.stack = [root];
      await loadDrive(root.id, false);
    } else {
      await loadDrive(undefined, true);
    }
  });

  document.getElementById('open-file-btn').addEventListener('click', async () => {
    await openSelectedFile(false);
  });
  document.getElementById('download-file-btn').addEventListener('click', async () => {
    await openSelectedFile(true);
  });

  document.getElementById('sheet-refresh-btn').addEventListener('click', async () => {
    await loadSheet(state.sheet.selectedSheet);
  });

  document.getElementById('sheet-batch-btn').addEventListener('click', async () => {
    await runSheetBatchPreview();
  });

  document.getElementById('save-token-btn').addEventListener('click', async () => {
    const value = document.getElementById('api-token').value.trim();
    state.token = value;
    if (value) {
      sessionStorage.setItem('gtax_dashboard_token', value);
    } else {
      sessionStorage.removeItem('gtax_dashboard_token');
    }
    await boot();
  });

  updateDriveMoreButton();
}

document.getElementById('api-token').value = state.token;
wireEvents();
boot();
