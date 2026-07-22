import { describe, expect, test } from "bun:test";
import { tokenize, type Token, type TokenKind } from "./rell";

function kinds(line: string): Array<[string, TokenKind]> {
  const tokens = tokenize(line)[0] ?? [];
  return tokens.map((t: Token) => [line.slice(t.start, t.end), t.kind]);
}

describe("keywords and literals", () => {
  test("definition keywords and names", () => {
    expect(kinds("entity user { name; }")).toEqual([
      ["entity", "keyword"],
      ["user", "defname"],
    ]);
    expect(kinds("function calc(x: integer): integer = x + 1;")).toEqual([
      ["function", "keyword"],
      ["calc", "defname"],
      ["1", "number"],
    ]);
    expect(kinds("namespace a.b { }")).toEqual([
      ["namespace", "keyword"],
      ["a", "defname"],
      ["b", "defname"],
    ]);
  });

  test("boolean/null literals", () => {
    expect(kinds("val x = true; var y = null;")).toEqual([
      ["val", "keyword"],
      ["true", "literal"],
      ["var", "keyword"],
      ["null", "literal"],
    ]);
  });

  test("keyword-like identifiers are not keywords", () => {
    expect(kinds("values.entity_id")).toEqual([]);
  });
});

describe("numbers", () => {
  test("int, hex, big integer, decimal", () => {
    expect(kinds("1 + 0xFF + 42L + 1.5e-3 + .5")).toEqual([
      ["1", "number"],
      ["0xFF", "number"],
      ["42L", "number"],
      ["1.5e-3", "number"],
      [".5", "number"],
    ]);
  });
});

describe("strings and bytes", () => {
  test("double and single quoted, with escapes", () => {
    expect(kinds(`val s = "a\\"b" + 'c';`)).toEqual([
      ["val", "keyword"],
      [`"a\\"b"`, "string"],
      ["'c'", "string"],
    ]);
  });

  test("bytes literal", () => {
    expect(kinds(`val b = x"1234" + x'AB';`)).toEqual([
      ["val", "keyword"],
      [`x"1234"`, "string"],
      ["x'AB'", "string"],
    ]);
  });

  test("identifier ending in x is not a bytes literal", () => {
    expect(kinds(`max"12"`)).toEqual([[`"12"`, "string"]]);
  });
});

describe("comments", () => {
  test("line comment", () => {
    expect(kinds("val x = 1; // trailing")).toEqual([
      ["val", "keyword"],
      ["1", "number"],
      ["// trailing", "comment"],
    ]);
  });

  test("block comment spanning lines", () => {
    const lines = tokenize("val a = 1; /* start\nmiddle\nend */ val b = 2;");
    expect(lines[0]!.map((t) => t.kind)).toEqual(["keyword", "number", "comment"]);
    expect(lines[1]!.map((t) => t.kind)).toEqual(["comment"]);
    expect(lines[2]!.map((t) => t.kind)).toEqual([
      "comment",
      "keyword",
      "number",
    ]);
  });

  test("keywords inside comments stay comments", () => {
    expect(kinds("// entity function val")).toEqual([
      ["// entity function val", "comment"],
    ]);
  });
});

describe("annotations and at-expressions", () => {
  test("@log annotation", () => {
    expect(kinds("@log entity foo {}")).toEqual([
      ["@log", "annotation"],
      ["entity", "keyword"],
      ["foo", "defname"],
    ]);
  });

  test("bare @ operator is plain", () => {
    expect(kinds("user @ { .name == 'bob' }")).toEqual([["'bob'", "string"]]);
  });
});
