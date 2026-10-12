import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'spa-test-'));
process.env.AGENT_DATA_DIR = dataDir;
const { createServer } = await import('../server.js');
const server = await createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function req(route, method = 'GET', body) {
  const response = await fetch(base + route, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}
const homes = name => path.join(dataDir, 'accounts', name);
let codexA, codexB, claudeA, demo;

test('local health and pixel office are available', async () => {
  assert.equal((await req('/api/health')).data.ok, true);
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /綁定新帳號 \/ 建立主管/);
});

test('no account means no supervisor; registering each different account creates exactly one supervisor', async () => {
  assert.equal((await req('/api/agents', 'POST', { name: 'Orphan Supervisor' })).status, 400);
  codexA = (await req('/api/accounts', 'POST', {
    provider: 'codex', label: 'Codex A', leadName: '主管 A', accountHome: homes('codex-a'),
  })).data;
  assert.equal(codexA.lead.role, 'lead');
  assert.equal(codexA.lead.accountId, codexA.account.id);
  assert.equal(codexA.account.leadId, codexA.lead.id);
  assert.equal(codexA.account.verified, false);

  assert.equal((await req('/api/accounts', 'POST', {
    provider: 'codex', label: 'Codex Duplicate', accountHome: homes('codex-a'),
  })).status, 409);

  codexB = (await req('/api/accounts', 'POST', {
    provider: 'codex', label: 'Codex B', accountHome: homes('codex-b'),
  })).data;
  const codexC = (await req('/api/accounts', 'POST', {
    provider: 'codex', label: 'Codex C', accountHome: homes('codex-c'),
  })).data;
  claudeA = (await req('/api/accounts', 'POST', {
    provider: 'claude', label: 'Claude A', accountHome: homes('claude-a'),
  })).data;
  const claudeB = (await req('/api/accounts', 'POST', {
    provider: 'claude', label: 'Claude B', accountHome: homes('claude-b'),
  })).data;
  assert.equal(new Set([codexA, codexB, codexC, claudeA, claudeB].map(x => x.lead.id)).size, 5);
  const state = (await req('/api/state')).data;
  assert.equal(state.accounts.length, 5);
  assert.equal(state.agents.filter(a => a.role === 'lead').length, 5);
  assert.equal(state.accounts.filter(a => a.provider === 'codex').length, 3);
  assert.equal(state.accounts.filter(a => a.provider === 'claude').length, 2);
  assert.equal(JSON.stringify(state).includes(homes('codex-a')), false);
  assert.equal(state.agents[0].accountHome, undefined);
});

test('each supervisor can create assistants only from its own account', async () => {
  const reviewer = await req('/api/agents', 'POST', {
    name: '審查助手 A', parentId: codexA.lead.id, soul: '# Reviewer A',
  });
  assert.equal(reviewer.status, 201);
  assert.equal(reviewer.data.role, 'assistant');
  assert.equal(reviewer.data.accountId, codexA.account.id);
  assert.equal(reviewer.data.provider, 'codex');
  assert.notEqual(reviewer.data.accountId, claudeA.account.id);
  assert.equal((await req('/api/agents', 'POST', {
    name: 'Unauthorized override', parentId: codexA.lead.id, accountHome: homes('claude-a'),
  })).status, 403);
  assert.equal((await req('/api/agents', 'POST', {
    name: 'Nested', parentId: reviewer.data.id,
  })).status, 400);
  assert.equal((await req('/api/messages', 'POST', {
    from: codexA.lead.id, to: claudeA.lead.id, text: 'Cross-supervisor coordination',
  })).status, 201);
  assert.equal((await req('/api/messages', 'POST', {
    from: reviewer.data.id, to: claudeA.lead.id, text: 'Not allowed',
  })).status, 403);
  assert.equal((await req(`/api/agents/${reviewer.data.id}/soul`, 'PUT', { soul: '# Independent Reviewer' })).status, 200);
  const state = (await req('/api/state')).data;
  assert.equal(state.agents.find(a => a.id === reviewer.data.id).soul, '# Independent Reviewer');
  assert.notEqual(state.agents.find(a => a.id === codexA.lead.id).soul, '# Independent Reviewer');
});

test('registered account settings are distinct from successful authentication', async () => {
  const badEnv = await req('/api/accounts', 'POST', {
    provider: 'openai-compatible', label: 'Unsafe', credentialEnv: 'secret-key here',
  });
  assert.equal(badEnv.status, 400);
  const apiAccount = await req('/api/accounts', 'POST', {
    provider: 'openai-compatible', label: 'LLM API', credentialEnv: 'TEST_PROVIDER_KEY',
    endpoint: 'https://api.example.com/v1/chat/completions',
  });
  assert.equal(apiAccount.status, 201);
  assert.equal(apiAccount.data.account.verified, false);
  assert.equal(apiAccount.data.lead.credentialConfigured, false);
  assert.equal((await req('/api/state')).data.accounts.find(a => a.id === apiAccount.data.account.id).credentialEnv, undefined);
  assert.equal((await req('/api/accounts', 'POST', {
    provider: 'openai-compatible', label: 'Duplicate API', credentialEnv: 'TEST_PROVIDER_KEY',
    endpoint: 'https://api.example.com/v1/chat/completions',
  })).status, 409);
});

test('demo account also creates its own supervisor and can execute task from its assistant', async () => {
  demo = (await req('/api/accounts', 'POST', { provider: 'demo', label: 'Demo account' })).data;
  const child = (await req('/api/agents', 'POST', {
    name: 'Demo reviewer', parentId: demo.lead.id,
  })).data;
  const task = (await req('/api/tasks', 'POST', {
    agentId: child.id, title: 'Review', prompt: 'Review this document',
  })).data;
  await new Promise(resolve => setTimeout(resolve, 80));
  const current = (await req('/api/state')).data;
  assert.equal(current.tasks.find(t => t.id === task.id).status, 'done');
  assert.equal(current.agents.find(a => a.id === child.id).accountId, demo.account.id);
});

test('legacy local state migrates supervisors without deleting their agents', async () => {
  await new Promise(resolve => server.close(resolve));
  const legacy = {
    agents: [
      { id: 'old-lead', name: 'Legacy Lead', role: 'lead', provider: 'codex',
        accountHome: homes('legacy'), model: '', credentialEnv: '', endpoint: '',
        parentId: null, soul: '# Legacy lead', skills: [], mcp: [], status: 'idle', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'old-assistant', name: 'Legacy Assistant', role: 'assistant', parentId: 'old-lead',
        provider: 'codex', accountHome: homes('legacy'), soul: '# Legacy assistant',
        skills: [], mcp: [], status: 'idle', createdAt: '2026-01-01T00:00:00Z' },
    ], messages: [], events: [], tasks: [],
  };
  await writeFile(path.join(dataDir, 'state.json'), JSON.stringify(legacy), { mode: 0o600 });
  const reopened = await createServer();
  await new Promise(resolve => reopened.listen(0, '127.0.0.1', resolve));
  const response = await fetch(`http://127.0.0.1:${reopened.address().port}/api/state`);
  const state = await response.json();
  assert.equal(state.accounts.length, 1);
  assert.equal(state.agents.length, 2);
  assert.equal(state.agents[0].accountId, state.agents[1].accountId);
  assert.equal(state.agents[0].role, 'lead');
  assert.equal(state.agents[1].parentId, 'old-lead');
  assert.equal(state.agents[1].accountHome, undefined);
  assert.equal(JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8')).accounts.length, 1);
  await new Promise(resolve => reopened.close(resolve));
});

test.after(async () => { await rm(dataDir, { recursive: true, force: true }); });