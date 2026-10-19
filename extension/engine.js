/* PostCoverage engine: shared by the extension (content + background) and post-check.html.
   Needs globalThis.NETWORK_CODE (network-code.js) loaded first. */
(function (root) {
  const CODE = root.NETWORK_CODE;
  const RULES = CODE.rules;
  const byId = Object.fromEntries(RULES.map(r => [r.id, r]));
  const POST_CHARGES = RULES.filter(r => r.kind === 'Post charge');
  const POST_COMMS = RULES.filter(r => r.kind === 'Post commendation');
  const ACCT = RULES.filter(r => r.kind === 'Account charge');
  const SIGNAL_IDS = ['§A1', '§A2', '§A3', '§A4', '§A5'];
  const SEV = { Infraction: 1, Misdemeanor: 2, Felony: 3 };
  const SEV_CLS = { Infraction: 'inf', Misdemeanor: 'mis', Felony: 'fel' };
  const SEV_EFFECT = { Infraction: 'typically result in warnings', Misdemeanor: 'typically result in suspensions', Felony: 'typically result in bans' };
  const DEFAULT_MODELS = { jev: 'jev-latest', openai: 'llama3.1' };
  const ENGINES = ['keyword', 'jev', 'openai'];
  const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
  const JEV_YES = 0.65; /* noul is P(yes). On the demo posts, wrong flags sat at 0.52-0.58 and right ones at 0.66+, so values near 0.5 (the model is unsure) don't count */
  const ruleUrl = r => CODE.source + (r.anchor ? '#' + r.anchor : '');

  const MODEL_IDS = () => [...POST_CHARGES, ...POST_COMMS].map(r => r.id).concat(SIGNAL_IDS);
  const SIGNAL_FRAME = 'These are normally asked across many recent posts. Here you see only one post, so answer: does THIS post look like one of the posts that would build toward a yes on this question?';

  /* ---------- Jev engine: one noul question per rule, verbatim ---------- */
  function jevRequest(post, ctx, model) {
    const questions = {};
    for (const id of MODEL_IDS()) {
      const r = byId[id];
      const instructions = { question: r.question, context_rule: CODE.replyContextNote };
      if (SIGNAL_IDS.includes(id)) instructions.scope = SIGNAL_FRAME;
      /* criteria reuse the code's own definition and "Doesn't count" text for what a yes and a no mean */
      questions[id] = { type: 'noul', instructions, criteria: { true: r.definition, false: "Doesn't count: " + r.doesntCount } };
    }
    const state = { post }; if (ctx) state.replying_to = ctx;
    return { state, model, questions };
  }
  function jevResults(data) {
    const out = {};
    for (const [id, a] of Object.entries(data.answers || {})) {
      if (typeof a?.noul !== 'number') continue;
      out[id] = { answer: a.noul >= JEV_YES ? 'yes' : 'no', confidence: Math.round(a.noul * 100) };
    }
    if (!Object.keys(out).length) throw new Error('Jev returned no answers.');
    return out;
  }

  /* ---------- LLM engine: verbatim Network Code prompts ---------- */
  function systemPrompt() {
    const q = r => `### ${r.id} ${r.title}\n${r.question}`;
    return [
      'You apply the Farcaster Network Code to a single post. Answer each numbered question below independently, exactly as written. Each question says what counts, what never counts, and that when unclear you should lean no.',
      `Context rule (added to every post question): ${CODE.replyContextNote}`,
      'The input is JSON with "post" (the words to judge) and optionally "replying_to".',
      '## Post charges', POST_CHARGES.map(q).join('\n\n'),
      '## Post commendations', POST_COMMS.map(q).join('\n\n'),
      '## Account-pattern questions',
      SIGNAL_FRAME,
      ACCT.filter(r => SIGNAL_IDS.includes(r.id)).map(q).join('\n\n'),
      '## Output',
      `Reply with JSON only, no prose, shaped as {"results":{"<id>":{"answer":"yes"|"no","confidence":0-100,"reason":"one short sentence"}}} with one entry for every id: ${MODEL_IDS().join(', ')}.`
    ].join('\n\n');
  }
  function userPrompt(post, ctx) {
    const o = { post }; if (ctx) o.replying_to = ctx; return JSON.stringify(o);
  }
  function parseJson(text) {
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    if (s < 0 || e < s) throw new Error('The model did not return JSON.');
    const o = JSON.parse(text.slice(s, e + 1));
    return o.results || o;
  }
  /* settings: {engine: 'jev'|'openai', model, apiKey, baseUrl}. Resolves {results, model}. */
  async function callModel(settings, post, ctx) {
    const model = (settings.model || DEFAULT_MODELS[settings.engine] || '').trim();
    const key = (settings.apiKey || '').trim();
    if (settings.engine === 'jev') {
      if (!key) throw new Error('Add a TypeSafe API key in settings.');
      const res = await fetch(JEV_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify(jevRequest(post, ctx, model))
      });
      if (!res.ok) throw new Error(`TypeSafe API ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return { results: jevResults(data), model: data.model || model };
    }
    if (settings.engine === 'openai') {
      const base = (settings.baseUrl || 'http://localhost:11434/v1').trim().replace(/\/+$/, '');
      const body = { model, temperature: 0, messages: [{ role: 'system', content: systemPrompt() }, { role: 'user', content: userPrompt(post, ctx) }] };
      const send = b => fetch(base + '/chat/completions', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, key ? { authorization: 'Bearer ' + key } : {}), body: JSON.stringify(b) });
      let res = await send(Object.assign({ response_format: { type: 'json_object' } }, body));
      if (res.status === 400) res = await send(body);
      if (!res.ok) throw new Error(`Endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return { results: parseJson(data.choices[0].message.content), model: data.model || model };
    }
    throw new Error('No model engine selected.');
  }

  /* ---------- keyword engine (offline fallback) ---------- */
  /* Protected groups from §102: race or ethnicity, religion, gender, sexuality, class, nationality.
     Political camps are not protected groups, so they're left out. Slurs are left out too: the model check covers them. */
  const G_ADJ = '(?:black|white|brown|asian|african|arab|hispanic|latino|latina|indian|chinese|japanese|korean|mexican|jewish|muslim|christian|catholic|hindu|sikh|buddhist|gay|lesbian|bi|bisexual|trans|transgender|queer|poor|russian|ukrainian|israeli|palestinian|iranian|pakistani|nigerian|filipino|vietnamese)';
  const G_NOUN = '(?:jews|muslims|christians|catholics|hindus|sikhs|buddhists|atheists|gays|lesbians|homosexuals|trans people|transgenders|blacks|whites|asians|arabs|africans|hispanics|latinos|mexicans|indians|chinese|russians|ukrainians|israelis|palestinians|iranians|pakistanis|nigerians|immigrants|refugees|women|men|females|males)';
  const GROUP = `(?:${G_ADJ}\\s+(?:people|folks|persons|men|women|guys|girls|kids|families|community|communities)|${G_NOUN})`;
  const g = (src) => new RegExp(src.replace(/GROUP/g, GROUP), 'i');
  const KW = {
    '§201': [/\b(seed|recovery|secret)\s*phrase\b/i, /\bprivate\s*key/i, /connect (your )?wallet.{0,40}(claim|verify|fix)/i, /(claim|check).{0,30}airdrop.{0,40}(\.xyz|\.app|\.io|before it expires)/i, /\bguaranteed\b.{0,30}(profit|return)/i, /\d+(\.\d+)?%\s*(daily|per day)/i, /send\s+[\d.]+\s*(eth|sol|usdc|usdt).{0,30}get\s+[\d.]+/i, /\b(double|2x) your (eth|crypto|money)/i, /dm me.{0,30}(wallet support|invest)/i, /earn\s+\d+\s*(usdt|usdc).{0,20}(a day|daily|inviting)/i, /\bwrite\s+"?done"?\b.{0,40}\b(tesla|iphone|car|\$\d)/i],
    '§105': [/\bkys\b/i, /\bkill (yo)?urself\b/i, /\b(go|just) die\b/i, /\bdrop dead\b/i, /\bi('?ll| will| am gonna|'m gonna|m going to|m gonna)\s+(kill|beat|break|smack|hurt|stab|shoot|end|murder|find)\s+(you|him|her|them)\b/i, /\bhope (you|he|she) (get|gets) (cancer|aids|hit by)/i, /\bhope (you|he|she) (dies?|burns?)\b/i, /\byou (should|deserve to) (die|be (killed|shot|beaten|raped))\b/i, /\bi know where you live\b/i, /\bi('?ve| have) got your (location|address)\b/i, /\bsomeone should (shoot|kill|stab|beat)\b/i, /\bmeet me outside\b/i, /\bi('?ll| will) (dox|swat) you\b/i],
    '§102': [
      g(String.raw`\bi\s+(really\s+)?(hate|despise|loathe|detest|can'?t stand)\s+(all\s+)?(the\s+)?GROUP\b`),
      g(String.raw`\bGROUP\s+(are|r|is)\s+(all\s+|just\s+|nothing but\s+)?(animals|vermin|subhuman|sub-human|trash|garbage|scum|filth|filthy|disgusting|parasites|cockroaches|rats|savages|inferior|a plague|a disease|evil|criminals|thieves)\b`),
      g(String.raw`\b(kill|gas|exterminate|wipe out|deport|hang|shoot|burn|nuke)\s+(all\s+)?(the\s+)?(of\s+)?(the\s+)?GROUP\b`),
      g(String.raw`\bGROUP\s+(should|need to|deserve to|must)\s+(all\s+)?(die|suffer|burn|be (killed|gassed|exterminated|wiped out|deported|removed))\b`),
      g(String.raw`\bdeath to (all\s+)?(the\s+)?GROUP\b`),
      g(String.raw`\b(don'?t|never) (hire|rent to|serve|trust) (a |any )?GROUP\b`),
      /\b(they|these people|those people|all of them)\s+are\s+(all\s+)?(animals|vermin|subhuman|cockroaches|parasites)\b/i, /\bgo back (to )?where (you|they) came from\b/i, /\bsynagogue of sat(an|urn)\b/i, /\bgoyim\b/i, /\bkhazarian\b/i, /\brothschild famil(y|ies)\b/i, /\byou all know who i mean\b/i],
    '§104': [/\b(women|girls|men|guys)\s+can'?t\s+(drive|think|code|do math)\b/i, /\bnever trust an?\s+[A-Z][a-z]+/, /\bare all (addicted|thieves|lazy|dirty|stupid|cheap|greedy)\b/i, g(String.raw`\bGROUP\s+(are|r)\s+(so\s+)?(bad at|dumb|stupid|lazy|cheap|greedy|dirty|smelly)\b`)],
    '§101': [/\bfuck you\b/i, /\bgo fuck yourself\b/i, /\bshut the fuck up\b/i, /\byou coward\b/i, /\bnext time at me\b/i, /\bcome (at|fight) me\b.{0,20}(bitch|coward|pussy)/i, /\b(fucking|fuckin)\s+(whiny|idiot|moron|loser|bitch|clown)/i],
    '§103': [/\b(you('?re| are)|ur|u r|youre)\s+(an?\s+|such an?\s+|a total\s+|a complete\s+|so\s+)?(idiot|moron|loser|clown|stupid|dumb|pathetic|joke|imbecile|braindead|brain dead)/i, /\bstfu\b/i, /\bfuck off\b/i, /\bpathetic loser\b/i, /\bcrawl back under\b/i, /\blil bitch\b/i, /\bdogshit\b/i, /\bnobody asked you\b/i],
    '§203': [/\bmoon landing\b.{0,30}(fake|staged|studio|hoax)/i, /\b(fake|staged|filmed).{0,30}moon landing/i, /\bno one has ever been on the moon\b/i, /\b5g\b.{0,30}(covid|virus|cancer)/i, /\bvaccines?\b.{0,40}(microchip|hiv|nanobots|graphene|5g)/i, /\bchemtrails?\b/i, /\bholocaust (never happened|is a (lie|hoax))\b/i]
  };
  /* Context that clears a match: game or sports trash talk is not a threat or a fight (§101, §105 "never count"). */
  const KW_EXEMPT = {
    '§105': [/\b(in|at)\s+(mario ?kart|smash|chess|fortnite|fifa|cod|halo|league|valorant|poker|ping ?pong|the (game|match|tournament|finals))\b/i],
    '§101': [/\b(in|at)\s+(mario ?kart|smash|chess|fortnite|fifa|cod|halo|league|valorant|poker|ping ?pong|the (game|match|tournament|finals))\b/i]
  };
  const KW_ACCT = {
    '§A2': [/^(great|nice|awesome|amazing|love)\s+(insight|post|project|vision|work)[!.\s]*(🚀|🔥|💯)*\s*$/i],
    '§A3': [/[?&](ref|referral|invite)=/i, /\b(referral|invite)\s*(code|link)\b/i, /\bfollow(ed)?\s*(for|4)\s*follow\b|\bf4f\b|\bcan back\b/i, /\bclaim (your|my) (daily|free)\b/i],
    '§A4': [/here'?s a (polished|short|revised) version/i, /\bas an ai\b/i, /\bcertainly! here\b/i, /\bif you want, i can\b/i, /\bisn'?t just\b.{0,40}\bit'?s\b/i, /\bsignals a (structural|fundamental) shift\b/i],
    '§A5': [/\b(100|1000)x\b/i, /\byou'?re (still )?early\b/i, /\b(last chance|load up|ape in|send it)\b/i, /\bCA:\s*\S+/, /\b0x[a-fA-F0-9]{40}\b/, /\bjust buy \$[A-Za-z]+/i],
    '§A1': []
  };
  const KW_COMM = {
    G1: [/\bhere'?s (how|what|why)\b/i, /\b(works by|under the hood|step \d|first,.{0,80}then)\b/i, /```|`[^`]+`/, /\b(because|which means|so that)\b.{0,120}\b(code|function|protocol|algorithm|compiler|database|query|cache|gas|consensus|block|equation)\b/i],
    G2: [/\b(shipped|built|launched|released|made|wrote|finished)\b.{0,200}\b(how|because|why|p\d\d|ms|lines|stack|learned|lesson|took|using|with)\b/i],
    G3: [/\b(you can|try|use|check out|here'?s the|for your case|the fix is|i'?d recommend)\b/i],
    G4: [/\b(i think|i'?d argue|my take|the reason|therefore|this means|which is why|the real (issue|problem))\b/i],
    G5: [/\b(correction|i was wrong|i got (this|that) wrong|actually,?)\b.{0,160}\b(source|docs?|according to|report|data|p\.\s?\d|link|shows?)\b/i, /\b(that stat|that number|that'?s not right).{0,80}\b(source|says|report|docs)\b/i],
    G6: [/\b(congrats|congratulations|well done|great (work|job|post)|awesome|brilliant|amazing|so good|love (this|your))\b/i],
    G7: [/\b(i see it differently|i disagree|i don'?t think|respectfully|fair point|you'?re right that|we agree on|i'?d push back)\b.{0,200}\b(because|since|but|however|why|the reason)\b/i]
  };
  function judgeKeywords(post, ctx) {
    const out = {};
    const hit = (pats) => pats.find(p => p.test(post));
    for (const r of POST_CHARGES) {
      const p = !hit(KW_EXEMPT[r.id] || []) && hit(KW[r.id] || []);
      out[r.id] = p ? { answer: 'yes', confidence: 60, reason: 'Matched pattern: ' + (post.match(p) || [''])[0].slice(0, 60) } : { answer: 'no', confidence: 50 };
    }
    for (const id of SIGNAL_IDS) {
      const p = hit(KW_ACCT[id] || []);
      out[id] = p ? { answer: 'yes', confidence: 55, reason: 'Matched pattern: ' + (post.match(p) || [''])[0].slice(0, 60) } : { answer: 'no', confidence: 50 };
    }
    const words = post.trim().split(/\s+/).length;
    for (const r of POST_COMMS) {
      let score = 0; const why = [];
      for (const p of KW_COMM[r.id] || []) if (p.test(post)) { score += why.length ? 15 : 40; why.push((post.match(p) || [''])[0].slice(0, 40)); }
      if (r.id === 'G3' || r.id === 'G7') score = ctx ? score : Math.round(score / 2);
      if (r.id === 'G3' && ctx && /\?/.test(ctx)) score += 15;
      if ((r.id === 'G6' && (ctx || /@\w+/.test(post))) || (r.id === 'G7' && ctx && score)) score += 15;
      if (r.id === 'G2' && score && /^(just\s+)?(shipped|built|launched|released|made)\b/i.test(post)) score += 15;
      if (['G1', 'G2', 'G4', 'G5'].includes(r.id)) score += words > 60 ? 20 : words > 25 ? 10 : -10;
      score = Math.max(0, Math.min(85, score));
      out[r.id] = { answer: score >= 45 ? 'yes' : 'no', confidence: score, reason: why.length ? 'Cues: ' + why.join('; ') : '' };
    }
    return out;
  }

  /* ---------- verdict ---------- */
  const isYes = v => !!v && String(v.answer).toLowerCase().startsWith('y');
  function summarize(results) {
    const charged = POST_CHARGES.filter(r => isYes(results[r.id])).sort((a, b) => SEV[b.severity] - SEV[a.severity]);
    const signals = SIGNAL_IDS.filter(id => isYes(results[id])).map(id => byId[id]);
    const comms = POST_COMMS.filter(r => isYes(results[r.id])).sort((a, b) => (results[b.id].confidence || 0) - (results[a.id].confidence || 0));
    const best = charged.length ? null : comms[0] || null;
    let level, title, desc;
    if (charged.length) {
      const top = charged[0];
      level = SEV_CLS[top.severity];
      title = `Possible ${top.severity.toLowerCase()}: ${top.id} ${top.title}`;
      desc = `${top.severity === 'Felony' ? 'Felonies' : top.severity + 's'} ${SEV_EFFECT[top.severity]}.` + (charged.length > 1 ? ' Also flagged: ' + charged.slice(1).map(r => `${r.id} ${r.title} (${r.severity.toLowerCase()})`).join(', ') + '.' : '');
    } else if (signals.length) {
      level = 'inf';
      title = 'Clear of post charges, but watch your account record';
      desc = 'This post matches a pattern that counts toward ' + signals.map(r => `${r.id} ${r.title}`).join(', ') + ' if repeated across your recent posts.';
    } else {
      level = 'ok';
      title = 'All clear';
      desc = best ? `No charges. Likely commendation: ${best.id} ${best.title}.` : 'No charges. Nothing here earns a commendation yet, which is fine.';
    }
    return { level, title, desc, charged, signals, comms, best };
  }

  root.PostCoverage = { CODE, RULES, byId, POST_CHARGES, POST_COMMS, ACCT, SIGNAL_IDS, SEV, SEV_CLS, DEFAULT_MODELS, ENGINES, jevRequest, jevResults, ruleUrl, isYes, systemPrompt, userPrompt, parseJson, callModel, judgeKeywords, summarize };
})(globalThis);
