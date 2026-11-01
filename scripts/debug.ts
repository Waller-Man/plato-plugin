// Local validation through real DSH Tool dispatch + Runtime; only the model is synthetic.
// No paid provider, API key, direct business callback, or database writes are used.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit';
import Registry from '@deepseek-ai/dsh-typert-registry';
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local';
import Runtime from '@software-factory/runtime';
const Plato = await import(process.env.PLATO_PLUGIN_UNDER_TEST
  ? pathToFileURL(resolve(process.env.PLATO_PLUGIN_UNDER_TEST)).href : '../lib/index.js');

const { values } = parseArgs({ options: {
  python: { type: 'string' }, jar: { type: 'string' }, java: { type: 'string', default: 'java' },
} });
if (!values.python || !values.jar) throw new Error('Usage: node scripts/debug.ts --python <absolute-python> --jar <absolute-plantuml.jar> [--java java]');
const config = { pythonPath: resolve(values.python), plantumlJarPath: resolve(values.jar), javaPath: values.java, startupTimeoutMs: 30000 };
const root = resolve('test-results');
await mkdir(root, { recursive: true });
const workspace = await mkdtemp(join(root, 'runtime-'));
const ctx = new Context();
const seen = [];
let modelStarted = Promise.withResolvers();

function synthetic(system) {
  const lower = system.toLowerCase();
  if (lower.includes('strict control-structure synthesizer')) return "LEVEL 1 Begin: 'to be decomposed' [Condition]{\nLEVEL 1 End";
  if (lower.includes('evaluate whether a given intermediate nested decomposition')) return '[Valid][Done]';
  if (lower.includes('extracting atomic activities')) return '["Check inventory", "Ship order", "Notify customer"]';
  if (lower.includes('integrating analysed requirement')) return 'Check inventory\nif in stock\n  Ship order\nelse\n  Notify customer';
  if (lower.includes('plantuml expert')) return '@startuml\nstart\n:Check inventory;\nif (In stock?) then (yes)\n:Ship order;\nelse (no)\n:Notify customer;\nendif\nstop\n@enduml';
  if (lower.includes('rough decomposition')) return 'Level 1{Check inventory; [Condition] in stock: Ship order; otherwise: Notify customer}';
  throw new Error('Synthetic fixture did not recognize a PLATO prompt');
}

class SyntheticModel extends LlmAdapter {
  async listModels(provider) { return ['synthetic', 'failure', 'cancel'].map(id => ({ provider, id, name: 'Local synthetic fixture: ' + id })); }
  async resolveModel(provider, model) { return { provider, id: model, name: 'Synthetic fixture' }; }
  async *stream(options) {
    seen.push(options);
    modelStarted.resolve();
    if (options.model === 'failure') throw new Error('SYNTHETIC_MODEL_FAILURE');
    if (options.model === 'cancel') {
      await new Promise((resolve, reject) => {
        if (options.signal.aborted) return reject(options.signal.reason);
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    }
    const system = options.system || options.messages.filter(m => m.role === 'system').map(m =>
      typeof m.content === 'string' ? m.content : m.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
    ).join('\n');
    yield { type: 'text-delta', index: 0, text: synthetic(system) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

const checks = [];
try {
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true });
  const harness = await mountAgentLoopTestHarness(ctx);
  const agent = await harness.create(SessionId('plato-test-' + randomUUID()), {}, { cwd: workspace });
  await ctx.plugin(Registry);
  await ctx.plugin(LocalSubprocess);
  await ctx.plugin(Runtime, { defaultTimeoutMs: 120000, modelTimeoutMs: 30000 });
  ctx.llm.registerAdapter(['plato-synthetic'], new SyntheticModel());
  const plugin = await ctx.plugin(Plato, config);
  async function raw(action, args) {
    return ctx.tools.execute({ callId: ToolCallId(randomUUID()), name: 'sf_runtime_' + action, arguments: args, agent, signal: new AbortController().signal });
  }
  async function call(action, args) {
    const response = await raw(action, args);
    assert.equal(response.isError, false, JSON.stringify(response));
    assert.equal(response.value.ok, true, JSON.stringify(response.value));
    return response.value.data;
  }
  async function finish(runId) {
    let afterSeq = 0;
    for (let round = 0; round < 600; round++) {
      const update = await call('wait_run', { runId, afterSeq, waitMs: 200 });
      afterSeq = update.lastSeq;
      if (['completed', 'failed', 'cancelled', 'interrupted'].includes(update.run.status)) return call('get_run', { runId });
    }
    throw new Error('Run did not settle within bounded wait');
  }
  const input = { requirement_text: '检查库存。如果有货，发货；否则通知客户缺货。' };
  const contract = await call('get_tool_contract', { toolId: 'sf_plato_activity' });
  assert.deepEqual(contract.inputSchema.required, ['requirement_text']);
  checks.push('Runtime discovers the SDK-registered PLATO contract');

  const direct = await ctx.tools.execute({ callId: ToolCallId(randomUUID()), name: 'sf_plato_activity', arguments: input, agent, signal: new AbortController().signal });
  assert.equal(direct.isError, true);
  checks.push('Direct calls without a genuine Run context are rejected');
  const invalid = await call('run_tool', { toolId: 'sf_plato_activity', input: { requirement_text: '   ' } });
  assert.equal((await finish(invalid.runId)).status, 'failed');
  checks.push('Whitespace-only requirements fail before starting Python');

  const accepted = await call('run_tool', { toolId: 'sf_plato_activity', input, model: { provider: 'plato-synthetic', model: 'synthetic' } });
  const completed = await finish(accepted.runId);
  assert.equal(completed.status, 'completed', JSON.stringify(completed.issues));
  assert.equal(completed.result.files.length, 2);
  const directory = join(workspace, 'outputs/runs', accepted.runId);
  const png = await readFile(join(directory, 'final/activity.png'));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.match(await readFile(join(directory, 'final/activity.puml'), 'utf8'), /@startuml/);
  assert.ok(completed.artifacts.some(a => a.relativePath === 'intermediate/integration.txt'));
  assert.ok(completed.artifacts.some(a => a.relativePath.startsWith('snapshots/model-')));
  assert.ok(completed.logs.some(l => l.message.includes('任务目录实际写入成功')));
  const saved = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));
  const actualStages = saved.events.filter(e => e.type === 'progress').map(e => e.data.stage);
  for (const stage of ['activity_identification', 'structure_decomposition', 'information_integration', 'plantuml_generation', 'rendering']) assert.ok(actualStages.includes(stage));
  assert.ok(seen.length >= 6);
  assert.ok(seen.every(request => request.sessionId !== agent.id));
  for (const file of completed.result.files) {
    const reference = await call('get_artifact', { runId: accepted.runId, artifactId: file.artifactId });
    assert.match(reference.downloadUrl, /^\/api\/sf-runtime\/download\?/);
  }
  checks.push('Real Python workflow + Java rendering deliver valid PNG/PUML via Runtime artifact IDs');
  checks.push('Intermediate materials/model snapshots survive; model sessions are isolated');

  const failed = await finish((await call('run_tool', { toolId: 'sf_plato_activity', input, model: { provider: 'plato-synthetic', model: 'failure' } })).runId);
  assert.equal(failed.status, 'failed');
  assert.ok(failed.issues.some(i => i.message.includes('SYNTHETIC_MODEL_FAILURE')));
  assert.equal(failed.result, undefined);
  checks.push('Model failure becomes a failed Run and never a successful diagram');

  modelStarted = Promise.withResolvers();
  const cancelling = await call('run_tool', { toolId: 'sf_plato_activity', input, model: { provider: 'plato-synthetic', model: 'cancel' } });
  await modelStarted.promise;
  await call('cancel_run', { runId: cancelling.runId });
  const cancelled = await finish(cancelling.runId);
  assert.equal(cancelled.status, 'cancelled', JSON.stringify(cancelled.issues));
  assert.ok(cancelled.artifacts.some(a => a.relativePath.startsWith('snapshots/')));
  checks.push('Cancellation stops the model and managed Python range, retaining existing materials');

  await plugin.dispose();
  const removed = await raw('get_tool_contract', { toolId: 'sf_plato_activity' });
  assert.equal(removed.value.ok, false);
  checks.push('Disabling the plugin revokes Runtime discovery');
  const report = { testedAt: new Date().toISOString(), workspace, model: 'Synthetic local fixture, no real inference', checks, completedRunId: accepted.runId, failedRunId: failed.runId, cancelledRunId: cancelled.runId };
  await writeFile(join(root, 'validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await ctx.fiber.dispose();
}
