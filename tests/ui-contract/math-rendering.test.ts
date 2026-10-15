import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const context = vm.createContext({ console, atob });
for (const path of ["vendor/markdown-it.js", "vendor/katex/katex.min.js", "conversation-markdown.js"]) {
  vm.runInContext(readFileSync(`resources/viniper-ui/static/${path}`, "utf8"), context);
}
const render = (text: string, streaming = false): string => context.ViniperMarkdown.render(text, { streaming });
const countMath = (html: string) => (html.match(/class="katex"/gu) || []).length;

test("real model math with Chinese prose and four delimiter styles renders without altering TeX", () => {
  const html = render(String.raw`在三棱锥 $O-ABC$ 中，$OA=a$，求 $\frac{1}{h^2}$。

行内 \(a_1^2+b_1^2=c_1^2\)。

\[\frac{1}{h^2}=\frac{1}{a^2}+\frac{1}{b^2}+\frac{1}{c^2}\]

$$\begin{aligned}f(x)&=x^2+1\\ f'(x)&=2x\end{aligned}$$`);
  assert.equal(countMath(html), 6);
  assert.match(html, /encoding="application\/x-tex">\\frac\{1\}\{h\^2\}/u);
  assert.doesNotMatch(html, /math-fallback/u);
  assert.match(html, /data-copy="\\begin\{aligned\}/u);
});

test("currency, escaped dollars, literal code and JSON are not equations", () => {
  const input = '价格 $5 和 $10；预算 US$20。\\$30。`$x^2$`\n\n```json\n{"proof":"$x^2$", "path":"C:\\\\tmp"}\n```';
  const html = render(input);
  assert.equal(countMath(html), 0);
  assert.match(html, /价格 \$5 和 \$10/u);
  assert.match(html, /<code>\$x\^2\$<\/code>/u);
  assert.match(html, /&quot;proof&quot;:&quot;\$x\^2\$&quot;/u);
  assert.match(html, /data-copy=/u);
});

test("math and equation-only latex fences render; full documents and other languages stay code", () => {
  const html = render('```math\n\\sqrt{2}\n```\n\n```latex\n\\[\\begin{cases}x^2&x>0\\\\0&x\\le0\\end{cases}\\]\n```\n\n```tex\n\\documentclass{article}\n\\begin{document}hello\\end{document}\n```\n\n```python\nprint("$x$")\n```');
  assert.equal(countMath(html), 2);
  assert.match(html, /\\documentclass/u);
  assert.match(html, /<span class="code-lang">python/u);
});

test("table cells, list items, Chinese text and ordinary Unicode math coexist", () => {
  const html = render(String.raw`| 项目 | 公式 |
| --- | --- |
| 高 | $\frac{1}{h^2}$ |

1. \(\text{当 }x\ge0\)
2. [-1,2]∪(3,+∞)，√2 ≠ 0

> $H\text{-}AO\text{-}B$`);
  assert.equal(countMath(html), 3);
  assert.match(html, /<td><span class="math-inline">/u);
  assert.match(html, /<ol>/u);
  assert.match(html, /\[-1,2\]∪\(3,\+∞\)，√2 ≠ 0/u);
});

test("streaming split delimiters never emit broken math; completion and reload agree", () => {
  const text = String.raw`结果：\[\frac{1}{h^2}=\frac{1}{a^2}\]`;
  for (let i = 0; i <= text.length; i++) {
    const html = render(text.slice(0, i), true);
    assert.doesNotMatch(html, /katex-error|math-fallback/u);
  }
  assert.match(render(String.raw`结果：\[\frac{1}{h`, true), /公式生成中/u);
  assert.equal(render(text, true), render(text));
  assert.equal(countMath(render(text)), 1);
  assert.match(render(String.raw`\[\frac{1}{h`, false), /math-fallback/u);
});

test("invalid equations retain readable source and never execute HTML or load resources", () => {
  const html = render(String.raw`$$\frac{1}{$$

<script>alert(1)</script>

$\href{javascript:alert(1)}{x}$

![remote](https://example.com/track.png)`);
  assert.match(html, /math-fallback/u);
  assert.doesNotMatch(html, /<script|<img|href="javascript:/u);
  assert.match(html, /&lt;script&gt;/u);
  assert.equal(countMath(render('$x^2$ after invalid expression')), 1);
});

test("file and web links are clickable while script URLs remain rejected", () => {
  const html=render('[成果](file:///tmp/a.pdf) [参考](https://example.com/page) [坏链接](javascript:alert(1))');
  assert.match(html,/href="file:\/\/\/tmp\/a.pdf"/u);
  assert.match(html,/href="https:\/\/example.com\/page"/u);
  assert.doesNotMatch(html,/href="javascript:/u);
});

test('local file links containing spaces work without rewriting literal code',()=>{
 const path='/Users/example/My Project/中文 结果.pdf';
 const html=render(`[成果](${path})\n\n\`[原样](${path})\`\n\n\`\`\`text\n[原样](${path})\n\`\`\``);
 assert.equal((html.match(/<a /g)||[]).length,1);
 assert.match(html,/href="\/Users\/example\/My%20Project\//);
 assert.match(html,/My Project\/中文 结果.pdf/);
});
