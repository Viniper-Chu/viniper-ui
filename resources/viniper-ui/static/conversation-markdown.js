/* Shared, offline conversation renderer. Raw messages remain the data source. */
(() => {
  const md = globalThis.markdownit({ html: false, breaks: true, linkify: true });
  const validateLink = md.validateLink.bind(md);
  md.validateLink = url => /^file:\/\//i.test(url) || validateLink(url);
  // Models often emit a local Markdown destination with literal spaces.
  // Parse it as an inline link without rewriting code blocks or source text.
  md.inline.ruler.before("link", "local_path_link", (state, silent) => {
    if (state.src[state.pos] !== "[") return false;
    const match = /^\[([^\]\n]+)\]\(((?:file:\/\/\/|\/(?!\/)|~\/|\.{1,2}\/)[^\n<>]*?)\)/.exec(state.src.slice(state.pos));
    if (!match || !/\s/.test(match[2])) return false;
    const href = md.normalizeLink(match[2]);
    if (!md.validateLink(href)) return false;
    if (!silent) {
      const open = state.push("link_open", "a", 1);
      open.attrs = [["href", href]];
      state.push("text", "", 0).content = match[1];
      state.push("link_close", "a", -1);
    }
    state.pos += match[0].length;
    return true;
  });
  const escape = md.utils.escapeHtml;
  const formulaCache = new Map();
  const delimiters = [["$$", "$$", true], ["\\[", "\\]", true], ["\\(", "\\)", false], ["$", "$", false]];

  function escapedAt(text, index) {
    let slashes = 0;
    while (index > 0 && text[--index] === "\\") slashes++;
    return slashes % 2 === 1;
  }

  function closingAt(text, close, start) {
    let index = text.indexOf(close, start);
    while (index >= 0) {
      if (!escapedAt(text, index)) {
        if (close === "$" && (/\s/.test(text[index - 1] || " ") || /\d/.test(text[index + 1] || ""))) return -2;
        return index;
      }
      index = text.indexOf(close, index + close.length);
    }
    return -1;
  }

  function typeset(source, display) {
    const key = `${display}:${source}`;
    if (formulaCache.has(key)) return formulaCache.get(key);
    const html = globalThis.katex.renderToString(source, {
      displayMode: display, output: "htmlAndMathml", throwOnError: true,
      strict: "ignore", trust: false, maxSize: 20, maxExpand: 1000,
    });
    if (formulaCache.size >= 256) formulaCache.delete(formulaCache.keys().next().value);
    formulaCache.set(key, html);
    return html;
  }

  function formula(source, display, { pending = false, raw = source } = {}) {
    let html;
    if (pending) html = '<span class="math-pending" role="status">公式生成中…</span>';
    else {
      try { html = typeset(source, display); }
      catch { html = `<span class="math-fallback" title="暂无法排版，保留 LaTeX 原文">${escape(raw)}</span>`; }
    }
    if (!display) return `<span class="math-inline">${html}</span>`;
    const copy = pending ? "" : `<button type="button" class="math-copy" data-copy="${escape(source)}" aria-label="复制公式 LaTeX 源码">复制公式</button>`;
    return `<span class="math-display">${copy}<span class="math-scroll" tabindex="0" role="group" aria-label="数学公式">${html}</span></span>`;
  }

  // Run before Markdown escaping/emphasis so TeX backslashes, underscores and
  // matrix row separators reach KaTeX unchanged. Code spans/fences stay literal.
  md.inline.ruler.before("escape", "viniper_math", (state, silent) => {
    const start = state.pos;
    const delimiter = delimiters.find(([open]) => state.src.startsWith(open, start));
    if (!delimiter) return false;
    const [open, close, display] = delimiter;
    const from = start + open.length;
    if (open === "$" && (/\s/.test(state.src[from] || " ") || /\d/.test(state.src[start - 1] || ""))) return false;
    const end = closingAt(state.src, close, from);
    if (end === -2) return false;
    const missing = end < 0;
    // A bare currency sign must not swallow the rest of an ordinary sentence.
    if (missing && (!state.env.streaming || (open === "$" && !/[\\^_=]/.test(state.src.slice(from))))) return false;
    const content = state.src.slice(from, missing ? state.posMax : end);
    if (open === "$" && /[\n`]/.test(content)) return false;
    if (!content.trim()) return false;
    if (!silent) {
      const token = state.push("viniper_math", "", 0);
      token.content = content;
      token.meta = { display, pending: missing, raw: state.src.slice(start, missing ? state.posMax : end + close.length) };
    }
    state.pos = missing ? state.posMax : end + close.length;
    return true;
  });
  md.renderer.rules.viniper_math = (tokens, index) => formula(tokens[index].content, tokens[index].meta.display, tokens[index].meta);

  md.block.ruler.before("fence", "viniper_math_block", (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const first = state.src.slice(start, state.eMarks[startLine]);
    const delimiter = delimiters.find(([open, , display]) => display && first.startsWith(open));
    if (!delimiter) return false;
    const [open, close] = delimiter;
    let last = startLine;
    let content = first.slice(open.length);
    let end = closingAt(content, close, 0);
    while (end < 0 && last + 1 < endLine) {
      last++;
      content += "\n" + state.src.slice(state.bMarks[last] + state.tShift[last], state.eMarks[last]);
      end = closingAt(content, close, 0);
    }
    if (end >= 0 && content.slice(end + close.length).trim()) return false;
    if (silent) return true;
    const token = state.push("viniper_math_block", "", 0);
    token.block = true;
    token.content = end >= 0 ? content.slice(0, end) : content;
    token.map = [startLine, last + 1];
    token.meta = { display: true, pending: end < 0 && Boolean(state.env.streaming), raw: open + content };
    // A finished but unclosed expression is kept verbatim instead of guessing.
    if (end < 0 && !state.env.streaming) token.meta.unclosed = true;
    state.line = last + 1;
    return true;
  }, { alt: ["paragraph", "reference", "blockquote", "list"] });
  md.renderer.rules.viniper_math_block = (tokens, index) => {
    const token = tokens[index];
    if (token.meta.unclosed) return `<p class="math-fallback">${escape(token.meta.raw)}</p>\n`;
    return formula(token.content.trim(), true, token.meta) + "\n";
  };

  function codeBlock(code, language) {
    const label = language ? `<span class="code-lang">${escape(language)}</span>` : "";
    return `<pre class="markdown-code">${label}<button type="button" class="copy-btn" data-copy="${escape(code)}">复制</button><code>${escape(code)}</code></pre>\n`;
  }
  md.renderer.rules.fence = (tokens, index, _options, env) => {
    const token = tokens[index];
    const language = token.info.trim().split(/\s+/)[0].toLowerCase();
    const code = token.content.replace(/\n$/, "");
    if (["math", "latex", "tex"].includes(language)) {
      let source = code.trim();
      for (const [open, close] of delimiters) {
        if (source.startsWith(open) && source.endsWith(close)) { source = source.slice(open.length, -close.length).trim(); break; }
      }
      try { typeset(source, true); return formula(source, true) + "\n"; }
      catch {
        if (env.streaming && index === tokens.length - 1) return formula(source, true, { pending: true });
        // Full TeX documents and unsupported packages are code, not equations.
      }
    }
    return codeBlock(code, language);
  };
  md.renderer.rules.code_block = (tokens, index) => codeBlock(tokens[index].content.replace(/\n$/, ""), "");
  md.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noreferrer noopener");
    return renderer.renderToken(tokens, index, options);
  };
  // Attachments own image loading; prose must not trigger remote image requests.
  md.renderer.rules.image = (tokens, index) => escape(tokens[index].content);
  md.renderer.rules.table_open = () => '<div class="markdown-table-scroll"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';
  globalThis.ViniperMarkdown = { render: (text, options = {}) => md.render(String(text || ""), options) };
})();
