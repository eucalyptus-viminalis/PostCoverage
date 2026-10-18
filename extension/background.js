importScripts('network-code.js', 'engine.js');

const DEFAULTS = { engine: 'keyword', model: '', apiKey: '', baseUrl: 'http://localhost:11434/v1', autoModel: false };

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'postcoverage:options') { chrome.runtime.openOptionsPage(); return; }
  if (msg?.type !== 'postcoverage:model') return;
  (async () => {
    const settings = Object.assign({}, DEFAULTS, await chrome.storage.local.get(Object.keys(DEFAULTS)));
    try {
      const results = await PostCoverage.callModel(settings, msg.post, msg.ctx);
      reply({ ok: true, results, model: settings.model || PostCoverage.DEFAULT_MODELS[settings.engine] });
    } catch (e) {
      reply({ ok: false, error: String(e.message || e) });
    }
  })();
  return true;
});
