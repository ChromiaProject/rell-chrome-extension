// MAIN-world script for bitbucket.org: Bitbucket Cloud renders file views with
// the Monaco editor, so instead of patching its virtualized DOM we register
// Rell as a real Monaco language (Monarch tokenizer) and switch .rell models
// to it. Monaco's own theme then colors the tokens.

interface MonacoLike {
  languages: {
    register(lang: { id: string; extensions: string[] }): void;
    setMonarchTokensProvider(id: string, provider: object): void;
  };
  editor: {
    getModels(): MonacoModelLike[];
    setModelLanguage(model: MonacoModelLike, id: string): void;
    onDidCreateModel(cb: (model: MonacoModelLike) => void): void;
  };
}

interface MonacoModelLike {
  uri?: { path?: string };
  getLanguageId?(): string;
}

const MONARCH = {
  defaultToken: "",
  keywords: [
    "abstract", "and", "break", "class", "continue", "create", "delete",
    "else", "entity", "enum", "for", "function", "guard", "if", "import",
    "in", "include", "index", "key", "limit", "module", "mutable",
    "namespace", "not", "object", "offset", "operation", "or", "override",
    "query", "record", "return", "struct", "update", "val", "var",
    "virtual", "when", "while",
  ],
  literals: ["true", "false", "null"],
  tokenizer: {
    root: [
      [/\/\/.*$/, "comment"],
      [/\/\*/, "comment", "@comment"],
      [/x"[0-9A-Fa-f]*"/, "string"],
      [/x'[0-9A-Fa-f]*'/, "string"],
      [/"(?:[^"\\]|\\.)*"/, "string"],
      [/'(?:[^'\\]|\\.)*'/, "string"],
      [/0x[0-9A-Fa-f]+L?/, "number"],
      [/\d+(\.\d+)?([eE][+-]?\d+)?L?|\.\d+([eE][+-]?\d+)?/, "number"],
      [/@[A-Za-z_]\w*/, "tag"],
      [
        /[A-Za-z_]\w*/,
        {
          cases: {
            "@keywords": "keyword",
            "@literals": "constant",
            "@default": "identifier",
          },
        },
      ],
    ],
    comment: [
      [/[^*]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/./, "comment"],
    ],
  },
};

function install(monaco: MonacoLike): void {
  monaco.languages.register({ id: "rell", extensions: [".rell"] });
  monaco.languages.setMonarchTokensProvider("rell", MONARCH);

  const apply = (m: MonacoModelLike) => {
    if (/\.rell$/i.test(m.uri?.path ?? "") && m.getLanguageId?.() !== "rell") {
      monaco.editor.setModelLanguage(m, "rell");
    }
  };
  monaco.editor.getModels().forEach(apply);
  monaco.editor.onDidCreateModel(apply);
}

// Monaco loads lazily; poll until the global appears, then install once.
let attempts = 0;
const timer = setInterval(() => {
  const monaco = (window as { monaco?: MonacoLike }).monaco;
  if (monaco?.editor && monaco.languages) {
    clearInterval(timer);
    try {
      install(monaco);
    } catch {
      // Bitbucket may ship a Monaco build without these APIs; give up quietly.
    }
  } else if (++attempts > 120) {
    clearInterval(timer);
  }
}, 500);

export {};
