import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowEngine } from '../src/engine/workflow.js';

// ── Helpers ──────────────────────────────────────────────────────
const noop = () => {};
const echo = (params) => params;

function buildEngine() {
  const e = new WorkflowEngine();
  e.registerTrigger('chat:message', { start: noop, stop: noop });
  e.registerTrigger('schedule', { start: noop, stop: noop });
  e.registerAction('send-chat', echo);
  e.registerAction('webhook', echo);
  return e;
}

// ── Workflow Validation ──────────────────────────────────────────
describe('WorkflowEngine — validation', () => {
  it('rejects workflow without id', () => {
    const e = buildEngine();
    assert.throws(
      () => e.loadWorkflows([{ trigger: { type: 'chat:message' }, actions: [{ type: 'send-chat' }] }]),
      /missing 'id'/
    );
  });

  it('rejects workflow without trigger.type', () => {
    const e = buildEngine();
    assert.throws(
      () => e.loadWorkflows([{ id: 'w1', actions: [{ type: 'send-chat' }] }]),
      /missing 'trigger.type'/
    );
  });

  it('rejects workflow without actions', () => {
    const e = buildEngine();
    assert.throws(
      () => e.loadWorkflows([{ id: 'w1', trigger: { type: 'chat:message' }, actions: [] }]),
      /missing 'actions'/
    );
  });

  it('rejects unknown trigger type', () => {
    const e = buildEngine();
    assert.throws(
      () => e.loadWorkflows([{ id: 'w1', trigger: { type: 'unknown' }, actions: [{ type: 'send-chat' }] }]),
      /unknown trigger type/
    );
  });

  it('rejects unknown action type', () => {
    const e = buildEngine();
    assert.throws(
      () => e.loadWorkflows([{ id: 'w1', trigger: { type: 'chat:message' }, actions: [{ type: 'bad' }] }]),
      /unknown action type/
    );
  });

  it('accepts valid workflow', () => {
    const e = buildEngine();
    e.loadWorkflows([{
      id: 'echo-test',
      trigger: { type: 'chat:message' },
      actions: [{ type: 'send-chat', params: { message: 'hi' } }],
    }]);
    assert.equal(e.workflows.length, 1);
  });
});

// ── Event Processing ─────────────────────────────────────────────
describe('WorkflowEngine — processEvent', () => {
  let engine;

  beforeEach(() => {
    engine = buildEngine();
    engine.loadWorkflows([{
      id: 'greet',
      trigger: { type: 'chat:message' },
      actions: [{ type: 'send-chat', params: { message: 'Hello {{event.sender}}' } }],
    }]);
  });

  it('matches event to workflow by trigger type', async () => {
    await engine.processEvent('chat:message', { sender: 'alice', body: 'hi' });
    assert.equal(engine.stats.matched, 1);
    assert.equal(engine.stats.executed, 1);
  });

  it('ignores events that do not match trigger type', async () => {
    await engine.processEvent('schedule', {});
    assert.equal(engine.stats.matched, 0);
  });

  it('increments processed count for every event', async () => {
    await engine.processEvent('chat:message', { sender: 'bob' });
    await engine.processEvent('schedule', {});
    assert.equal(engine.stats.processed, 2);
  });
});

// ── Trigger Filters ──────────────────────────────────────────────
describe('WorkflowEngine — trigger filters', () => {
  it('matches exact filter values', async () => {
    const e = buildEngine();
    e.loadWorkflows([{
      id: 'eng-only',
      trigger: { type: 'chat:message', filter: { room: '#engineering' } },
      actions: [{ type: 'send-chat', params: {} }],
    }]);

    await e.processEvent('chat:message', { room: '#engineering', body: 'deploy' });
    assert.equal(e.stats.matched, 1);

    await e.processEvent('chat:message', { room: '#random', body: 'deploy' });
    assert.equal(e.stats.matched, 1); // still 1
  });

  it('matches regex filters', async () => {
    const e = buildEngine();
    e.loadWorkflows([{
      id: 'urgent',
      trigger: { type: 'chat:message', filter: { body: '/urgent|critical/' } },
      actions: [{ type: 'send-chat', params: {} }],
    }]);

    // Regex wrapped in slashes should match
    // Note: the engine checks for string starting/ending with /
    await e.processEvent('chat:message', { body: 'URGENT: server down' });
    assert.equal(e.stats.matched, 1);

    await e.processEvent('chat:message', { body: 'casual message' });
    assert.equal(e.stats.matched, 1); // no new match
  });

  it('matches nested filter paths', async () => {
    const e = buildEngine();
    e.loadWorkflows([{
      id: 'nested',
      trigger: { type: 'chat:message', filter: { 'content.msgtype': 'm.text' } },
      actions: [{ type: 'send-chat', params: {} }],
    }]);

    await e.processEvent('chat:message', { content: { msgtype: 'm.text', body: 'hi' } });
    assert.equal(e.stats.matched, 1);
  });
});

// ── Conditions ───────────────────────────────────────────────────
describe('WorkflowEngine — conditions', () => {
  function condEngine(conditions) {
    const e = buildEngine();
    e.loadWorkflows([{
      id: 'cond-test',
      trigger: { type: 'chat:message' },
      conditions,
      actions: [{ type: 'send-chat', params: {} }],
    }]);
    return e;
  }

  it('equals operator', async () => {
    const e = condEngine([{ field: 'priority', operator: 'equals', value: 'high' }]);
    await e.processEvent('chat:message', { priority: 'high' });
    assert.equal(e.stats.matched, 1);
    await e.processEvent('chat:message', { priority: 'low' });
    assert.equal(e.stats.matched, 1);
  });

  it('contains operator', async () => {
    const e = condEngine([{ field: 'body', operator: 'contains', value: 'deploy' }]);
    await e.processEvent('chat:message', { body: 'starting deploy now' });
    assert.equal(e.stats.matched, 1);
    await e.processEvent('chat:message', { body: 'nothing here' });
    assert.equal(e.stats.matched, 1);
  });

  it('gt / lt operators', async () => {
    const e = condEngine([{ field: 'size', operator: 'gt', value: 1000 }]);
    await e.processEvent('chat:message', { size: 2000 });
    assert.equal(e.stats.matched, 1);
    await e.processEvent('chat:message', { size: 500 });
    assert.equal(e.stats.matched, 1);
  });

  it('exists operator', async () => {
    const e = condEngine([{ field: 'attachment', operator: 'exists' }]);
    await e.processEvent('chat:message', { attachment: 'file.pdf' });
    assert.equal(e.stats.matched, 1);
    await e.processEvent('chat:message', {});
    assert.equal(e.stats.matched, 1);
  });

  it('matches (regex) operator', async () => {
    const e = condEngine([{ field: 'email', operator: 'matches', value: '@linagora\\.com$' }]);
    await e.processEvent('chat:message', { email: 'alice@linagora.com' });
    assert.equal(e.stats.matched, 1);
    await e.processEvent('chat:message', { email: 'bob@gmail.com' });
    assert.equal(e.stats.matched, 1);
  });
});

// ── Template Resolution ──────────────────────────────────────────
describe('WorkflowEngine — template resolution', () => {
  it('resolves {{event.field}} templates', async () => {
    const results = [];
    const e = new WorkflowEngine();
    e.registerTrigger('chat:message', { start: noop, stop: noop });
    e.registerAction('capture', (params) => { results.push(params); return params; });
    e.loadWorkflows([{
      id: 'tmpl',
      trigger: { type: 'chat:message' },
      actions: [{ type: 'capture', params: { msg: 'Hello {{event.sender}} from {{event.room}}' } }],
    }]);

    await e.processEvent('chat:message', { sender: 'alice', room: '#eng' });
    assert.equal(results[0].msg, 'Hello alice from #eng');
  });

  it('resolves missing template vars to empty string', async () => {
    const results = [];
    const e = new WorkflowEngine();
    e.registerTrigger('chat:message', { start: noop, stop: noop });
    e.registerAction('capture', (params) => { results.push(params); return params; });
    e.loadWorkflows([{
      id: 'tmpl',
      trigger: { type: 'chat:message' },
      actions: [{ type: 'capture', params: { msg: 'Value: {{event.missing}}' } }],
    }]);

    await e.processEvent('chat:message', {});
    assert.equal(results[0].msg, 'Value: ');
  });
});

// ── Error Handling ───────────────────────────────────────────────
describe('WorkflowEngine — error handling', () => {
  it('increments error count when action throws', async () => {
    const e = new WorkflowEngine();
    e.registerTrigger('chat:message', { start: noop, stop: noop });
    e.registerAction('fail', () => { throw new Error('boom'); });
    e.loadWorkflows([{
      id: 'crash',
      trigger: { type: 'chat:message' },
      actions: [{ type: 'fail' }],
    }]);

    await e.processEvent('chat:message', {});
    assert.equal(e.stats.errors, 1);
    assert.equal(e.stats.executed, 0);
  });

  it('stops action chain on error by default', async () => {
    const results = [];
    const e = new WorkflowEngine();
    e.registerTrigger('chat:message', { start: noop, stop: noop });
    e.registerAction('fail', () => { throw new Error('boom'); });
    e.registerAction('after', () => { results.push('ran'); });
    e.loadWorkflows([{
      id: 'chain',
      trigger: { type: 'chat:message' },
      actions: [{ type: 'fail' }, { type: 'after' }],
    }]);

    await e.processEvent('chat:message', {});
    assert.equal(results.length, 0, 'second action should not run after error');
  });

  it('continues chain when stopOnError is false', async () => {
    const results = [];
    const e = new WorkflowEngine();
    e.registerTrigger('chat:message', { start: noop, stop: noop });
    e.registerAction('fail', () => { throw new Error('boom'); });
    e.registerAction('after', () => { results.push('ran'); return 'ok'; });
    e.loadWorkflows([{
      id: 'chain',
      trigger: { type: 'chat:message' },
      actions: [{ type: 'fail', stopOnError: false }, { type: 'after' }],
    }]);

    await e.processEvent('chat:message', {});
    assert.equal(results.length, 1, 'second action should run');
  });
});

// ── Events ───────────────────────────────────────────────────────
describe('WorkflowEngine — event emitter', () => {
  it('emits workflows:loaded on loadWorkflows', () => {
    let count = 0;
    const e = buildEngine();
    e.on('workflows:loaded', (n) => { count = n; });
    e.loadWorkflows([{
      id: 'w1',
      trigger: { type: 'chat:message' },
      actions: [{ type: 'send-chat', params: {} }],
    }]);
    assert.equal(count, 1);
  });

  it('emits workflow:triggered when a workflow matches', async () => {
    let triggered = null;
    const e = buildEngine();
    e.on('workflow:triggered', (data) => { triggered = data; });
    e.loadWorkflows([{
      id: 'w1',
      trigger: { type: 'chat:message' },
      actions: [{ type: 'send-chat', params: {} }],
    }]);

    await e.processEvent('chat:message', { body: 'test' });
    assert.equal(triggered.workflow, 'w1');
  });
});
