import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it.each(["", "[computed@0]", "[unknown@0]"])(
  "preserves the exact admitted module key %s",
  (key) => {
    const source = `globalThis.webpackChunkApp.push([[1], { ${JSON.stringify(key)}: function() {} }]);`;
    const result = analyzeJavaScriptStaticSource(source);
    expect(result.parse_status).toBe("complete");
    expect(result.bundler_registrations[0]?.modules[0]?.module_key).toBe(key);
  },
);

it("keeps genuinely dynamic keys partial", () => {
  const result = analyzeJavaScriptStaticSource(
    "globalThis.webpackChunkApp.push([[1], { [key]: function() {} }]);",
  );
  expect(result.parse_status).toBe("partial");
});
