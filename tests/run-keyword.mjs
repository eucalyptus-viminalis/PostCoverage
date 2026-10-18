// Runs tests/demo-posts.json through the keyword engine.  Usage: node tests/run-keyword.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const ctx = vm.createContext({});
for (const f of ['extension/network-code.js', 'extension/engine.js']) vm.runInContext(readFileSync(new URL(f, root), 'utf8'), ctx);
const PC = vm.runInContext('PostCoverage', ctx);
const demos = JSON.parse(readFileSync(new URL('tests/demo-posts.json', root), 'utf8'));

let fail = 0, limits = 0;
for (const d of demos) {
  const sum = PC.summarize(PC.judgeKeywords(d.post, d.ctx || ''));
  const got = sum.charged[0]?.id || sum.signals[0]?.id || sum.best?.id || 'clear';
  const ok = d.expect === 'clear' ? !sum.charged.length && !sum.signals.length : got === d.expect;
  const tag = ok ? 'pass' : d.limit ? 'limit' : 'FAIL';
  if (tag === 'FAIL') fail++; if (tag === 'limit') limits++;
  console.log(`${tag.padEnd(5)} ${sum.level.padEnd(3)} ${String(got).padEnd(5)} expect ${d.expect.padEnd(5)} ${d.post.slice(0, 70)}`);
}
console.log(`\n${demos.length - fail - limits} pass, ${limits} known keyword limits, ${fail} fail`);
process.exit(fail ? 1 : 0);
