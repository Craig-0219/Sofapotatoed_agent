const $ = selector => document.querySelector(selector);
let store = { accounts: [], agents: [], tasks: [], messages: [], events: [] };
let selected = null;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const format = value => new Date(value).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
const role = agent => agent.role === 'lead' ? 'SUPERVISOR' : 'ASSISTANT';
const emoji = agent => agent.role === 'lead' ? '👨‍💻' : '🧑‍💼';
const getAgent = id => store.agents.find(a => a.id === id);
const getAccount = id => store.accounts.find(a => a.id === id);
const owner = a => a.role === 'lead' ? a : getAgent(a.parentId);
async function api(path, method = 'GET', body) {
  const response = await fetch(path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  if (!response.ok) throw Error(json.error || response.statusText);
  return json;
}
function agentOptions(list) {
  return list.map(a => `<option value="${esc(a.id)}">${esc(a.name)} · ${role(a)} · ${esc(a.accountLabel)}</option>`).join('');
}
function render() {
  const agents = store.agents;
  const leads = agents.filter(a => a.role === 'lead');
  const workers = agents.filter(a => a.role === 'assistant');
  $('#agentCount').textContent = String(agents.length).padStart(2, '0');
  $('#leadCount').textContent = `${leads.length} SUPERVISORS`;
  $('#workerCount').textContent = `${workers.length} ASSISTANTS`;
  $('#taskCount').textContent = String(store.tasks.length).padStart(2, '0');
  $('#agentList').innerHTML = agents.length ? agents.map(a => `
    <div class="agentListItem ${selected === a.id ? 'selected' : ''}" data-agent="${esc(a.id)}">
      <span class="avatar">${emoji(a)}</span><div><b>${esc(a.name)}</b>
      <small>${role(a)} / ${esc(a.provider)}</small>
      <small>${esc(a.role === 'lead' ? a.accountLabel : '↳ ' + owner(a)?.name)}</small>
    </div></div>`).join('') : '<div class="empty">NO SUPERVISORS YET<br>先綁定第一個帳號</div>';
  $('#office').innerHTML = agents.slice(0, 8).map(a => `
    <button class="desk ${esc(a.role)} ${selected === a.id ? 'selected' : ''}" data-agent="${esc(a.id)}" title="${esc(a.name)}">
      <span class="sprite">${emoji(a)}</span><span class="name">${esc(a.name)}</span>
      <small>${role(a)}</small>
    </button>`).join('') + Array.from({ length: Math.max(0, 8 - agents.length) }, () =>
      '<div class="desk"><span class="sprite">🪴</span><span class="name">VACANT</span><small>OFFLINE</small></div>').join('');
  const preserve = (selector, html) => {
    const el = $(selector), previous = el.value;
    el.innerHTML = html;
    if ([...el.options].some(option => option.value === previous)) el.value = previous;
  };
  preserve('#taskAgent', '<option value="">SELECT AGENT</option>' + agentOptions(agents));
  preserve('#fromAgent', agentOptions(agents));
  preserve('#toAgent', agentOptions(agents));
  $('#taskList').innerHTML = store.tasks.slice(0, 16).map(t => `
    <div class="task"><b>${esc(t.title)}</b><em>${esc(t.status.toUpperCase())}</em>
      · ${esc(getAgent(t.agentId)?.name || '?')}<p>${esc(t.result || 'Waiting for execution...')}</p>
    </div>`).join('') || '<div class="empty">NO TASKS</div>';
  $('#feed').innerHTML = store.events.slice(0, 25).map(e =>
    `<div class="feedItem"><time>${format(e.at)} // ${esc(e.kind.toUpperCase())}</time>${esc(e.text)}</div>`).join('') || '<div class="empty">NO ACTIVITY</div>';
  renderDetails();
}
function renderDetails() {
  const agent = getAgent(selected);
  if (!agent) { $('#detail').innerHTML = '<div class="empty">SELECT AN AGENT<br>TO INSPECT PROFILE</div>'; return; }
  const binding = getAccount(agent.accountId);
  const teamOwner = owner(agent);
  $('#detail').innerHTML = `
    <div class="profile"><h2>${emoji(agent)} ${esc(agent.name)}</h2>
      <small>${role(agent)} · ${esc(agent.provider)}</small><div>
      <span class="tag">${agent.role === 'lead' ? 'ACCOUNT OWNER' : 'INHERITED ACCOUNT'}</span>
      <span class="tag">${esc(binding?.label || 'Account unavailable')}</span></div>
      ${agent.role === 'lead' ? '<p>此主管由帳號綁定建立。綁定不代表已完成 CLI 登入。</p>' : `<p>所屬主管：${esc(teamOwner?.name)}。不可使用其他主管的帳號。</p>`}
      <label>SOUL.MD<textarea id="soulEditor" rows="7">${esc(agent.soul)}</textarea></label>
      <button class="secondary" id="saveSoul">SAVE SOUL.MD</button>
      <label>SKILLS (one per line)<textarea id="skillsEditor" rows="2">${esc(agent.skills.join('\n'))}</textarea></label>
      <button class="secondary" id="saveSkills">SAVE SKILLS</button>
      <label>MCP SERVER REFERENCES (one per line)<textarea id="mcpEditor" rows="2">${esc(agent.mcp.join('\n'))}</textarea></label>
      <button class="secondary" id="saveMcp">SAVE MCP REFERENCES</button>
      ${agent.role === 'lead' ? '<button class="primary" id="hireWorker">＋ CREATE ASSISTANT</button>' : ''}
      <p>SKILLS / MCP are references only; live execution is a future milestone.</p>
    </div>`;
  $('#saveSoul').onclick = () => updateProfile('soul', { soul: $('#soulEditor').value });
  $('#saveSkills').onclick = () => updateProfile('skills', { items: $('#skillsEditor').value.split('\n').filter(Boolean) });
  $('#saveMcp').onclick = () => updateProfile('mcp', { items: $('#mcpEditor').value.split('\n').filter(Boolean) });
  if (agent.role === 'lead') $('#hireWorker').onclick = () => openAssistantDialog(agent.id);
}
async function updateProfile(type, payload) {
  try { await api(`/api/agents/${selected}/${type}`, 'PUT', payload); await refresh(); }
  catch (error) { alert(error.message); }
}
function toggleAccountFields() {
  const provider = $('#accountProvider').value;
  $('#accountHomeGroup').hidden = !['codex', 'claude'].includes(provider);
  $('#apiSecretGroup').hidden = provider !== 'openai-compatible';
  $('#apiEndpointGroup').hidden = provider !== 'openai-compatible';
}
function openAccountDialog() {
  $('#accountForm').reset(); $('#accountError').textContent = '';
  toggleAccountFields(); $('#accountDialog').showModal();
}
function openAssistantDialog(parentId) {
  const lead = getAgent(parentId);
  if (!lead || lead.role !== 'lead') return;
  $('#agentForm').reset(); $('#formError').textContent = '';
  $('#assistantParentId').value = lead.id;
  $('#assistantOwnerName').textContent = `${lead.name} / ${lead.accountLabel}`;
  $('#agentDialog').showModal();
}
async function refresh() {
  try {
    store = await api('/api/state');
    if (selected && !getAgent(selected)) selected = null;
    render();
  } catch (e) { console.error(e); }
}
$('#newLead').onclick = openAccountDialog;
$('#closeAccountDialog').onclick = () => $('#accountDialog').close();
$('#closeDialog').onclick = () => $('#agentDialog').close();
$('#accountProvider').onchange = toggleAccountFields;
document.addEventListener('click', event => {
  const element = event.target.closest('[data-agent]');
  if (element) { selected = element.dataset.agent; render(); }
});
$('#accountForm').onsubmit = async event => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    const result = await api('/api/accounts', 'POST', body);
    selected = result.lead.id;
    $('#accountDialog').close(); await refresh();
  } catch (err) { $('#accountError').textContent = err.message; }
};
$('#agentForm').onsubmit = async event => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    const result = await api('/api/agents', 'POST', body);
    selected = result.id;
    $('#agentDialog').close(); await refresh();
  } catch (err) { $('#formError').textContent = err.message; }
};
$('#taskForm').onsubmit = async event => {
  event.preventDefault();
  try {
    await api('/api/tasks', 'POST', {
      agentId: $('#taskAgent').value, title: $('#taskTitle').value, prompt: $('#taskPrompt').value,
    });
    $('#taskTitle').value = ''; $('#taskPrompt').value = ''; await refresh();
  } catch (err) { alert(err.message); }
};
$('#messageForm').onsubmit = async event => {
  event.preventDefault();
  try {
    await api('/api/messages', 'POST', {
      from: $('#fromAgent').value, to: $('#toAgent').value, text: $('#messageText').value,
    });
    $('#messageText').value = ''; await refresh();
  } catch (err) { alert(err.message); }
};
setInterval(() => $('#clock').textContent = new Date().toLocaleTimeString('en-GB', { hour12: false }), 1000);
const events = new EventSource('/api/events');
events.onmessage = () => refresh();
setInterval(refresh, 8000);
refresh();