import { describe, expect, it } from "vitest";
import { findTextMatch } from "./text-search";

describe("findTextMatch", () => {
  const text = "Needle middle needle tail NEEDLE";

  it("moves forward case-insensitively and wraps", () => {
    expect(findTextMatch(text, "needle", 0, "next")).toEqual({ start: 0, end: 6 });
    expect(findTextMatch(text, "needle", 6, "next")).toEqual({ start: 14, end: 20 });
    expect(findTextMatch(text, "needle", text.length, "next")).toEqual({ start: 0, end: 6 });
  });

  it("moves backward and wraps", () => {
    expect(findTextMatch(text, "needle", text.length, "previous")).toEqual({ start: 26, end: 32 });
    expect(findTextMatch(text, "needle", 14, "previous")).toEqual({ start: 0, end: 6 });
    expect(findTextMatch(text, "needle", 0, "previous")).toEqual({ start: 26, end: 32 });
  });

  it("treats regex punctuation literally", () => {
    expect(findTextMatch("before a[b] after", "a[b]", 0, "next")).toEqual({ start: 7, end: 11 });
  });
});
