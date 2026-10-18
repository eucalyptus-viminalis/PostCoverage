/* PostCoverage content script: puts a live Network Code bar under every Farcaster composer. */
(() => {
  const PC = globalThis.PostCoverage;
  const EDITOR_SELECTOR = '.public-DraftEditor-content[contenteditable="true"]';
  const KEYWORD_DELAY = 250;
  const AUTO_MODEL_DELAY = 1500;
  const bars = new Map();
  let settings = { engine: 'keyword', autoModel: false };

  chrome.storage.local.get(['engine', 'autoModel']).then(s => { settings = Object.assign(settings, s); bars.forEach(b => b.refresh()); });
  chrome.storage.onChanged.addListener(ch => {
    for (const k in ch) settings[k] = ch[k].newValue;
    bars.forEach(b => b.refresh());
  });

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hasModel = () => settings.engine === 'anthropic' || settings.engine === 'openai';

  function isDark() {
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
    if (!m) return matchMedia('(prefers-color-scheme: dark)').matches;
    const [r, g, b] = m.map(Number);
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
  }

  const CSS = `
:host{all:initial;display:block;margin:6px 0 2px}
.wrap{--ok:#2f7a1f;--ok-bg:#e9f4df;--ok-line:#b9dc9b;--inf:#8a5a00;--inf-bg:#fbf1da;--inf-line:#f0d08a;--mis:#a8460f;--mis-bg:#fbe9df;--mis-line:#f1bc9c;--fel:#a32d2d;--fel-bg:#fcebeb;--fel-line:#f2b3b3;--muted:#6b7163;--line:#e3e5de;--card:#fff;--text:#1d2118;
  font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--text)}
.wrap.dark{--ok:#9fd67a;--ok-bg:#1f3315;--ok-line:#3a5c27;--inf:#f2c766;--inf-bg:#3a2c0d;--inf-line:#6b5216;--mis:#f3a777;--mis-bg:#3d2113;--mis-line:#6d3b1f;--fel:#f29b9b;--fel-bg:#3c1818;--fel-line:#6c2a2a;--muted:#a3aa98;--line:#2f342a;--card:#1c1f19;--text:#e8ebe2}
.bar{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:10px;padding:5px 8px;cursor:pointer;user-select:none;transition:background .15s,border-color .15s}
.bar .dot{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:700;color:#fff;flex:none}
.bar .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
.bar .t small{font-weight:400;color:var(--muted);margin-left:6px}
.chip{font-size:11px;padding:1px 8px;border-radius:999px;white-space:nowrap;background:var(--card);border:1px solid var(--line)}
button{all:unset;font-size:12px;padding:2px 9px;border-radius:7px;border:1px solid var(--line);background:var(--card);cursor:pointer;white-space:nowrap}
button:hover{border-color:currentColor}
.chev{color:var(--muted);font-size:11px;transition:transform .15s}
.open .chev{transform:rotate(180deg)}
.lv-idle .bar{color:var(--muted)} .lv-idle .dot{background:var(--line);color:var(--muted)}
.lv-ok .bar{background:var(--ok-bg);border-color:var(--ok-line);color:var(--ok)} .lv-ok .dot{background:var(--ok)}
.lv-inf .bar{background:var(--inf-bg);border-color:var(--inf-line);color:var(--inf)} .lv-inf .dot{background:var(--inf)}
.lv-mis .bar{background:var(--mis-bg);border-color:var(--mis-line);color:var(--mis)} .lv-mis .dot{background:var(--mis)}
.lv-fel .bar{background:var(--fel-bg);border-color:var(--fel-line);color:var(--fel)} .lv-fel .dot{background:var(--fel)}
.dark .dot{color:#10200a}
.panel{display:none;border:1px solid var(--line);border-top:0;border-radius:0 0 10px 10px;margin-top:-6px;padding:12px 10px 8px;background:var(--card)}
.open .panel{display:block}
.open .bar{border-radius:10px 10px 0 0}
.desc{color:var(--muted);margin:0 0 8px}
h4{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:8px 0 4px}
.row{display:flex;gap:8px;align-items:baseline;padding:3px 0}
.row .id{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--muted);width:36px;flex:none}
.row .n{flex:1}
.row .why{display:block;color:var(--muted);font-size:12px}
.row a{color:inherit;font-size:11px;color:var(--muted)}
.foot{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:11px;margin-top:8px;border-top:1px solid var(--line);padding-top:6px}
.err{color:var(--fel)}
.spin{display:inline-block;animation:s 1s linear infinite}@keyframes s{to{transform:rotate(360deg)}}
`;

  class Bar {
    constructor(editor) {
      this.editor = editor;
      this.host = document.createElement('postcoverage-bar');
      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.shadow.innerHTML = `<style>${CSS}</style><div class="wrap lv-idle"><div class="bar"></div><div class="panel"></div></div>`;
      this.wrap = this.shadow.querySelector('.wrap');
      this.open = false;
      this.text = '';
      this.model = null;          // {text, results, model} | {text, error}
      this.pending = false;
      this.cache = new Map();
      this.wrap.addEventListener('mousedown', e => { if (e.target.closest('button,.bar')) e.preventDefault(); });
      this.wrap.addEventListener('click', e => {
        e.stopPropagation();
        const btn = e.target.closest('button');
        if (btn?.dataset.act === 'ask') return this.askModel();
        if (btn?.dataset.act === 'settings') return chrome.runtime.sendMessage({ type: 'postcoverage:options' });
        if (e.target.closest('.bar')) { this.open = !this.open; this.render(); }
      });
      this.onInput = () => {
        clearTimeout(this.kt); this.kt = setTimeout(() => this.refresh(), KEYWORD_DELAY);
      };
      this.mo = new MutationObserver(this.onInput);
      this.mo.observe(editor, { subtree: true, childList: true, characterData: true });
      editor.addEventListener('input', this.onInput);
      this.place();
      this.refresh();
    }
    anchor() { return this.editor.closest('.DraftEditor-root') || this.editor; }
    place() {
      const a = this.anchor();
      if (a.nextSibling !== this.host) a.after(this.host);
    }
    readText() { return (this.editor.innerText || '').replace(/​/g, '').trim(); }
    readContext() {
      /* Farcaster's reply DOM isn't stable enough to scrape the parent cast yet, so replies are judged on their own words. */
      return '';
    }
    refresh() {
      this.wrap.classList.toggle('dark', isDark());
      this.text = this.readText();
      if (this.model && this.model.text !== this.text) this.model = null;
      if (this.cache.has(this.text)) this.model = this.cache.get(this.text);
      this.render();
      clearTimeout(this.at);
      if (hasModel() && settings.autoModel && this.text.length > 3 && !this.model) {
        this.at = setTimeout(() => this.askModel(), AUTO_MODEL_DELAY);
      }
    }
    async askModel() {
      if (!hasModel()) { chrome.runtime.sendMessage({ type: 'postcoverage:options' }); return; }
      const text = this.text;
      if (!text || this.pending) return;
      this.pending = true; this.render();
      let r;
      try { r = await chrome.runtime.sendMessage({ type: 'postcoverage:model', post: text, ctx: this.readContext() }); }
      catch (e) { r = { ok: false, error: String(e.message || e) }; }
      this.pending = false;
      const entry = r?.ok ? { text, results: r.results, model: r.model } : { text, error: r?.error || 'No response from the extension.' };
      if (r?.ok) this.cache.set(text, entry);
      if (this.text === text) this.model = entry;
      this.render();
    }
    render() {
      const bar = this.shadow.querySelector('.bar'), panel = this.shadow.querySelector('.panel');
      this.wrap.classList.toggle('open', this.open && !!this.text);
      if (!this.text) {
        this.wrap.className = this.wrap.className.replace(/lv-\w+/, 'lv-idle');
        bar.innerHTML = `<span class="dot">✓</span><span class="t">PostCoverage<small>checks your cast against the Network Code as you type</small></span>`;
        return;
      }
      const fromModel = this.model && this.model.results;
      const results = fromModel ? this.model.results : PC.judgeKeywords(this.text, this.readContext());
      const sum = PC.summarize(results);
      this.wrap.className = this.wrap.className.replace(/lv-\w+/, 'lv-' + sum.level);
      const icon = { ok: '✓', inf: '!', mis: '!', fel: '✕' }[sum.level];
      const short = sum.level === 'ok' ? 'All clear' : sum.charged.length ? `${sum.charged[0].severity}: ${sum.charged[0].title}` : 'Clear, but watch your account record';
      const chip = sum.best ? `<span class="chip">${esc(sum.best.id)} ${esc(sum.best.title)}</span>`
        : sum.charged.length > 1 ? `<span class="chip">+${sum.charged.length - 1} more</span>` : '';
      const ask = hasModel()
        ? (this.pending ? `<button disabled><span class="spin">◌</span> Checking</button>` : fromModel ? '' : `<button data-act="ask">Ask model</button>`)
        : '';
      bar.innerHTML = `<span class="dot">${icon}</span><span class="t">${esc(short)}<small>${fromModel ? 'model' : 'estimate'}</small></span>${chip}${ask}<span class="chev">▾</span>`;

      const row = (r, why, right = '') => `<div class="row"><span class="id">${esc(r.id)}</span><span class="n">${esc(r.title)}${why ? `<span class="why">${esc(why)}</span>` : ''}</span>${right}<a href="${esc(PC.ruleUrl(r))}" target="_blank" rel="noopener">rule</a></div>`;
      let html = `<p class="desc">${esc(sum.desc)}</p>`;
      if (sum.charged.length) html += `<h4>Post charges</h4>` + sum.charged.map(r => row(r, results[r.id].reason, `<span class="chip">${esc(r.severity)}</span>`)).join('');
      if (sum.signals.length) html += `<h4>Adds to an account pattern</h4>` + sum.signals.map(r => row(r, results[r.id].reason)).join('');
      if (!sum.charged.length) {
        html += `<h4>Commendation fit</h4>` + (sum.comms.length
          ? sum.comms.slice(0, 3).map(r => row(r, results[r.id].reason, `<span class="chip">${Math.round(results[r.id].confidence || 0)}%</span>`)).join('')
          : `<div class="row"><span class="n" style="color:var(--muted)">None yet. Teaching, building, helping, original insight, corrections, uplifting others and civil disagreement all earn one.</span></div>`);
      }
      const engine = fromModel ? `Checked by ${esc(this.model.model)} with the verbatim Network Code v${PC.CODE.version}`
        : `Keyword estimate, Network Code v${PC.CODE.version}` + (hasModel() ? '' : ' · set up a model for a full check');
      const err = this.model?.error ? `<div class="err">Model check failed: ${esc(this.model.error)}</div>` : '';
      html += err + `<div class="foot"><span>${engine}</span><button data-act="settings">Settings</button></div>`;
      panel.innerHTML = html;
    }
    alive() { return this.editor.isConnected; }
    destroy() { this.mo.disconnect(); clearTimeout(this.kt); clearTimeout(this.at); this.host.remove(); }
  }

  function scan() {
    for (const [ed, bar] of bars) {
      if (!bar.alive()) { bar.destroy(); bars.delete(ed); } else bar.place();
    }
    document.querySelectorAll(EDITOR_SELECTOR).forEach(ed => { if (!bars.has(ed)) bars.set(ed, new Bar(ed)); });
  }
  let queued = false;
  new MutationObserver(() => { if (!queued) { queued = true; setTimeout(() => { queued = false; scan(); }, 150); } }).observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
