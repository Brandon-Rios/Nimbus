// Small syntax highlighter for code blocks in chat. Local and synchronous: one regex pass per block,
// no library, no network. Returns escaped HTML with <span class="tk-…"> tokens.
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const KW = {
  js: 'await async break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield interface type enum implements readonly private public protected as',
  py: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self',
  sh: 'if then else elif fi for while until do done case esac in function return export local readonly set unset source sudo echo cd exit',
  sql: 'select from where and or not insert into values update set delete create table index drop alter join left right inner outer on group by order having limit offset as distinct union all primary key foreign references default null is like in exists case when then else end begin commit',
  ps: 'function param if else elseif foreach for while do switch return try catch finally throw begin process end',
  css: 'important',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
  rs: 'as break const continue crate else enum extern fn for if impl in let loop match mod move mut pub ref return self static struct super trait type unsafe use where while async await dyn',
  c: 'auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class public private protected namespace using new delete template virtual bool',
  java: 'abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long new package private protected public return short static super switch this throw throws try void while var string using namespace',
};
const LIT = 'true false null undefined None True False nil NaN';
const ALIAS = { javascript: 'js', jsx: 'js', ts: 'js', tsx: 'js', typescript: 'js', mjs: 'js', node: 'js', json: 'json', jsonc: 'json',
  python: 'py', py3: 'py', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', sh: 'sh', powershell: 'ps', pwsh: 'ps', ps1: 'ps',
  html: 'html', xml: 'html', svg: 'html', vue: 'html', css: 'css', scss: 'css', yaml: 'yaml', yml: 'yaml', toml: 'yaml', ini: 'yaml', conf: 'yaml',
  sql: 'sql', sqlite: 'sql', diff: 'diff', patch: 'diff', go: 'go', rust: 'rs', rs: 'rs', c: 'c', cpp: 'c', 'c++': 'c', h: 'c',
  java: 'java', cs: 'java', csharp: 'java', kotlin: 'java', php: 'js', rb: 'py', ruby: 'py', dockerfile: 'sh', makefile: 'sh' };
export const LANG_NAME = { js: 'JavaScript', json: 'JSON', py: 'Python', sh: 'Shell', ps: 'PowerShell', html: 'HTML', css: 'CSS', yaml: 'YAML',
  sql: 'SQL', diff: 'Diff', go: 'Go', rs: 'Rust', c: 'C/C++', java: 'Java/C#' };

// Best guess when the block has no language tag.
function guess(code) {
  if (/^(diff --git|@@ |--- a\/|\+\+\+ b\/)/m.test(code)) return 'diff';
  if (/^\s*[{[]/.test(code) && /"\s*:/.test(code)) { try { JSON.parse(code); return 'json'; } catch {} }
  if (/^\s*</.test(code) && /<\/?[a-z][\w-]*[\s>]/i.test(code)) return 'html';
  if (/^\s*(def |import \w+$|from \w+ import|class \w+:|print\()/m.test(code)) return 'py';
  if (/\b(const|let|function|=>|require\(|import .* from)\b/.test(code)) return 'js';
  if (/^\s*(SELECT|INSERT|UPDATE|CREATE|DELETE)\b/i.test(code)) return 'sql';
  if (/^\s*(\$\s|#!\/|sudo |apt |npm |git |cd |ls |curl |systemctl |docker |ssh )/m.test(code)) return 'sh';
  if (/^\s*[\w-]+:\s/m.test(code) && !/[;{}]/.test(code)) return 'yaml';
  return '';
}
const words = (s) => s.split(' ').filter(Boolean).join('|');
const RULES = {};
function rules(l) {
  if (RULES[l]) return RULES[l];
  const hashC = ['py', 'sh', 'yaml', 'ps'].includes(l), slashC = ['js', 'css', 'go', 'rs', 'c', 'java', 'json'].includes(l);
  const parts = [
    ['com', l === 'sql' ? /--[^\n]*|\/\*[\s\S]*?\*\// : l === 'html' ? /<!--[\s\S]*?-->/ : l === 'ps' ? /<#[\s\S]*?#>|#[^\n]*/ : hashC ? /#[^\n]*/ : slashC ? /\/\/[^\n]*|\/\*[\s\S]*?\*\// : null],
    ['str', l === 'py' ? /"""[\s\S]*?"""|'''[\s\S]*?'''|f?"(?:\\.|[^"\\\n])*"|f?'(?:\\.|[^'\\\n])*'/ : l === 'js' ? /`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/ : /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/],
    ['tag', l === 'html' ? /<\/?[A-Za-z][\w:-]*|\/?>/ : null],
    ['attr', l === 'html' ? /\b[\w:-]+(?==)/ : null],
    ['key', l === 'yaml' ? /^[ \t-]*[\w.-]+(?=\s*[:=])/m : l === 'css' ? /[\w-]+(?=\s*:[^;{}]*[;}])/ : null],
    ['var', l === 'sh' || l === 'ps' ? /\$\{?[\w:]+\}?/ : l === 'css' ? /--[\w-]+|@[\w-]+/ : null],
    ['num', /\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b|#[\da-fA-F]{3,8}\b/],
    ['lit', new RegExp(`\\b(?:${words(LIT)})\\b`)],
    ['kw', KW[l] ? new RegExp(`\\b(?:${words(KW[l])})\\b`, l === 'sql' || l === 'ps' ? 'i' : '') : null],
    ['fn', l === 'html' || l === 'yaml' || l === 'json' ? null : /\b[A-Za-z_]\w*(?=\s*\()/],
    ['flag', l === 'sh' || l === 'ps' ? /(?<=\s)--?[A-Za-z][\w-]*/ : null],
  ].filter((p) => p[1]);
  const re = new RegExp(parts.map(([, r]) => `(${r.source})`).join('|'), 'g' + (parts.some(([, r]) => r.flags.includes('i')) ? 'i' : '') + 'm');
  return (RULES[l] = { re, names: parts.map(([n]) => n) });
}

export function langOf(tag, code) {
  const t = String(tag || '').toLowerCase();
  return ALIAS[t] || (KW[t] || t === 'diff' ? t : '') || guess(code);
}

export function highlight(code, lang) {
  if (code.length > 60000 || !lang) return esc(code);
  if (lang === 'diff') return code.split('\n').map((l) => {
    const c = /^(\+\+\+|---)/.test(l) ? 'tk-meta' : l[0] === '+' ? 'tk-add' : l[0] === '-' ? 'tk-del' : l.startsWith('@@') ? 'tk-meta' : '';
    return c ? `<span class="${c}">${esc(l)}</span>` : esc(l);
  }).join('\n');
  const { re, names } = rules(lang === 'json' ? 'json' : lang);
  let out = '', last = 0;
  re.lastIndex = 0;
  for (let m; (m = re.exec(code));) {
    if (!m[0]) { re.lastIndex++; continue; }
    const i = m.slice(1).findIndex((x) => x !== undefined);
    let cls = names[i];
    // JSON: a string followed by a colon is a key.
    if (lang === 'json' && cls === 'str' && /^\s*:/.test(code.slice(re.lastIndex))) cls = 'key';
    out += esc(code.slice(last, m.index)) + `<span class="tk-${cls}">${esc(m[0])}</span>`;
    last = re.lastIndex;
  }
  return out + esc(code.slice(last));
}
