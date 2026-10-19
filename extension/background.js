importScripts('network-code.js', 'engine.js');

const DEFAULTS = { engine: 'keyword', baseUrl: 'http://localhost:11434/v1' };

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'postcoverage:options') { chrome.runtime.openOptionsPage(); return; }
  if (msg?.type !== 'postcoverage:model') return;
  (async () => {
    const s = Object.assign({}, DEFAULTS, await chrome.storage.local.get(null));
    const settings = { engine: s.engine, baseUrl: s.baseUrl, model: s['model.' + s.engine], apiKey: s['apiKey.' + s.engine] };
    try {
      const { results, model } = await PostCoverage.callModel(settings, msg.post, msg.ctx);
      reply({ ok: true, results, model });
    } catch (e) {
      reply({ ok: false, error: String(e.message || e) });
    }
  })();
  return true;
});
