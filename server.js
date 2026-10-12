import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.AGENT_DATA_DIR || path.join(os.homedir(), '.sofapotatoed-agent');
const storeFile = path.join(dataDir, 'state.json');
const port = Number(process.env.PORT || 3210);
const host = process.env.HOST || '127.0.0.1';
const initial = { accounts: [], agents: [], messages: [], tasks: [], events: [] };
const providers = new Set(['demo', 'codex', 'claude', 'openai-compatible']);
const secretNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
let state = structuredClone(initial);
let saveChain = Promise.resolve();
const streams = new Set();
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const id = () => crypto.randomUUID();
const send = (res, code, value) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
const cleanText = (x, max = 3000) => typeof x === 'string' ? x.trim().slice(0, max) : '';
const timestamp = () => new Date().toISOString();
const log = (kind, text, agentId = null) => {
  const entry = { id: id(), at: timestamp(), kind, text, agentId };
  state.events.unshift(entry);
  state.events = state.events.slice(0, 250);
  for (const stream of streams) {
    try { stream.write(`data: ${JSON.stringify(entry)}\n\n`); }
    catch { streams.delete(stream); }
  }
};
function persist() {
  const snapshot = JSON.stringify(state, null, 2);
  saveChain = saveChain.then(async () => {
    const temp = `${storeFile}.${process.pid}.tmp`;
    await fs.writeFile(temp, snapshot, { mode: 0o600 });
    await fs.rename(temp, storeFile);
  });
  return saveChain;
}
const getAgent = agentId => {
  const agent = state.agents.find(a => a.id === agentId);
  if (!agent) throw bad('Agent not found', 404);
  return agent;
};
const isLead = agent => agent.role === 'lead';
function getLead(agent) {
  const lead = isLead(agent) ? agent : getAgent(agent.parentId);
  if (!isLead(lead)) throw bad('Agent has an invalid supervisor', 500);
  if (agent.accountId !== lead.accountId) throw bad('Agent account ownership mismatch', 500);
  return lead;
}
function getBinding(agent) {
  const lead = getLead(agent);
  const account = state.accounts.find(a => a.id === lead.accountId && a.leadId === lead.id);
  if (!account) throw bad('Supervisor has no account binding', 500);
  return account;
}
const publicAccount = a => ({
  id: a.id,
  leadId: a.leadId,
  label: a.label,
  provider: a.provider,
  model: a.model,
  verified: false, // Registering a local account home is NOT a successful OAuth login.
  status: a.provider === 'demo' ? 'demo' : 'registered',
  createdAt: a.createdAt,
});
function publicAgent(a) {
  const binding = getBinding(a);
  return {
    id: a.id, name: a.name, role: a.role, parentId: a.parentId,
    accountId: binding.id, accountLabel: binding.label,
    provider: binding.provider, model: binding.model,
    credentialConfigured: binding.provider === 'demo' ||
      (binding.provider === 'openai-compatible' && Boolean(process.env[binding.credentialEnv])) ||
      (['codex', 'claude'].includes(binding.provider) && Boolean(binding.accountHome)),
    soul: a.soul, skills: a.skills, mcp: a.mcp, status: a.status, createdAt: a.createdAt,
  };
}
async function readBody(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 131072) throw bad('Request too large', 413);
  }
  try { return JSON.parse(text || '{}'); } catch { throw bad('Invalid JSON'); }
}
function authorizedPeer(a, b) {
  return isLead(a) && isLead(b) || a.id === b.id ||
    (a.parentId && a.parentId === b.id) || (b.parentId && b.parentId === a.id);
}
function validateUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && !(process.env.ALLOW_LOCAL_ENDPOINTS === '1' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw Error();
    return url;
  } catch { throw bad('API URL must use HTTPS, except opt-in local endpoints'); }
}
function accountFingerprint(provider, { accountHome, credentialEnv, endpoint }) {
  if (provider === 'codex' || provider === 'claude') {
    // One CLI account home equals one supervisor. This does not yet verify provider identity.
    return `${provider}|${process.platform === 'win32' ? accountHome.toLowerCase() : accountHome}`;
  }
  if (provider === 'openai-compatible') return `${provider}|${endpoint}|${credentialEnv}`;
  return `demo|${id()}`;
}
function prepareBinding(body) {
  const provider = cleanText(body.provider, 30);
  if (!providers.has(provider)) throw bad('Unsupported provider');
  const label = cleanText(body.label, 70);
  if (!label) throw bad('Account label is required');
  const model = cleanText(body.model, 80);
  let accountHome = '';
  let credentialEnv = '';
  let endpoint = '';
  if (provider === 'codex' || provider === 'claude') {
    accountHome = cleanText(body.accountHome, 600);
    if (!accountHome || !path.isAbsolute(accountHome)) throw bad('Codex/Claude require an absolute, separate CLI account home');
    accountHome = path.normalize(accountHome);
  }
  if (provider === 'openai-compatible') {
    credentialEnv = cleanText(body.credentialEnv, 80);
    if (!secretNamePattern.test(credentialEnv)) throw bad('Provide a valid server-side API key environment variable name');
    endpoint = validateUrl(cleanText(body.endpoint, 500) || 'https://api.openai.com/v1/chat/completions').href;
  }
  return { provider, label, model, accountHome, credentialEnv, endpoint,
    fingerprint: accountFingerprint(provider, { accountHome, credentialEnv, endpoint }) };
}
function makeSoul(name) { return `# ${name}\nBe careful, precise, and collaborative.`; }
function createLeadForAccount(binding, body) {
  const name = cleanText(body.leadName, 40) || `${binding.label} 主管`;
  if (!name) throw bad('Supervisor name required');
  return {
    id: id(), name, role: 'lead', parentId: null, accountId: binding.id,
    soul: cleanText(body.soul, 6000) || makeSoul(name), skills: [], mcp: [],
    status: 'idle', createdAt: timestamp(),
  };
}
async function runProvider(agent, prompt) {
  const binding = getBinding(agent);
  const provider = binding.provider;
  if (provider === 'demo') return `[Demo] ${agent.name}: 收到工作「${prompt.slice(0, 120)}」。請接入正式模型後執行。`;
  if (provider === 'openai-compatible') {
    const secret = process.env[binding.credentialEnv];
    if (!secret) throw bad('Missing account secret in server environment');
    const url = validateUrl(binding.endpoint);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 90000);
    try {
      const response = await fetch(url, {
        method: 'POST', signal: ac.signal,
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: binding.model || 'gpt-4.1-mini', messages: [
          { role: 'system', content: agent.soul }, { role: 'user', content: prompt },
        ] }),
      });
      if (!response.ok) throw bad(`Provider returned HTTP ${response.status}`, 502);
      const body = await response.json();
      return body.choices?.[0]?.message?.content || '(No response)';
    } finally { clearTimeout(timer); }
  }
  if (!['codex', 'claude'].includes(provider)) throw bad('Unsupported provider');
  if (process.env.ENABLE_CLI_AGENTS !== '1') throw bad('CLI agents disabled. Set ENABLE_CLI_AGENTS=1 after signing in to each account home.');
  if (!binding.accountHome || !path.isAbsolute(binding.accountHome)) throw bad('Supervisor CLI account home is required');
  const executable = provider === 'codex' ? 'codex' : 'claude';
  const args = provider === 'codex'
    ? ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', `${agent.soul}\n\n${prompt}`]
    : ['-p', `${agent.soul}\n\n${prompt}`, '--permission-mode', 'plan'];
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (provider === 'codex') env.CODEX_HOME = binding.accountHome;
    else env.CLAUDE_CONFIG_DIR = binding.accountHome;
    const child = spawn(executable, args, { cwd: root, env, shell: false, windowsHide: true });
    let output = '';
    let error = '';
    const timeout = setTimeout(() => child.kill(), 120000);
    child.stdout.on('data', x => { output += x; if (output.length > 150000) child.kill(); });
    child.stderr.on('data', x => { error += x; if (error.length > 150000) child.kill(); });
    child.on('error', err => { clearTimeout(timeout); reject(bad(`CLI launch failed: ${err.message}`, 502)); });
    child.on('close', code => {
      clearTimeout(timeout);
      code === 0 ? resolve(output.slice(0, 12000)) : reject(bad(`CLI exited with ${code}: ${error.slice(-500)}`, 502));
    });
  });
}
async function executeTask(task) {
  task.status = 'running';
  log('task', `開始執行：${task.title}`, task.agentId);
  await persist();
  try {
    const agent = getAgent(task.agentId);
    task.result = await runProvider(agent, task.prompt);
    task.status = 'done';
    log('task', `已完成：${task.title}`, agent.id);
  } catch (err) {
    task.status = 'failed';
    task.result = err.message;
    log('error', `${task.title}：${err.message}`, task.agentId);
  }
  task.completedAt = timestamp();
  await persist();
}
function migrateLegacyState() {
  // Preserve existing v0.1 leads/assistants instead of discarding local work.
  // Old duplicate credentials are flagged for later identity review, not silently combined.
  let changed = false;
  for (const lead of state.agents.filter(isLead)) {
    if (state.accounts.some(a => a.leadId === lead.id)) continue;
    const provider = providers.has(lead.provider) ? lead.provider : 'demo';
    const label = `${lead.name} (legacy)`;
    const binding = {
      id: id(), leadId: lead.id, provider, label, model: lead.model || '',
      accountHome: lead.accountHome || '', credentialEnv: lead.credentialEnv || '',
      endpoint: lead.endpoint || '', fingerprint: `legacy|${lead.id}`,
      needsIdentityReview: true, createdAt: lead.createdAt || timestamp(),
    };
    state.accounts.push(binding);
    lead.accountId = binding.id;
    for (const a of state.agents.filter(a => a.parentId === lead.id)) a.accountId = binding.id;
    changed = true;
  }
  if (changed) {
    for (const a of state.agents) {
      delete a.provider; delete a.credentialEnv; delete a.endpoint;
      delete a.accountHome; delete a.model;
    }
    log('system', '舊版主管帳號設定已保留並轉換；請確認原本登入設定');
  }
  return changed;
}
async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, {
    ...state, accounts: state.accounts.map(publicAccount), agents: state.agents.map(publicAgent),
  });
  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    streams.add(res); req.on('close', () => streams.delete(res)); return;
  }
  if (req.method === 'POST' && url.pathname === '/api/accounts') {
    const b = await readBody(req);
    if (state.accounts.length >= 12) throw bad('Supervisor account limit reached');
    const binding = prepareBinding(b);
    if (state.accounts.some(a => a.fingerprint === binding.fingerprint)) throw bad('This account home or credential binding already has a supervisor', 409);
    binding.id = id();
    binding.createdAt = timestamp();
    const lead = createLeadForAccount(binding, b);
    binding.leadId = lead.id;
    state.accounts.push(binding);
    state.agents.push(lead);
    log('account', `已登記 ${binding.provider} 帳號「${binding.label}」並建立主管 ${lead.name}`, lead.id);
    await persist();
    return send(res, 201, { account: publicAccount(binding), lead: publicAgent(lead) });
  }
  if (req.method === 'POST' && url.pathname === '/api/agents') {
    const b = await readBody(req);
    if (!b.parentId) throw bad('A supervisor is created only when a new account is registered. Use POST /api/accounts.');
    const parent = getAgent(b.parentId);
    if (!isLead(parent)) throw bad('Only supervisors can create assistants');
    if (state.agents.filter(a => a.parentId === parent.id).length >= 8) throw bad('Assistant limit reached');
    if (['provider', 'accountId', 'credentialEnv', 'accountHome', 'endpoint', 'model'].some(k => b[k] !== undefined)) throw bad('Assistants cannot select or override an account binding', 403);
    const name = cleanText(b.name, 40);
    if (!name) throw bad('Agent name required');
    const agent = {
      id: id(), name, role: 'assistant', parentId: parent.id,
      accountId: getBinding(parent).id,
      soul: cleanText(b.soul, 6000) || makeSoul(name),
      skills: [], mcp: [], status: 'idle', createdAt: timestamp(),
    };
    state.agents.push(agent);
    log('agent', `${name} 加入 ${parent.name} 的團隊`, agent.id);
    await persist();
    return send(res, 201, publicAgent(agent));
  }
  const agentMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/(soul|skills|mcp)$/);
  if (req.method === 'PUT' && agentMatch) {
    const agent = getAgent(agentMatch[1]); const b = await readBody(req); const prop = agentMatch[2];
    if (prop === 'soul') {
      if (!cleanText(b.soul, 6000)) throw bad('SOUL.md must not be empty');
      agent.soul = cleanText(b.soul, 6000);
    } else {
      if (!Array.isArray(b.items) || b.items.length > 24 || b.items.some(x => typeof x !== 'string' || x.length > 180)) throw bad('Invalid items');
      agent[prop] = b.items.map(x => x.trim()).filter(Boolean);
    }
    log('agent', `${agent.name} 更新 ${prop}`, agent.id);
    await persist(); return send(res, 200, publicAgent(agent));
  }
  if (req.method === 'POST' && url.pathname === '/api/messages') {
    const b = await readBody(req); const from = getAgent(b.from); const to = getAgent(b.to);
    if (!authorizedPeer(from, to)) throw bad('Agent communication not permitted', 403);
    const text = cleanText(b.text); if (!text) throw bad('Message required');
    const item = { id: id(), from: from.id, to: to.id, text, at: timestamp() };
    state.messages.push(item); state.messages = state.messages.slice(-500);
    log('message', `${from.name} → ${to.name}: ${text.slice(0, 70)}`, to.id);
    await persist(); return send(res, 201, item);
  }
  if (req.method === 'POST' && url.pathname === '/api/tasks') {
    const b = await readBody(req); const agent = getAgent(b.agentId);
    const title = cleanText(b.title, 100); const prompt = cleanText(b.prompt, 8000);
    if (!title || !prompt) throw bad('Task title and prompt required');
    getBinding(agent); // Validate account ownership before queuing.
    const task = { id: id(), agentId: agent.id, title, prompt, status: 'queued', result: '', createdAt: timestamp() };
    state.tasks.unshift(task); await persist();
    void executeTask(task); return send(res, 202, task);
  }
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, {
    ok: true, mode: 'local', accounts: state.accounts.length, cliEnabled: process.env.ENABLE_CLI_AGENTS === '1',
  });
  if (req.method !== 'GET' && req.method !== 'HEAD') throw bad('Not found', 404);
  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!['/index.html', '/app.js', '/style.css'].includes(file)) throw bad('Not found', 404);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  const body = await fs.readFile(path.join(root, 'public', file));
  res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
export async function createServer() {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  try {
    state = { ...structuredClone(initial), ...JSON.parse(await fs.readFile(storeFile, 'utf8')) };
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (migrateLegacyState()) await persist();
  return http.createServer((req, res) => route(req, res).catch(err => {
    if (!res.headersSent) send(res, err.status || 500, { error: err.message });
    else res.end();
  }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createServer();
  server.listen(port, host, () => console.log(`Sofapotatoed Agent: http://${host}:${port}`));
}