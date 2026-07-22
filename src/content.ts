// Content script: highlights Rell code on github.com, gitlab.com and
// bitbucket.org, including diff views (pull/merge requests, commits).
// Tokens are wrapped in each site's native syntax classes where
// possible (GitHub `pl-*`, GitLab `hljs-*`), so colors follow the site theme.
// Bitbucket file views are handled separately by a MAIN-world script that
// registers Rell as a Monaco language (see monaco.ts); this script only covers
// Bitbucket's rendered markdown blocks, with our own injected CSS.

import { tokenize, type Token, type TokenKind } from "./rell";

type ClassMap = Partial<Record<TokenKind, string>>;

const GITHUB_CLASSES: ClassMap = {
  keyword: "pl-k",
  literal: "pl-c1",
  number: "pl-c1",
  string: "pl-s",
  comment: "pl-c",
  annotation: "pl-en",
  defname: "pl-en",
};

// Styled by GitLab under `.code.highlight` for every theme (see
// app/assets/stylesheets/highlight/hljs.scss in gitlab-org/gitlab).
const GITLAB_CLASSES: ClassMap = {
  keyword: "hljs-keyword",
  literal: "hljs-literal",
  number: "hljs-number",
  string: "hljs-string",
  comment: "hljs-comment",
  annotation: "hljs-meta",
  defname: "hljs-title",
};

// GitLab diffs are highlighted server-side by Rouge, not highlight.js, so
// diff token classes are pygments short names styled by every syntax theme.
const GITLAB_DIFF_CLASSES: ClassMap = {
  keyword: "k",
  literal: "kc",
  number: "mi",
  string: "s",
  comment: "c",
  annotation: "nd",
  defname: "nf",
};

// Bitbucket markdown blocks have no reusable token classes; we ship our own.
const OWN_CLASSES: ClassMap = {
  keyword: "rl-k",
  literal: "rl-n",
  number: "rl-n",
  string: "rl-s",
  comment: "rl-c",
  annotation: "rl-a",
  defname: "rl-d",
};

const OWN_CSS = `
.rl-k{color:#cf222e}
.rl-n{color:#0550ae}
.rl-s{color:#0a3069}
.rl-c{color:#59636e}
.rl-a{color:#6639ba}
.rl-d{color:#6639ba}
@media (prefers-color-scheme: dark){
.rl-k{color:#ff7b72}
.rl-n{color:#79c0ff}
.rl-s{color:#a5d6ff}
.rl-c{color:#8b949e}
.rl-a{color:#d2a8ff}
.rl-d{color:#d2a8ff}
}`;

const MARK = "data-rell-highlighted";

function renderLine(text: string, tokens: Token[], classes: ClassMap): DocumentFragment {
  const frag = document.createDocumentFragment();
  let pos = 0;
  for (const t of tokens) {
    if (t.start > pos) frag.append(text.slice(pos, t.start));
    const cls = classes[t.kind];
    if (cls) {
      const span = document.createElement("span");
      span.className = cls;
      span.textContent = text.slice(t.start, t.end);
      frag.append(span);
    } else {
      frag.append(text.slice(t.start, t.end));
    }
    pos = t.end;
  }
  if (pos < text.length) frag.append(text.slice(pos));
  return frag;
}

// --- File views ------------------------------------------------------------

interface FileModel {
  lines: string[];
  tokens: Token[][];
}

let model: FileModel | null = null;
let modelKey: string | null = null;
let modelPending = false;

function buildModel(source: string): FileModel {
  return {
    lines: source.split("\n").map((l) => l.replace(/\r$/, "")),
    tokens: tokenize(source),
  };
}

/** GitHub blob/blame view: full source lives in a hidden textarea. */
function githubSource(): string | null {
  const textarea = document.getElementById(
    "read-only-cursor-text-area",
  ) as HTMLTextAreaElement | null;
  return textarea?.value ?? null;
}

/** GitLab blob/blame view: fetch the raw file once per page. */
function gitlabFetchSource(key: string): void {
  if (modelPending) return;
  modelPending = true;
  const rawPath = location.pathname
    .replace("/-/blob/", "/-/raw/")
    .replace("/-/blame/", "/-/raw/");
  fetch(rawPath)
    .then((r) => (r.ok ? r.text() : null))
    .then((text) => {
      // On failure, still record the key so we don't refetch in a loop.
      model = text !== null ? buildModel(text) : null;
      modelKey = key;
      if (model) schedule();
    })
    .finally(() => {
      modelPending = false;
    });
}

function highlightFileLines(
  lineSelector: string,
  classes: ClassMap,
  idPattern: RegExp,
): void {
  if (!model) return;
  for (const el of document.querySelectorAll<HTMLElement>(lineSelector)) {
    const m = idPattern.exec(el.id || el.closest("[id^='LC']")?.id || "");
    if (!m) continue;
    const idx = Number(m[1]) - 1;
    const text = model.lines[idx];
    const tokens = model.tokens[idx];
    if (text === undefined || tokens === undefined) continue;
    if (el.getAttribute(MARK) === text) continue;
    if (el.textContent !== text) continue;
    if (tokens.length > 0) {
      el.replaceChildren(renderLine(text, tokens, classes));
    }
    el.setAttribute(MARK, text);
  }
}

function runFileView(): void {
  const path = location.pathname;
  const host = location.hostname;

  if (host === "github.com") {
    if (!/^\/[^/]+\/[^/]+\/(blob|blame)\/.*\.rell$/i.test(path)) return;
    const source = githubSource();
    if (source === null) return;
    if (modelKey !== path + "\0" + source.length) {
      model = buildModel(source);
      modelKey = path + "\0" + source.length;
    }
    highlightFileLines(
      ".react-file-line, .react-code-text.react-code-line-contents-no-virtualization",
      GITHUB_CLASSES,
      /^LC(\d+)$/,
    );
    return;
  }

  if (host === "gitlab.com") {
    if (!/\/-\/(blob|blame)\/.*\.rell$/i.test(path)) return;
    if (modelKey !== path) {
      model = null;
      modelKey = null;
      gitlabFetchSource(path);
      return;
    }
    highlightFileLines("div.line[id^='LC']", GITLAB_CLASSES, /^LC(\d+)$/);
  }

  // bitbucket.org file views are Monaco-rendered; handled by monaco.ts.
}

// --- Diff views -------------------------------------------------------------

/**
 * Highlight one file's diff lines. Tokenizes all visible lines as one text so
 * block comments spanning lines keep their state across the hunk.
 */
function highlightDiffLines(els: HTMLElement[], classes: ClassMap): void {
  if (els.length === 0) return;
  const texts = els.map((el) => el.textContent ?? "");
  if (texts.every((t, i) => els[i]!.getAttribute(MARK) === t)) return;
  const lines = texts.map((t) => t.replace(/\n$/, ""));
  const perLine = tokenize(lines.join("\n"));
  els.forEach((el, i) => {
    const text = texts[i]!;
    if (el.getAttribute(MARK) === text) return;
    const tokens = perLine[i] ?? [];
    if (tokens.length > 0) {
      const frag = renderLine(lines[i]!, tokens, classes);
      if (text.endsWith("\n")) frag.append("\n");
      el.replaceChildren(frag);
    }
    el.setAttribute(MARK, text);
  });
}

// --- GitHub diff views (PR files-changed, commits, compare) -----------------

// The React diff viewer (PR files-changed, commit and compare pages) renders
// each file as a `table[data-diff-anchor]` whose nearest header-bearing
// ancestor holds the path in an `h3[class*='file-name']`, and every code line
// as `code.diff-text > span.diff-text-marker + div.diff-text-inner`. Unknown
// languages get plain text inside diff-text-inner; we tokenize line by line.

const GITHUB_DIFF_LINE = "code.diff-text > div.diff-text-inner";

function githubDiffFilePath(table: HTMLElement): string | null {
  let el = table.parentElement;
  let name: HTMLElement | null = null;
  while (el && !(name = el.querySelector("h3[class*='file-name']"))) {
    el = el.parentElement;
  }
  if (!name) return null;
  const text = (name.textContent ?? "").replace(/‎/g, "").trim();
  // Renames render as "old → new"; the new path decides the language.
  const arrow = text.lastIndexOf("→");
  return arrow === -1 ? text : text.slice(arrow + 1).trim();
}

function highlightGithubDiffs(): void {
  for (const group of document.querySelectorAll<HTMLElement>("table[data-diff-anchor]")) {
    const path = githubDiffFilePath(group);
    if (!path || !/\.rell$/i.test(path)) continue;
    highlightDiffLines(
      [...group.querySelectorAll<HTMLElement>(GITHUB_DIFF_LINE)],
      GITHUB_CLASSES,
    );
  }
}

// --- GitLab diff views (MR changes, commit and compare pages) ---------------

// Legacy view: each file renders as `.diff-file[data-path]`; code lines are
// `.line_content` elements holding plain text (the +/- marker is
// CSS-generated), except hunk header rows marked `match`/`expansion` on the
// `line_holder` row. Rapid diffs (commit pages, and MRs as GitLab rolls it
// out): `<diff-file>` custom elements with paths in the `data-file-data` JSON
// and one `pre.rd-line-text > span.line` per code line (hunk headers have no
// `pre`).

function highlightGitlabDiffs(): void {
  for (const file of document.querySelectorAll<HTMLElement>(".diff-file[data-path]")) {
    if (!/\.rell$/i.test(file.getAttribute("data-path") ?? "")) continue;
    const els = [...file.querySelectorAll<HTMLElement>(".line_content")].filter(
      (el) => {
        const row = el.closest(".line_holder");
        return !(row && /(^| )(match|expansion)( |$)/.test(row.className));
      },
    );
    highlightDiffLines(els, GITLAB_DIFF_CLASSES);
  }

  for (const file of document.querySelectorAll<HTMLElement>("diff-file")) {
    let path = "";
    try {
      const data = JSON.parse(file.getAttribute("data-file-data") ?? "{}");
      path = data.new_path || data.old_path || "";
    } catch {
      continue;
    }
    if (!/\.rell$/i.test(path)) continue;
    highlightDiffLines(
      [...file.querySelectorAll<HTMLElement>("pre.rd-line-text > span.line")],
      GITLAB_DIFF_CLASSES,
    );
  }
}

// --- Bitbucket PR diff views ------------------------------------------------

// Each file is `[data-qa="branch-diff-file"]` with its path in
// `[data-qa="bk-filepath"]`; each code line is `[data-qa="code-line"]` holding
// `span.diff-line-type` (the +/- marker) and `span.code-diff` (the code).
// Bitbucket's own token colors are scoped under a generated emotion class, so
// we ship our own CSS instead (same as Bitbucket markdown blocks).

function highlightBitbucketDiffs(): void {
  for (const file of document.querySelectorAll<HTMLElement>(
    "[data-qa='branch-diff-file']",
  )) {
    const raw =
      file.querySelector("[data-qa='bk-filepath']")?.textContent?.trim() ?? "";
    const arrow = raw.lastIndexOf("→");
    const path = arrow === -1 ? raw : raw.slice(arrow + 1).trim();
    if (!/\.rell$/i.test(path)) continue;
    injectOwnCss();
    highlightDiffLines(
      [
        ...file.querySelectorAll<HTMLElement>(
          "[data-qa='code-line'] span.code-diff",
        ),
      ],
      OWN_CLASSES,
    );
  }
}

// --- Markdown / comment code blocks ----------------------------------------

const MARKDOWN_SELECTOR = [
  'pre[lang="rell" i] > code', // GitHub READMEs / comments
  "code.language-rell", // generic (GitHub, Bitbucket)
  'pre[data-canonical-lang="rell" i] > code', // GitLab markdown
  'pre[data-lang="rell" i] > code',
].join(", ");

function markdownClasses(): ClassMap {
  if (location.hostname === "gitlab.com") return GITLAB_CLASSES;
  if (location.hostname === "github.com") return GITHUB_CLASSES;
  return OWN_CLASSES;
}

let ownCssInjected = false;

function injectOwnCss(): void {
  if (ownCssInjected) return;
  const style = document.createElement("style");
  style.textContent = OWN_CSS;
  document.head.append(style);
  ownCssInjected = true;
}

function highlightMarkdownBlocks(): void {
  const blocks = document.querySelectorAll<HTMLElement>(MARKDOWN_SELECTOR);
  if (blocks.length === 0) return;
  const classes = markdownClasses();
  if (classes === OWN_CLASSES) injectOwnCss();
  for (const code of blocks) {
    if (code.hasAttribute(MARK)) continue;
    const text = code.textContent ?? "";
    const perLine = tokenize(text);
    const lines = text.split("\n");
    const frag = document.createDocumentFragment();
    lines.forEach((line, i) => {
      if (i > 0) frag.append("\n");
      frag.append(renderLine(line, perLine[i] ?? [], classes));
    });
    code.replaceChildren(frag);
    code.setAttribute(MARK, "1");
  }
}

// --- Scheduling ------------------------------------------------------------

let scheduled = false;

function run(): void {
  scheduled = false;
  runFileView();
  if (location.hostname === "github.com") highlightGithubDiffs();
  if (location.hostname === "gitlab.com") highlightGitlabDiffs();
  if (location.hostname === "bitbucket.org") highlightBitbucketDiffs();
  highlightMarkdownBlocks();
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(run);
}

const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    // Ignore mutations caused purely by our own span insertion.
    const target = m.target as HTMLElement;
    if (target.nodeType === Node.ELEMENT_NODE && target.closest?.(`[${MARK}]`)) {
      continue;
    }
    schedule();
    return;
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });

// SPA navigation (GitHub soft-nav/Turbo, GitLab and Bitbucket history routing).
for (const ev of ["soft-nav:end", "turbo:load", "turbo:render", "popstate"]) {
  window.addEventListener(ev, () => {
    modelKey = null;
    schedule();
  });
}

schedule();
