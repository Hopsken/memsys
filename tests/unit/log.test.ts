import { parseLog, parseText, replay, serializeLog } from "@core/log";
import type { Row } from "@core/log";
import { describe, expect, it } from "vitest";

import { FRAGMENT_MAX } from "@lib/fragment";

const at = (day: number) => Date.parse(`2026-09-${day}T08:00:00.000Z`);

describe("Fragment log", () => {
  it("round-trips records through NDJSON", () => {
    const rows: Row[] = [
      {
        at: at(22),
        fragment: 'Line one\nline two 😀 "quoted"',
        from: "agent:Claude Code",
        op: "remember",
        ref: "abcdefg",
      },
      {
        at: at(21),
        fragment: "é".repeat(FRAGMENT_MAX),
        from: null,
        op: "remember",
        ref: "hjkmnpq",
      },
      {
        at: at(23),
        fragment: null,
        from: "user",
        op: "forget",
        ref: "hjkmnpq",
      },
    ];
    const text = serializeLog([], rows);
    expect(text).toMatch(/\n$/u);
    expect(text.split("\n")).toHaveLength(4);
    expect(text.split("\n")[0]).toBe(
      `{"v":2,"ref":"hjkmnpq","fragment":"${"é".repeat(FRAGMENT_MAX)}","at":"2026-09-21T08:00:00.000Z","op":"remember"}`
    );
    expect(text.split("\n")[2]).toBe(
      '{"v":2,"ref":"hjkmnpq","fragment":null,"at":"2026-09-23T08:00:00.000Z","op":"forget","from":"user"}'
    );
    expect(parseLog(text)).toStrictEqual({
      personas: [],
      rows: rows.toSorted((a, b) => a.at - b.at),
    });
  });

  it("ignores unknown keys and a missing final line break", () => {
    expect(
      parseLog(
        '{"v":2,"ref":"abcdefg","fragment":"Hi","at":"2026-09-21T08:00:00.000Z","note":"x"}'
      )
    ).toStrictEqual({
      personas: [],
      rows: [
        {
          at: at(21),
          fragment: "Hi",
          from: null,
          op: "remember",
          ref: "abcdefg",
        },
      ],
    });
  });

  it("gives records without an op the one their place in the log implies", () => {
    const line = (day: number, fragment: string | null, ref = "abcdefg") =>
      `${JSON.stringify({ at: new Date(at(day)).toISOString(), fragment, ref, v: 2 })}\n`;
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
      "hjkmnpq remember",
      "abcdefg forget",
      "abcdefg restore",
    ]);
  });

  it.each([
    [
      '{"v":1,"ref":"abcdefg","fragment":"Hi","at":"2026-09-21T08:00:00.000Z"}',
      "v",
    ],
    [
      '{"v":2,"ref":"abcdefg","fragment":"Hi","at":"2026-09-21T08:00:00Z"}',
      "at",
    ],
    ['{"v":2,"ref":"abcdefg","fragment":"Hi"}', "at"],
    [
      '{"v":2,"ref":"abcdefg","fragment":"Hi","at":"2026-09-21T08:00:00.000Z","op":"forget"}',
      "op",
    ],
    [
      '{"v":2,"ref":"abcdefg","fragment":null,"at":"2026-09-21T08:00:00.000Z","op":"revise"}',
      "op",
    ],
    [
      '{"v":2,"ref":"abcdefg","fragment":"Hi","at":"2026-09-21T08:00:00.000Z","from":"You"}',
      "from",
    ],
    [
      '{"v":2,"ref":"abcdefg","fragment":"Hi","at":"2026-09-21T08:00:00.000Z","by":"user"}',
      "by",
    ],
    [
      '{"v":2,"ref":"0000000","fragment":"Hi","at":"2026-09-21T08:00:00.000Z"}',
      "ref",
    ],
    [
      '{"v":2,"ref":"abcdefg","fragment":" ","at":"2026-09-21T08:00:00.000Z"}',
      "fragment",
    ],
  ])("rejects %s", (line, field) => {
    expect(parseLog(`${line}\n`)).toMatchObject({
      issues: [{ path: ["1", field] }],
    });
  });

  it("tells the owner of an older file how to bring it forward", () => {
    const v1 = parseLog(
      '{"v":1,"ref":"abcdefg","fragment":"Hi","at":"2026-09-21T08:00:00.000Z"}\n'
    );
    expect(v1).toMatchObject({
      issues: [
        { message: expect.stringMatching(/version 2/u), path: ["1", "v"] },
      ],
    });
    const withBy = parseLog(
      '{"v":2,"ref":"abcdefg","fragment":"Hi","at":"2026-09-21T08:00:00.000Z","by":"user"}\n'
    );
    expect(withBy).toMatchObject({
      issues: [
        {
          message: expect.stringMatching(/`by` is now `from`/u),
          path: ["1", "by"],
        },
      ],
    });
  });

  it("rejects torn lines, blank lines, and two records of a ref at one time", () => {
    const line =
      '{"v":2,"ref":"abcdefg","fragment":"Hi","at":"2026-09-21T08:00:00.000Z"}';
    expect(parseLog(`${line}\n{"v":2,"ref"`)).toMatchObject({
      issues: [{ path: ["2"] }],
    });
    expect(parseLog(`${line}\n\n${line}\n`)).toMatchObject({
      issues: [{ path: ["2"] }, { path: ["3", "at"] }],
    });
  });

  it("replays the latest record of each ref in any order", () => {
    const rows = [
      {
        at: at(24),
        fragment: "Back again",
        from: "user" as const,
        ref: "abcdefg",
      },
      {
        at: at(21),
        fragment: "First",
        from: "agent:a" as const,
        ref: "abcdefg",
      },
      { at: at(23), fragment: null, ref: "abcdefg" },
      { at: at(22), fragment: "Second", ref: "abcdefg" },
      { at: at(21), fragment: "Gone", ref: "hjkmnpq" },
      { at: at(22), fragment: null, ref: "hjkmnpq" },
    ];
    const { corpus, latestAtByRef } = replay(rows);
    expect([...corpus.values()]).toStrictEqual([
      {
        at: "2026-09-24T08:00:00.000Z",
        fragment: "Back again",
        from: "user",
        ref: "abcdefg",
      },
    ]);
    expect(latestAtByRef).toStrictEqual(
      new Map([
        ["abcdefg", at(24)],
        ["hjkmnpq", at(22)],
      ])
    );
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
