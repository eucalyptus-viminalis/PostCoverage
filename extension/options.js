const $ = id => document.getElementById(id);
const FIELDS = ['engine', 'model', 'apiKey', 'baseUrl', 'autoModel'];

function sync() {
  const e = $('engine').value;
  document.querySelector('.llm').style.display = e === 'keyword' ? 'none' : '';
  document.querySelector('.oa').style.display = e === 'openai' ? '' : 'none';
  $('model').placeholder = PostCoverage.DEFAULT_MODELS[e] || '';
}

let timer;
function save() {
  const v = {};
  for (const f of FIELDS) v[f] = f === 'autoModel' ? $(f).checked : $(f).value;
  chrome.storage.local.set(v).then(() => {
    $('saved').textContent = 'Saved';
    clearTimeout(timer); timer = setTimeout(() => $('saved').textContent = '', 1200);
  });
}

chrome.storage.local.get(FIELDS).then(s => {
  $('engine').value = s.engine || 'keyword';
  $('model').value = s.model || '';
  $('apiKey').value = s.apiKey || '';
  $('baseUrl').value = s.baseUrl || 'http://localhost:11434/v1';
  $('autoModel').checked = !!s.autoModel;
  sync();
});
for (const f of FIELDS) $(f).addEventListener(f === 'engine' || f === 'autoModel' ? 'change' : 'input', () => { sync(); save(); });
