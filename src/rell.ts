// Hand-written Rell scanner derived from rell3/rell-base/frontend/src/main/antlr/Rell.g4.
// Emits per-line tokens with columns relative to the line start, so a virtualized
// code view can highlight any line independently once the whole file is scanned.

export type TokenKind =
  | "keyword"
  | "literal" // true / false / null
  | "number"
  | "string" // string and bytes literals
  | "comment"
  | "annotation" // @log etc.
  | "defname" // identifier being defined (entity Foo, function bar, ...)
  | "plain";

export interface Token {
  start: number;
  end: number; // exclusive, column within the line
  kind: TokenKind;
}

// Keywords from the parser rules of Rell.g4.
const KEYWORDS = new Set([
  "abstract", "and", "break", "class", "continue", "create", "delete", "else",
  "entity", "enum", "for", "function", "guard", "if", "import", "in", "include",
  "index", "key", "limit", "module", "mutable", "namespace", "not", "object",
  "offset", "operation", "or", "override", "query", "record", "return",
  "struct", "update", "val", "var", "virtual", "when", "while",
]);

const LITERALS = new Set(["true", "false", "null"]);

// Keywords whose following identifier is a definition name.
const DEF_KEYWORDS = new Set([
  "entity", "class", "object", "struct", "record", "enum", "function",
  "namespace", "operation", "query",
]);

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;
const HEX = /[0-9A-Fa-f]/;
const DIGIT = /[0-9]/;

interface State {
  inBlockComment: boolean;
  afterDefKeyword: boolean;
}

function scanLine(line: string, state: State, out: Token[]): void {
  let i = 0;
  const n = line.length;

  const push = (start: number, end: number, kind: TokenKind) => {
    if (end > start) out.push({ start, end, kind });
  };

  while (i < n) {
    if (state.inBlockComment) {
      const close = line.indexOf("*/", i);
      if (close === -1) {
        push(i, n, "comment");
        return;
      }
      push(i, close + 2, "comment");
      i = close + 2;
      state.inBlockComment = false;
      continue;
    }

    const c = line[i]!;

    if (c === " " || c === "\t") {
      i++;
      continue;
    }

    if (c === "/" && line[i + 1] === "/") {
      push(i, n, "comment");
      return;
    }

    if (c === "/" && line[i + 1] === "*") {
      const close = line.indexOf("*/", i + 2);
      if (close === -1) {
        push(i, n, "comment");
        state.inBlockComment = true;
        return;
      }
      push(i, close + 2, "comment");
      i = close + 2;
      continue;
    }

    // Bytes literal: x'ABCD' or x"ABCD" (must check before identifiers).
    if (c === "x" && (line[i + 1] === "'" || line[i + 1] === '"') && !IDENT_CHAR.test(line[i - 1] ?? " ")) {
      const quote = line[i + 1]!;
      let j = i + 2;
      while (j < n && HEX.test(line[j]!)) j++;
      if (line[j] === quote) {
        push(i, j + 1, "string");
        i = j + 1;
        state.afterDefKeyword = false;
        continue;
      }
    }

    // String literal (single-line per grammar; unterminated runs to EOL).
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (line[j] === "\\") {
          j += 2;
        } else if (line[j] === c) {
          j++;
          break;
        } else {
          j++;
        }
      }
      push(i, Math.min(j, n), "string");
      i = Math.min(j, n);
      state.afterDefKeyword = false;
      continue;
    }

    // Numbers: hex, integer, big integer (L suffix), decimal with fraction/exponent.
    if (DIGIT.test(c) || (c === "." && DIGIT.test(line[i + 1] ?? ""))) {
      let j = i;
      if (c === "0" && line[i + 1] === "x") {
        j = i + 2;
        while (j < n && HEX.test(line[j]!)) j++;
      } else {
        while (j < n && DIGIT.test(line[j]!)) j++;
        if (line[j] === "." && DIGIT.test(line[j + 1] ?? "")) {
          j++;
          while (j < n && DIGIT.test(line[j]!)) j++;
        }
        if (line[j] === "e" || line[j] === "E") {
          let k = j + 1;
          if (line[k] === "+" || line[k] === "-") k++;
          if (DIGIT.test(line[k] ?? "")) {
            k++;
            while (k < n && DIGIT.test(line[k]!)) k++;
            j = k;
          }
        }
      }
      if (line[j] === "L") j++;
      push(i, j, "number");
      i = j;
      state.afterDefKeyword = false;
      continue;
    }

    // Annotation: '@' immediately followed by an identifier. A bare '@' is the
    // at-expression operator and stays plain.
    if (c === "@" && IDENT_START.test(line[i + 1] ?? "")) {
      let j = i + 1;
      while (j < n && IDENT_CHAR.test(line[j]!)) j++;
      push(i, j, "annotation");
      i = j;
      continue;
    }

    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT_CHAR.test(line[j]!)) j++;
      const word = line.slice(i, j);
      if (KEYWORDS.has(word)) {
        push(i, j, "keyword");
        state.afterDefKeyword = DEF_KEYWORDS.has(word);
      } else if (LITERALS.has(word)) {
        push(i, j, "literal");
        state.afterDefKeyword = false;
      } else if (state.afterDefKeyword) {
        push(i, j, "defname");
        // Keep the flag across '.' so `namespace a.b` highlights each part.
        state.afterDefKeyword = line[j] === ".";
      } else {
        state.afterDefKeyword = false;
      }
      i = j;
      continue;
    }

    if (c !== ".") state.afterDefKeyword = state.afterDefKeyword && c === ".";
    i++;
  }
}

/** Tokenize a whole source text; returns one token array per line. */
export function tokenize(source: string): Token[][] {
  const lines = source.split("\n");
  const state: State = { inBlockComment: false, afterDefKeyword: false };
  return lines.map((line) => {
    state.afterDefKeyword = state.afterDefKeyword && state.inBlockComment;
    const out: Token[] = [];
    scanLine(line.replace(/\r$/, ""), state, out);
    return out;
  });
}
