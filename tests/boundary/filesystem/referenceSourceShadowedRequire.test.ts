import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { importReferenceSource } from "../../support/referenceSourceResourceScope.js";

it("does not infer CommonJS dependencies from locally bound or dynamic require lookups", async () => {
  const root = await createTestTempDirectory("rea-reference-shadowed-require-");
  const sources: Record<string, string> = {
    "parameter.cjs": [
      "function load(require) { return require('./throwing.cjs'); }",
      "console.log(load(() => 'local'));",
    ].join("\n"),
    "destructured.cjs": [
      "function load({ require }) { return require('./throwing.cjs'); }",
      "console.log(load({ require: () => 'local' }));",
    ].join("\n"),
    "hoisted.cjs": [
      "function load() {",
      "  console.log(require('./throwing.cjs'));",
      "  function require() { return 'local'; }",
      "}",
      "load();",
    ].join("\n"),
    "catch.cjs": [
      "try { throw () => 'local'; }",
      "catch (require) { console.log(require('./throwing.cjs')); }",
    ].join("\n"),
    "members.cjs": [
      "{",
      "  const require = { resolve: () => 'local', main: () => 'local' };",
      "  console.log(require.resolve('./throwing.cjs'));",
      "  console.log(require['main']('./throwing.cjs'));",
      "}",
    ].join("\n"),
    "dynamic.cjs": [
      "with ({ require: () => 'local' }) {",
      "  console.log(require('./throwing.cjs'));",
      "}",
    ].join("\n"),
    "control.cjs": [
      "{ const require = () => 'local'; require('./throwing.cjs'); }",
      "console.log(require('./loaded.cjs'));",
      "console.log(require.resolve('./loaded.cjs'));",
    ].join("\n"),
    "imports.mjs": [
      "import value from './loaded.cjs';",
      "const require = () => 'local';",
      "require('./throwing.cjs');",
      "console.log(value);",
      "console.log((await import('./loaded.cjs')).default);",
    ].join("\n"),
    "loaded.cjs": "module.exports = 'real';\n",
    "throwing.cjs": "throw new Error('A local require must not load me');\n",
  };
  await Promise.all(
    Object.entries(sources).map(([path, source]) =>
      writeFile(join(root, path), source),
    ),
  );
  const runNode = promisify(execFile);
  for (const [path, stdout] of [
    ["parameter.cjs", "local\n"],
    ["destructured.cjs", "local\n"],
    ["hoisted.cjs", "local\n"],
    ["catch.cjs", "local\n"],
    ["members.cjs", "local\nlocal\n"],
    ["dynamic.cjs", "local\n"],
    ["control.cjs", `real\n${join(root, "loaded.cjs")}\n`],
    ["imports.mjs", "real\nreal\n"],
  ] as const) {
    const executed = await runNode(process.execPath, [join(root, path)], {
      cwd: root,
      timeout: 5_000,
    });
    expect(executed.stdout).toBe(stdout);
    expect(executed.stderr).toBe("");
  }

  const result = await importReferenceSource({
    root,
    caller: "reference-shadowed-require-test",
    policy: { secretPatterns: [] },
  });
  if (!result.ok) throw result.error;
  expect(result.value.parse_failures).toEqual([]);
  expect(result.value.relationships).toEqual([
    {
      from_path: "control.cjs",
      to: "loaded.cjs",
      kind: "requires",
      resolution: "internal",
      parse_state: "parsed",
    },
    {
      from_path: "imports.mjs",
      to: "loaded.cjs",
      kind: "imports",
      resolution: "internal",
      parse_state: "parsed",
    },
  ]);
  expect(result.value.entries).toHaveLength(Object.keys(sources).length);
});
