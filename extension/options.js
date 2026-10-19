const $ = id => document.getElementById(id);
/* Model and key are stored per engine so a TypeSafe key is never sent to another endpoint. */
const perEngine = f => f + '.' + $('engine').value;
let stored = {};

function sync() {
  const e = $('engine').value;
  document.querySelector('.llm').style.display = e === 'keyword' ? 'none' : '';
  document.querySelector('.oa').style.display = e === 'openai' ? '' : 'none';
  $('model').placeholder = PostCoverage.DEFAULT_MODELS[e] || '';
  $('model').value = stored[perEngine('model')] || '';
  $('apiKey').value = stored[perEngine('apiKey')] || '';
}

let timer;
function save(v) {
  Object.assign(stored, v);
  chrome.storage.local.set(v).then(() => {
    $('saved').textContent = 'Saved';
    clearTimeout(timer); timer = setTimeout(() => $('saved').textContent = '', 1200);
  });
}

chrome.storage.local.get(null).then(s => {
  stored = s;
  $('engine').value = PostCoverage.ENGINES.includes(s.engine) ? s.engine : 'keyword';
  $('baseUrl').value = s.baseUrl || 'http://localhost:11434/v1';
  $('autoModel').checked = !!s.autoModel;
  sync();
});
$('engine').addEventListener('change', () => { save({ engine: $('engine').value }); sync(); });
$('autoModel').addEventListener('change', () => save({ autoModel: $('autoModel').checked }));
$('baseUrl').addEventListener('input', () => save({ baseUrl: $('baseUrl').value }));
$('model').addEventListener('input', () => save({ [perEngine('model')]: $('model').value }));
$('apiKey').addEventListener('input', () => save({ [perEngine('apiKey')]: $('apiKey').value }));
