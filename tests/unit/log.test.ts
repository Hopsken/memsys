import { parseLog, parseText, replay, serializeLog } from "@core/log";
import type { Row } from "@core/log";
import { describe, expect, it } from "vitest";

import { FRAGMENT_MAX } from "@lib/fragment";

const day = (value: number) => Date.parse(`2026-09-${value}T08:00:00.000Z`);
const iso = (value: number) => new Date(day(value)).toISOString();

describe("Fragment log", () => {
  it("round-trips records through NDJSON", () => {
    const rows: Row[] = [
      {
        createdAt: day(22),
        fragment: 'Line one\nline two 😀 "quoted"',
        id: 1,
        op: "remember",
        ref: "abcdefg",
        source: "agent:Claude Code",
      },
      {
        createdAt: day(21),
        fragment: "é".repeat(FRAGMENT_MAX),
        id: 2,
        op: "remember",
        ref: "hjkmnpq",
        source: null,
      },
      {
        createdAt: day(21),
        fragment: null,
        id: 3,
        op: "forget",
        ref: "hjkmnpq",
        source: "user",
      },
    ];
    const text = serializeLog([], rows);
    expect(text).toMatch(/\n$/u);
    const lines = text.split("\n");
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0] ?? "")).toStrictEqual({
      createdAt: iso(22),
      fragment: 'Line one\nline two 😀 "quoted"',
      op: "remember",
      ref: "abcdefg",
      source: "agent:Claude Code",
      v: 1,
    });
    expect(JSON.parse(lines[2] ?? "")).toStrictEqual({
      createdAt: iso(21),
      fragment: null,
      op: "forget",
      ref: "hjkmnpq",
      source: "user",
      v: 1,
    });
    expect(parseLog(text)).toStrictEqual({
      personas: [],
      rows: rows.map(({ id: _, ...row }) => row),
    });
  });

  it("ignores unknown keys and a missing final line break", () => {
    expect(
      parseLog(
        `{"v":1,"ref":"abcdefg","fragment":"Hi","createdAt":"${iso(21)}","note":"x","id":9}`
      )
    ).toStrictEqual({
      personas: [],
      rows: [
        {
          createdAt: day(21),
          fragment: "Hi",
          op: "remember",
          ref: "abcdefg",
          source: null,
        },
      ],
    });
  });

  it("reads lines as the causal order, not timestamps", () => {
    const line = (
      createdAt: number,
      fragment: string | null,
      ref = "abcdefg"
    ) =>
      `${JSON.stringify({ createdAt: iso(createdAt), fragment, ref, v: 1 })}\n`;
    const parsed = parseLog(
      [
        line(24, "Back"),
        line(21, "First"),
        line(22, "Second"),
        line(23, null),
        line(22, "Other", "hjkmnpq"),
      ].join("")
    );
    expect(
      "rows" in parsed && parsed.rows.map(({ op, ref }) => `${ref} ${op}`)
    ).toStrictEqual([
      "abcdefg remember",
      "abcdefg revise",
      "abcdefg revise",
      "abcdefg forget",
      "hjkmnpq remember",
    ]);
    expect(
      "rows" in parsed && parsed.rows.map(({ createdAt }) => createdAt)
    ).toStrictEqual([day(24), day(21), day(22), day(23), day(22)]);
  });

  it("keeps two records of one ref written at the same time", () => {
    const line = (fragment: string) =>
      `${JSON.stringify({
        createdAt: iso(21),
        fragment,
        ref: "abcdefg",
        v: 1,
      })}\n`;
    const parsed = parseLog(`${line("First")}${line("Second")}`);
    expect(
      "rows" in parsed && parsed.rows.map(({ fragment, op }) => fragment && op)
    ).toStrictEqual(["remember", "revise"]);
    expect("rows" in parsed && parsed.rows).toHaveLength(2);
  });

  it.each([
    [`{"v":2,"ref":"abcdefg","fragment":"Hi","createdAt":"${iso(21)}"}`, "v"],
    [
      '{"v":1,"ref":"abcdefg","fragment":"Hi","createdAt":"2026-09-21T08:00:00Z"}',
      "createdAt",
    ],
    ['{"v":1,"ref":"abcdefg","fragment":"Hi"}', "createdAt"],
    [
      `{"v":1,"ref":"abcdefg","fragment":"Hi","createdAt":"${iso(21)}","op":"forget"}`,
      "op",
    ],
    [
      `{"v":1,"ref":"abcdefg","fragment":null,"createdAt":"${iso(21)}","op":"revise"}`,
      "op",
    ],
    [
      `{"v":1,"ref":"abcdefg","fragment":"Hi","createdAt":"${iso(21)}","source":"You"}`,
      "source",
    ],
    [`{"v":1,"ref":"0000000","fragment":"Hi","createdAt":"${iso(21)}"}`, "ref"],
    [
      `{"v":1,"ref":"abcdefg","fragment":" ","createdAt":"${iso(21)}"}`,
      "fragment",
    ],
  ])("rejects %s", (line, field) => {
    expect(parseLog(`${line}\n`)).toMatchObject({
      issues: [{ path: ["1", field] }],
    });
  });

  it("rejects torn lines and blank lines", () => {
    const line = `{"v":1,"ref":"abcdefg","fragment":"Hi","createdAt":"${iso(21)}"}`;
    expect(parseLog(`${line}\n{"v":1,"ref"`)).toMatchObject({
      issues: [{ path: ["2"] }],
    });
    expect(parseLog(`${line}\n\n${line}\n`)).toMatchObject({
      issues: [{ path: ["2"] }],
    });
  });

  it("projects creation from the first record and updates from the last", () => {
    const rows: Row[] = [
      {
        createdAt: day(21),
        fragment: "First",
        id: 1,
        op: "remember",
        ref: "abcdefg",
        source: "agent:a",
      },
      {
        createdAt: day(21),
        fragment: "Gone",
        id: 2,
        op: "remember",
        ref: "hjkmnpq",
        source: null,
      },
      {
        createdAt: day(22),
        fragment: "Second",
        id: 3,
        op: "revise",
        ref: "abcdefg",
        source: null,
      },
      {
        createdAt: day(22),
        fragment: null,
        id: 4,
        op: "forget",
        ref: "hjkmnpq",
        source: "user",
      },
      {
        createdAt: day(23),
        fragment: null,
        id: 5,
        op: "forget",
        ref: "abcdefg",
        source: "user",
      },
      {
        createdAt: day(24),
        fragment: "Back again",
        id: 6,
        op: "restore",
        ref: "abcdefg",
        source: "user",
      },
    ];
    const { corpus, refs } = replay(rows);
    expect([...corpus.values()]).toStrictEqual([
      {
        createdAt: iso(21),
        fragment: "Back again",
        ref: "abcdefg",
        source: "user",
        updatedAt: iso(24),
        versionId: 6,
      },
    ]);
    expect(refs.get("abcdefg")).toStrictEqual({
      active: true,
      createdAt: day(21),
      latestAt: day(24),
      latestId: 6,
      text: {
        fragment: "Back again",
        id: 6,
        source: "user",
        updatedAt: day(24),
      },
      versions: 4,
    });
    expect(refs.get("hjkmnpq")).toStrictEqual({
      active: false,
      createdAt: day(21),
      latestAt: day(22),
      latestId: 4,
      text: { fragment: "Gone", id: 2, source: null, updatedAt: day(21) },
      versions: 2,
    });
  });

  it("rejects out-of-order ids during replay", () => {
    expect(() =>
      replay([
        {
          createdAt: day(22),
          fragment: "Second",
          id: 2,
          op: "revise",
          ref: "abcdefg",
          source: "user",
        },
        {
          createdAt: day(21),
          fragment: "First",
          id: 1,
          op: "remember",
          ref: "abcdefg",
          source: "user",
        },
      ])
    ).toThrow(/ascending id order/u);
  });

  it("takes creation from the first record that has text", () => {
    const rows: Row[] = [
      {
        createdAt: day(20),
        fragment: null,
        id: 1,
        op: "forget",
        ref: "klmnpqr",
        source: "user",
      },
      {
        createdAt: day(25),
        fragment: "Late",
        id: 2,
        op: "restore",
        ref: "klmnpqr",
        source: "user",
      },
    ];
    expect([...replay(rows).corpus.values()]).toStrictEqual([
      {
        createdAt: iso(25),
        fragment: "Late",
        ref: "klmnpqr",
        source: "user",
        updatedAt: iso(25),
        versionId: 2,
      },
    ]);
  });

  it("reads plain text as one fragment per non-empty line", () => {
    expect(parseText("One\r\n\n  \nTwo #tag\n")).toStrictEqual({
      texts: ["One", "Two #tag"],
    });
    expect(parseText(`Fine\n${"x".repeat(FRAGMENT_MAX + 1)}`)).toMatchObject({
      issues: [{ path: ["2"] }],
    });
  });
});
