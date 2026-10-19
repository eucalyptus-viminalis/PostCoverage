// Runs tests/demo-posts.json through Jev and compares with the expected verdicts.
// Usage: TYPESAFE_API_KEY=... node tests/run-jev.mjs     (without a key it uses a stub response to check the wiring)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const key = process.env.TYPESAFE_API_KEY;
const stub = !key;
const sent = [];
const fetchImpl = stub
  ? async (url, init) => {
      const body = JSON.parse(init.body);
      sent.push({ url, auth: init.headers.authorization, body });
      const yes = /seed phrase/i.test(body.state.post) ? '§201' : null;
      const answers = Object.fromEntries(Object.keys(body.questions).map(id => [id, { type: 'noul', noul: id === yes ? 0.97 : 0.04 }]));
      return new Response(JSON.stringify({ model: 'jev-stub', answers, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
    }
  : fetch;

const ctx = vm.createContext({ fetch: fetchImpl, Response });
for (const f of ['extension/network-code.js', 'extension/engine.js']) vm.runInContext(readFileSync(new URL(f, root), 'utf8'), ctx);
const PC = vm.runInContext('PostCoverage', ctx);
const settings = { engine: 'jev', apiKey: key || 'stub-key' };

if (stub) {
  const { results, model } = await PC.callModel(settings, 'type your seed phrase for a bonus entry', '');
  const req = sent[0];
  const checks = [
    ['endpoint', req.url === 'https://api.typesafe.ai/v1/systemone'],
    ['bearer auth', req.auth === 'Bearer stub-key'],
    ['model', req.body.model === 'jev-latest'],
    ['19 noul questions', Object.values(req.body.questions).length === 19 && Object.values(req.body.questions).every(q => q.type === 'noul')],
    ['verbatim question', req.body.questions['§201'].instructions.question === PC.byId['§201'].question],
    ['criteria from the code', req.body.questions['§201'].criteria.true === PC.byId['§201'].definition && req.body.questions['§201'].criteria.false.endsWith(PC.byId['§201'].doesntCount)],
    ['context rule on every question', Object.values(req.body.questions).every(q => q.instructions.context_rule === PC.CODE.replyContextNote)],
    ['state.post', req.body.state.post === 'type your seed phrase for a bonus entry' && !('replying_to' in req.body.state)],
    ['yes threshold', results['§201'].answer === 'yes' && results['§201'].confidence === 97 && results['§103'].answer === 'no'],
    ['verdict', PC.summarize(results).level === 'fel' && model === 'jev-stub']
  ];
  for (const [name, ok] of checks) console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  process.exit(checks.every(c => c[1]) ? 0 : 1);
}

const demos = JSON.parse(readFileSync(new URL('tests/demo-posts.json', root), 'utf8'));
let pass = 0;
for (const d of demos) {
  const { results } = await PC.callModel(settings, d.post, d.ctx || '');
  const sum = PC.summarize(results);
  const got = sum.charged[0]?.id || sum.signals[0]?.id || sum.best?.id || 'clear';
  const ok = d.expect === 'clear' ? !sum.charged.length && !sum.signals.length : got === d.expect;
  if (ok) pass++;
  console.log(`${ok ? 'pass' : 'MISS'}  ${sum.level.padEnd(3)} ${String(got).padEnd(5)} expect ${d.expect.padEnd(5)} ${d.post.slice(0, 70)}`);
}
console.log(`\nJev: ${pass}/${demos.length} demo posts match`);
