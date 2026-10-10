import { expect, it } from "vitest";
import { digestSchema, isDigest, prefixedDigestSchema } from "./digests.js";

it("rejects line terminators outside exact SHA-256 digest identities", () => {
  const digest = "a".repeat(64);
  for (const suffix of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
    expect(digestSchema.safeParse(digest + suffix).success).toBe(false);
    expect(isDigest(digest + suffix)).toBe(false);
    expect(
      prefixedDigestSchema("ev").safeParse(`ev_${digest}${suffix}`).success,
    ).toBe(false);
  }
  expect(digestSchema.parse(digest)).toBe(digest);
  expect(isDigest(digest)).toBe(true);
  expect(prefixedDigestSchema("ev").parse(`ev_${digest}`)).toBe(`ev_${digest}`);
});
