const BASE = '';
let BASE_URL = window.location.origin;

(async () => {
  try {
    const urls = await api('/api/urls');
    BASE_URL = urls.baseUrl;
  } catch (e) {
    console.warn('Failed to fetch URLs, using defaults');
  }
  document.getElementById('url-mcp').textContent = `${BASE_URL}/mcp`;
})();

function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelector(`nav button[onclick="switchTab('${name}')"]`).classList.add('active');
  if (location.hash !== '#' + name) history.pushState(null, '', '#' + name);
  if (name === 'contacts') fetchContacts();
}

const validTabs = ['server', 'tools', 'contacts', 'log'];
window.addEventListener('hashchange', () => {
  const tab = location.hash.slice(1);
  if (validTabs.includes(tab)) switchTab(tab);
});
if (validTabs.includes(location.hash.slice(1))) switchTab(location.hash.slice(1));

let currentState = null;
let lastLogLength = 0;


document.querySelectorAll('input[name="authMode"]').forEach(radio => {
  radio.addEventListener('change', async (e) => {
    const mode = e.target.value;
    await api('/api/auth-mode', { mode });
    updateAuthUI(mode);
  });
});

const authDescs = {
  none: 'No auth. All requests accepted. YOLO.',
  bearer: 'Require Authorization: Bearer <token> on every request.',
  oauth: 'Full OAuth 2.1 flow. The /authorize endpoint shows a consent page where you can approve, decline, send a wrong code, or send a wrong state.',
};

function updateAuthUI(mode) {
  document.getElementById('bearer-config').style.display = mode === 'bearer' ? 'block' : 'none';
  document.getElementById('oauth-config').style.display = mode === 'oauth' ? 'block' : 'none';
  document.getElementById('auth-badge').textContent = 'auth: ' + mode;
  document.getElementById('auth-desc').textContent = authDescs[mode] || '';
  if (mode === 'oauth') {
    document.getElementById('oauth-discovery').textContent = `${BASE_URL}/.well-known/oauth-authorization-server`;
    document.getElementById('oauth-authorize').textContent = `${BASE_URL}/oauth/authorize`;
    document.getElementById('oauth-token').textContent = `${BASE_URL}/oauth/token`;
    document.getElementById('oauth-register').textContent = `${BASE_URL}/oauth/register`;
  }
}

async function updateBearerToken() {
  const token = document.getElementById('bearer-token').value;
  await api('/api/bearer-token', { token });
}

async function resetDb() { await api('/api/reset-db', {}); fetchContacts(); }

async function clearLog() {
  await api('/api/clear-log', {});
  document.getElementById('log-container').innerHTML = '';
  lastLogLength = 0;
}

async function setRejectAuth(target, mode) { await api('/api/reject-auth', { target, mode }); }

async function toggleSlowMode(enabled) {
  const minMs = parseInt(document.getElementById('slow-min').value) || 0;
  const maxMs = parseInt(document.getElementById('slow-max').value) || 0;
  await api('/api/slow-mode', { enabled, minMs, maxMs });
}

async function updateSlowRange() {
  const minMs = parseInt(document.getElementById('slow-min').value) || 0;
  const maxMs = parseInt(document.getElementById('slow-max').value) || 0;
  await api('/api/slow-mode', { minMs, maxMs });
}

async function updateOAuthSettings() {
  const accessTokenTtlSecs = parseInt(document.getElementById('access-token-ttl').value) || 60;
  const failOAuthRefresh = document.getElementById('fail-oauth-refresh').checked;
  const strictRefreshTokens = document.getElementById('strict-refresh-tokens').checked;
  await api('/api/oauth-settings', { accessTokenTtlSecs, failOAuthRefresh, strictRefreshTokens });
}

async function toggleFlakyTools(enabled) {
  const pct = parseInt(document.getElementById('flaky-pct').value) || 0;
  await api('/api/flaky-tools', { enabled, pct });
}

async function updateFlakyPct() {
  const pct = parseInt(document.getElementById('flaky-pct').value) || 0;
  await api('/api/flaky-tools', { pct });
}

async function toggleTool(name, enabled) { await api('/api/tool-toggle', { toolName: name, enabled }); }

async function setToolVersion(name, version) { await api('/api/tool-version', { toolName: name, version }); }

function renderTools(tools) {
  const container = document.getElementById('tools-list');
  container.innerHTML = tools.map(tool => {
    const schemaKeys = tool.params && tool.params.length ? tool.params.join(', ') : 'none';
    return `
      <div class="section">
        <div class="tool-row">
          <label class="toggle">
            <input type="checkbox" ${tool.enabled ? 'checked' : ''}
              onchange="toggleTool('${tool.name}', this.checked)">
            <span class="slider"></span>
          </label>
          <span class="tool-name">${tool.name}</span>
          ${tool.hasVersions ? `
            <select onchange="setToolVersion('${tool.name}', this.value)">
              <option value="v1" ${tool.currentVersion === 'v1' ? 'selected' : ''}>v1</option>
              <option value="v2" ${tool.currentVersion === 'v2' ? 'selected' : ''}>v2</option>
            </select>
          ` : ''}
        </div>
        <div class="tool-schema">params: { ${schemaKeys} }</div>
      </div>
    `;
  }).join('');
}

function renderLog(entries) {
  const container = document.getElementById('log-container');
  const newEntries = entries.slice(lastLogLength);
  for (const entry of newEntries) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const src = entry.source || 'mcp';
    const status = entry.status || '';
    const statusClass = status ? `s${Math.floor(status / 100)}xx` : '';
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    let rpcHtml = '';
    if (entry.rpcMethod) {
      rpcHtml += `<span class="log-rpc">${esc(entry.rpcMethod)}</span>`;
      if (entry.toolName) {
        rpcHtml += `<span class="log-tool">${esc(entry.toolName)}</span>`;
      }
    } else if (entry.source === 'sse') {
      const label = entry.rpcMethod || 'message';
      rpcHtml = `<span class="log-rpc">${esc(label)}</span>`;
      if (entry.rpcId !== undefined) rpcHtml += `<span class="log-args" onclick="this.classList.toggle('expanded')">id=${esc(entry.rpcId)}</span>`;
    } else if (entry.source === 'mcp' && entry.method === 'DELETE') {
      rpcHtml = `<span class="log-rpc" style="color:#8b949e">session close</span>`;
    } else if (entry.source === 'mcp' && entry.method === 'GET') {
      rpcHtml = `<span class="log-rpc" style="color:#8b949e">notification stream</span>`;
    }
    let argsHtml = '';
    if (entry.toolArgs) {
      argsHtml = `<span class="log-args" onclick="this.classList.toggle('expanded')" title="${esc(entry.toolArgs)}">${esc(entry.toolArgs)}</span>`;
    }
    let extraHtml = '';
    if (entry.query) {
      extraHtml += `<span class="log-args" onclick="this.classList.toggle('expanded')" title="${esc(entry.query)}"><span style="color:#8b949e">?</span>${esc(entry.query)}</span>`;
    }
    if (entry.body) {
      extraHtml += `<span class="log-args" onclick="this.classList.toggle('expanded')" title="${esc(entry.body)}"><span style="color:#8b949e">body:</span> ${esc(entry.body)}</span>`;
    }
    div.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-source ${src}">${src}</span>
      <span class="log-method ${entry.method}">${entry.method}</span>
      ${status ? `<span class="log-status ${statusClass}">${status}</span>` : ''}
      <span>${entry.path}</span>
      ${rpcHtml}
      ${entry.sessionId ? `<span class="log-session">${entry.sessionId.slice(0, 8)}</span>` : ''}
      ${argsHtml}
      ${extraHtml}
    `;
    container.prepend(div);
  }
  lastLogLength = entries.length;
}

async function fetchContacts() {
  const data = await api('/api/contacts');
  const container = document.getElementById('contacts-table');
  if (!data.contacts || data.contacts.length === 0) {
    container.innerHTML = '<div class="empty-state">No contacts. Use the create-contact tool to add some.</div>';
    return;
  }
  container.innerHTML = `
    <table>
      <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Company</th><th>Notes</th><th>Created</th></tr></thead>
      <tbody>
        ${data.contacts.map(c => `
          <tr>
            <td class="id-col">${c.id}</td>
            <td>${esc(c.name)}</td>
            <td>${esc(c.email)}</td>
            <td>${esc(c.company)}</td>
            <td class="notes-col" title="${esc(c.notes)}">${esc(c.notes)}</td>
            <td class="date-col">${c.created_at}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

async function api(path, body) {
  const opts = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
  const res = await fetch(BASE + path, opts);
  return res.json();
}

async function poll() {
  try {
    const [state, log] = await Promise.all([
      api('/api/state'),
      api('/api/log'),
    ]);

    currentState = state;
    document.getElementById('session-count').textContent = `${state.sessionCount} session${state.sessionCount !== 1 ? 's' : ''}`;

    const radio = document.querySelector(`input[name="authMode"][value="${state.authMode}"]`);
    if (radio && !radio.checked) {
      radio.checked = true;
      updateAuthUI(state.authMode);
    }

    const rejectBearerRadio = document.querySelector(`input[name="rejectBearer"][value="${state.rejectBearer}"]`);
    if (rejectBearerRadio && !rejectBearerRadio.checked) rejectBearerRadio.checked = true;
    const rejectOAuthRadio = document.querySelector(`input[name="rejectOAuth"][value="${state.rejectOAuth}"]`);
    if (rejectOAuthRadio && !rejectOAuthRadio.checked) rejectOAuthRadio.checked = true;
    const slowCb = document.getElementById('slow-mode');
    if (slowCb && slowCb.checked !== state.slowMode) slowCb.checked = state.slowMode;
    const slowMin = document.getElementById('slow-min');
    if (slowMin && document.activeElement !== slowMin) slowMin.value = state.slowMinMs;
    const slowMax = document.getElementById('slow-max');
    if (slowMax && document.activeElement !== slowMax) slowMax.value = state.slowMaxMs;
    const flakyCb = document.getElementById('flaky-tools');
    if (flakyCb && flakyCb.checked !== state.flakyTools) flakyCb.checked = state.flakyTools;
    const flakyPct = document.getElementById('flaky-pct');
    if (flakyPct && document.activeElement !== flakyPct) flakyPct.value = state.flakyPct;
    const ttlInput = document.getElementById('access-token-ttl');
    if (ttlInput && document.activeElement !== ttlInput) ttlInput.value = state.accessTokenTtlSecs;
    const failRefreshCb = document.getElementById('fail-oauth-refresh');
    if (failRefreshCb && failRefreshCb.checked !== state.failOAuthRefresh) failRefreshCb.checked = state.failOAuthRefresh;
    const strictRefreshCb = document.getElementById('strict-refresh-tokens');
    if (strictRefreshCb && strictRefreshCb.checked !== state.strictRefreshTokens) strictRefreshCb.checked = state.strictRefreshTokens;

    if (state.tools) renderTools(state.tools);
    if (log.entries) renderLog(log.entries);

    if (document.getElementById('tab-contacts').classList.contains('active')) {
      fetchContacts();
    }
  } catch (e) {
    document.getElementById('status-dot').className = 'status-dot inactive';
  }
}

poll();
setInterval(poll, 2000);
