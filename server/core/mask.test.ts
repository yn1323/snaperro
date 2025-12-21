import { describe, expect, it } from "vitest";
import { getMergedMaskHeaders, maskHeaders, maskValue } from "./mask.js";

describe("maskValue", () => {
  it("masks values longer than 4 characters", () => {
    expect(maskValue("Bearer12345678")).toBe("Bear**********");
  });

  it("shows first 4 characters with asterisks", () => {
    expect(maskValue("secret123")).toBe("secr*****");
  });

  it("masks short values with all asterisks", () => {
    expect(maskValue("abc")).toBe("***");
    expect(maskValue("a")).toBe("*");
  });

  it("masks exactly 4 characters with all asterisks", () => {
    expect(maskValue("abcd")).toBe("****");
  });

  it("limits asterisks to 10", () => {
    const longValue = "visibleXXXXXXXXXXXXXXXXXXXXX";
    const result = maskValue(longValue);
    expect(result).toBe("visi**********");
    expect(result.length).toBe(14); // 4 visible + 10 asterisks
  });

  it("handles empty string", () => {
    expect(maskValue("")).toBe("");
  });

  it("masks values with exactly 5 characters", () => {
    expect(maskValue("hello")).toBe("hell*");
  });

  it("masks values with exactly 14 characters", () => {
    expect(maskValue("12345678901234")).toBe("1234**********");
  });
});

describe("maskHeaders", () => {
  it("masks specified headers (case-insensitive)", () => {
    const headers = {
      Authorization: "Bearer12345678",
      "Content-Type": "application/json",
    };
    const result = maskHeaders(headers, ["authorization"]);

    expect(result.Authorization).toBe("Bear**********");
    expect(result["Content-Type"]).toBe("application/json");
  });

  it("preserves headers not in mask list", () => {
    const headers = {
      "X-Custom": "value",
      "Content-Type": "application/json",
    };
    const result = maskHeaders(headers, ["authorization"]);

    expect(result["X-Custom"]).toBe("value");
    expect(result["Content-Type"]).toBe("application/json");
  });

  it("handles empty headerNamesToMask", () => {
    const headers = {
      Authorization: "Bearer12345678",
    };
    const result = maskHeaders(headers, []);

    expect(result.Authorization).toBe("Bearer12345678");
  });

  it("handles undefined headerNamesToMask", () => {
    const headers = {
      Authorization: "Bearer12345678",
    };
    const result = maskHeaders(headers, undefined);

    expect(result.Authorization).toBe("Bearer12345678");
  });

  it("masks multiple headers", () => {
    const headers = {
      Authorization: "Bearer12345678",
      "X-Api-Key": "sk-123456789",
      "Content-Type": "application/json",
    };
    const result = maskHeaders(headers, ["authorization", "x-api-key"]);

    expect(result.Authorization).toBe("Bear**********");
    // "sk-123456789" is 12 chars, so 4 visible + min(8, 10) = 8 asterisks
    expect(result["X-Api-Key"]).toBe("sk-1********");
    expect(result["Content-Type"]).toBe("application/json");
  });

  it("handles case variations in header names", () => {
    const headers = {
      AUTHORIZATION: "Bearer12345678",
      "content-type": "application/json",
    };
    const result = maskHeaders(headers, ["Authorization"]);

    expect(result.AUTHORIZATION).toBe("Bear**********");
  });

  it("returns new object without modifying original", () => {
    const headers = {
      Authorization: "Bearer12345678",
    };
    const result = maskHeaders(headers, ["authorization"]);

    expect(headers.Authorization).toBe("Bearer12345678");
    expect(result.Authorization).toBe("Bear**********");
  });

  it("handles empty headers object", () => {
    const result = maskHeaders({}, ["authorization"]);
    expect(result).toEqual({});
  });
});

describe("getMergedMaskHeaders", () => {
  it("returns undefined when both are undefined", () => {
    expect(getMergedMaskHeaders(undefined, undefined)).toBeUndefined();
  });

  it("returns root mask when API mask is undefined", () => {
    expect(getMergedMaskHeaders(["authorization"], undefined)).toEqual(["authorization"]);
  });

  it("returns API mask when root mask is undefined", () => {
    expect(getMergedMaskHeaders(undefined, ["x-api-key"])).toEqual(["x-api-key"]);
  });

  it("merges both arrays", () => {
    const result = getMergedMaskHeaders(["authorization"], ["x-api-key"]);
    expect(result).toContain("authorization");
    expect(result).toContain("x-api-key");
    expect(result).toHaveLength(2);
  });

  it("deduplicates case-insensitively", () => {
    const result = getMergedMaskHeaders(["Authorization"], ["authorization"]);
    expect(result).toHaveLength(1);
    expect(result).toContain("authorization");
  });

  it("handles mixed case in both arrays", () => {
    const result = getMergedMaskHeaders(["Authorization", "Cookie"], ["AUTHORIZATION", "X-Api-Key"]);
    expect(result).toHaveLength(3);
    expect(result).toContain("authorization");
    expect(result).toContain("cookie");
    expect(result).toContain("x-api-key");
  });

  it("handles empty arrays", () => {
    expect(getMergedMaskHeaders([], [])).toEqual([]);
    expect(getMergedMaskHeaders(["auth"], [])).toEqual(["auth"]);
    expect(getMergedMaskHeaders([], ["auth"])).toEqual(["auth"]);
  });
});
