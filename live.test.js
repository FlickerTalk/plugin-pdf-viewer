// The messages the viewer sends to its twin while a PDF is presented in a call.
import { describe, expect, it } from "vitest";
import { HELLO, PAGE, decode, encode } from "./src/live.js";

describe("the live channel of a presentation", () => {
  it("carries a hello and a page as base64 JSON, and nothing else", () => {
    expect(decode(encode({ k: HELLO }))).toEqual({ k: HELLO });
    expect(decode(encode({ k: PAGE, n: 3 }))).toEqual({ k: PAGE, n: 3 });
    expect(decode(encode({ k: PAGE, n: 3, extra: "x" }))).toEqual({ k: PAGE, n: 3 });
  });

  it("ignores garbage, other kinds and pages that are not a page number", () => {
    expect(decode("%%%")).toBeNull();
    expect(decode(btoa("not json"))).toBeNull();
    expect(decode(encode({ k: "sync" }))).toBeNull();
    for (const n of [0, -1, 1.5, "2", null]) expect(decode(encode({ k: PAGE, n })), String(n)).toBeNull();
  });
});
