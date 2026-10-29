import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultT3Policy, parseT3Policy, planT3Delegation } from '../src/t3/routing.ts';

function capabilities() {
  const models = (ids: string[], option: string) => ids.map(id => ({
    id, options: [{ id: option, values: ['low', 'medium', 'high'] }],
  }));
  return {
    inheritedProviderInstanceId: 'codex-instance',
    providers: [
      { providerInstanceId: 'codex-instance', driverKind: 'codex', canRunChildTask: true, canRunCrossProviderChildTask: true,
        models: models(['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-astra'], 'reasoningEffort') },
      { providerInstanceId: 'claude-instance', driverKind: 'claudeAgent', canRunChildTask: true, canRunCrossProviderChildTask: true,
        models: models(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'], 'effort') },
    ],
  };
}

function request() {
  return { task: 'Implement the edit.\nRun relevant tests.', tier: 'routine', family: 'codex', capabilities: capabilities() };
}

test('maps primary agent judgments to the configured T3 worker model and effort', () => {
  for (const [family, tier, provider, model, option, effort] of [
    ['codex', 'routine', 'codex-instance', 'gpt-6-luna', 'reasoningEffort', 'low'],
    ['codex', 'standard', 'codex-instance', 'gpt-6.1-terra', 'reasoningEffort', 'medium'],
    ['codex', 'complex', 'codex-instance', 'gpt-6.1-sol', 'reasoningEffort', 'high'],
    ['codex', 'demanding', 'codex-instance', 'gpt-6-astra', 'reasoningEffort', 'high'],
    ['claude', 'routine', 'claude-instance', 'claude-haiku-5-5', 'effort', 'low'],
    ['claude', 'standard', 'claude-instance', 'claude-sonnet-5-5', 'effort', 'medium'],
    ['claude', 'complex', 'claude-instance', 'claude-opus-5-5', 'effort', 'high'],
    ['claude', 'demanding', 'claude-instance', 'claude-fable-5-1', 'effort', 'high'],
  ]) {
    const plan = planT3Delegation({ ...request(), family, tier });
    assert.deepEqual(plan.selection, { providerInstanceId: provider, model, options: { [option!]: effort } });
    assert.deepEqual(plan.delegation.target, plan.selection);
    assert.equal(plan.delegation.mode, 'async');
    assert.equal(plan.delegation.isolation, 'shared');
    assert.match(plan.delegation.task, /Implement the edit\.\nRun relevant tests\./);
    assert.match(plan.delegation.task, /^SWITCHBOARD_WORKER\n/);
    assert.equal(plan.verificationRequired, true);
  }
});

test('requires exact model availability and an enabled provider; does not silently substitute', () => {
  const unavailable = request();
  unavailable.capabilities.providers[0]!.models[0]!.id = 'gpt-6-luna-other';
  assert.throws(() => planT3Delegation(unavailable));
  const disabled = request();
  disabled.capabilities.providers[0]!.canRunChildTask = false;
  assert.throws(() => planT3Delegation(disabled));
  const ambiguous = request();
  ambiguous.capabilities.providers.push({ ...ambiguous.capabilities.providers[0]!, providerInstanceId: 'another-codex' });
  assert.throws(() => planT3Delegation(ambiguous));
});

test('does not cross a provider boundary when the target provider disallows it', () => {
  const input = request();
  input.capabilities.providers[1]!.canRunCrossProviderChildTask = false;
  assert.throws(() => planT3Delegation({ ...input, family: 'claude' }));
  assert.doesNotThrow(() => planT3Delegation(input));
  const unknownParent = { ...input, capabilities: { ...input.capabilities, inheritedProviderInstanceId: null } };
  assert.throws(() => planT3Delegation({ ...unknownParent, family: 'claude' }));
});

test('validates the requested effort against the selected model options', () => {
  const input = request();
  input.capabilities.providers[0]!.models[0]!.options[0]!.values = ['medium', 'high'];
  assert.throws(() => planT3Delegation(input));
  const policy = structuredClone(defaultT3Policy);
  delete policy.routing.codex.routine.effort;
  assert.deepEqual(planT3Delegation(input, policy).selection.options, {});
});

test('escalation requires evidence and a stronger tier with a different model', () => {
  const input = request();
  const previous = { tier: 'routine', model: 'gpt-6-luna', failure: 'Worker could not reproduce the failure.' };
  assert.equal(planT3Delegation({ ...input, tier: 'standard', previous }).selection.model, 'gpt-6.1-terra');
  assert.throws(() => planT3Delegation({ ...input, previous }));
  assert.throws(() => planT3Delegation({ ...input, tier: 'standard', previous: { ...previous, tier: 'complex' } }));
  assert.throws(() => planT3Delegation({ ...input, tier: 'standard', previous: { ...previous, failure: ' ' } }));
  assert.throws(() => planT3Delegation({ ...input, tier: 'standard', previous: { ...previous, model: 'gpt-6.1-terra' } }));
});

test('policy requires complete valid tier mappings and rejects unrecognized settings', () => {
  assert.deepEqual(parseT3Policy(structuredClone(defaultT3Policy)), defaultT3Policy);
  const unknown = structuredClone(defaultT3Policy) as unknown as Record<string, unknown>;
  unknown.unexpected = true;
  assert.throws(() => parseT3Policy(unknown));
  const missing = structuredClone(defaultT3Policy) as unknown as { routing: { codex: Record<string, unknown> } };
  delete missing.routing.codex.standard;
  assert.throws(() => parseT3Policy(missing));
  const invalid = structuredClone(defaultT3Policy);
  invalid.routing.codex.routine.effort = 'faster';
  assert.throws(() => parseT3Policy(invalid));
});

test('validates bounded task input without echoing task contents in errors', () => {
  const sensitive = 'PRIVATE-TASK-CONTENT';
  assert.throws(() => planT3Delegation({ ...request(), task: sensitive.repeat(2000) }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, /PRIVATE-TASK-CONTENT/);
    return true;
  });
  assert.throws(() => planT3Delegation({ ...request(), task: ' \n ' }));
  assert.throws(() => planT3Delegation({ ...request(), tier: 'unknown', task: sensitive }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, /PRIVATE-TASK-CONTENT/);
    return true;
  });
});
