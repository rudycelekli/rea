import { describe, expect, it } from "vitest";
import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

const returns = (source: string, name = "read") =>
  analyzeJavaScriptSemantics(source)
    .callables.find((callable) => callable.name === name)
    ?.returnSites.map(({ value }) => value);

const returnedField = (source: string, field: string) => {
  const [value] = returns(source) ?? [];
  return value?.status === "object"
    ? value.properties.find(({ name }) => name === field)?.value
    : undefined;
};

describe("JavaScript semantic analysis: incoming parameter values", () => {
  it("keeps a parameter captured before its later assignment unknown (issue #3881)", () => {
    const captured = returnedField(
      `export function read(x) {
         const saved = x;
         x = 2;
         return {type: "ok", value: saved};
       }`,
      "value",
    );

    expect(captured?.status).toBe("unknown");
  });

  it("keeps a read before the assignment unknown on every return", () => {
    expect(
      returns(`export function read(x) {
        if (x) return x;
        x = 2;
        return x;
      }`),
    ).toEqual([
      expect.objectContaining({ status: "unknown" }),
      { status: "literal", value: 2 },
    ]);
  });

  it("keeps a catch binding read before its assignment unknown", () => {
    expect(
      returns(`export function read() {
        try { throw 1; } catch (e) {
          const seen = e;
          e = 2;
          return seen;
        }
      }`),
    ).toEqual([expect.objectContaining({ status: "unknown" })]);
  });

  it("keeps a parameter assigned before the read exact", () => {
    expect(
      returns(`export function read(x) {
        x = 2;
        return x;
      }`),
    ).toEqual([{ status: "literal", value: 2 }]);
    expect(
      returnedField(
        `export function read(x) {
           x = 2;
           const saved = x;
           return {type: "ok", value: saved};
         }`,
        "value",
      ),
    ).toEqual({ status: "literal", value: 2 });
  });
});
