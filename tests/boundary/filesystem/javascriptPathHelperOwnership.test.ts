import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";

it.each([
  [
    "local URL",
    "main.mjs",
    'import { BrowserWindow } from "electron"; import { URL as NativeURL, fileURLToPath } from "node:url"; class URL { constructor() { return new NativeURL("file:///real.cjs"); } }',
    "fileURLToPath(new URL('./decoy.cjs', import.meta.url))",
  ],
  [
    "local fileURLToPath",
    "main.mjs",
    'import { BrowserWindow } from "electron"; function fileURLToPath() { return "/real.cjs"; }',
    "fileURLToPath(new URL('./decoy.cjs', import.meta.url))",
  ],
  [
    "custom join",
    "main.cjs",
    'const { BrowserWindow } = require("electron"); const path = { join() { return "/real.cjs"; } };',
    "path.join(__dirname, 'decoy.cjs')",
  ],
  [
    "custom resolve",
    "main.cjs",
    'const { BrowserWindow } = require("electron"); const path = { resolve() { return "/real.cjs"; } };',
    "path.resolve(__dirname, 'decoy.cjs')",
  ],
  [
    "local dirname",
    "main.mjs",
    'import { BrowserWindow } from "electron"; import * as path from "node:path"; import { fileURLToPath } from "node:url"; function dirname() { return "/real"; }',
    'path.join(dirname(fileURLToPath(import.meta.url)), "decoy.cjs")',
  ],
  [
    "local directory anchor",
    "main.mjs",
    'import { BrowserWindow } from "electron"; import * as path from "node:path"; const __dirname = "/real";',
    'path.join(__dirname, "decoy.cjs")',
  ],
  [
    "reassigned native binding",
    "main.cjs",
    'const { BrowserWindow } = require("electron"); let path = require("node:path"); path = { join() { return "/real.cjs"; } };',
    'path.join(__dirname, "decoy.cjs")',
  ],
  [
    "reassigned native member",
    "main.cjs",
    'const { BrowserWindow } = require("electron"); const path = require("node:path"); path.join = () => "/real.cjs";',
    'path.join(__dirname, "decoy.cjs")',
  ],
  [
    "custom imported module",
    "main.mjs",
    'import { BrowserWindow } from "electron"; import * as path from "./custom.mjs";',
    'path.join("./decoy.cjs")',
  ],
  [
    "nested shadow",
    "main.cjs",
    'const { BrowserWindow } = require("electron"); const path = require("node:path"); { const path = { join() { return "/real.cjs"; } };',
    'path.join(__dirname, "decoy.cjs")',
  ],
  [
    "with scope",
    "main.cjs",
    'const { BrowserWindow } = require("electron"); const path = require("node:path"); with ({ path: { join() { return "/real.cjs"; } } }) {',
    'path.join(__dirname, "decoy.cjs")',
  ],
  [
    "native object alias mutation",
    "main.cjs",
    'const { BrowserWindow } = require("electron"); const path = require("node:path"); const alias = path; path.join = () => "/real.cjs";',
    'alias.join(__dirname, "decoy.cjs")',
  ],
  [
    "mutation through native alias",
    "main.cjs",
    'const { BrowserWindow } = require("electron"); const path = require("node:path"); const alias = path; alias.join = () => "/real.cjs";',
    'path.join(__dirname, "decoy.cjs")',
  ],
  [
    "canonical module alias mutation",
    "main.cjs",
    'const { BrowserWindow } = require("electron"); const path = require("node:path"); const alias = require("path"); path.join = () => "/real.cjs";',
    'alias.join(__dirname, "decoy.cjs")',
  ],
  [
    "direct require member mutation",
    "main.cjs",
    'const { BrowserWindow } = require("electron"); const path = require("node:path"); require("path").join = () => "/real.cjs";',
    'path.join(__dirname, "decoy.cjs")',
  ],
])(
  "does not resolve a preload through %s",
  async (_name, filename, declaration, expression) => {
    const root = await createTestTempDirectory("rea-path-helper-owner-");
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "custom.mjs"),
      'export function join() { return "/real.cjs"; }\n',
    );
    await writeFile(join(root, "real.cjs"), 'module.exports = "real";\n');
    await writeFile(join(root, "decoy.cjs"), 'module.exports = "decoy";\n');
    await writeFile(
      join(root, filename),
      `${declaration}\nnew BrowserWindow({ webPreferences: { preload: ${expression} } });${_name === "nested shadow" || _name === "with scope" ? "}" : ""}\n`,
    );
    const result = await analyzeJavaScriptApplication({
      input_path: root,
      format: "directory",
    });
    if (!result.ok) throw result.error;
    const { graph } = javascriptApplicationAnalysisResultSchema.parse(
      result.value.normalized_result,
    );
    expect(
      graph.nodes
        .filter(({ kind }) => kind === "electron-preload")
        .flatMap(({ observations }) => observations)
        .some(({ properties }) => properties.resolution_status === "resolved"),
    ).toBe(false);
  },
);

it.each([
  [
    'import { fileURLToPath } from "node:url";',
    'fileURLToPath(new URL("./decoy.cjs", import.meta.url))',
  ],
  [
    'import * as path from "node:path"; import { fileURLToPath } from "node:url";',
    'path.join(path.dirname(fileURLToPath(import.meta.url)), "decoy.cjs")',
  ],
  [
    'import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";',
    'join(dirname(fileURLToPath(import.meta.url)), "decoy.cjs")',
  ],
  [
    'import * as nativePath from "node:path"; import { fileURLToPath } from "node:url";',
    'nativePath.join(nativePath.dirname(fileURLToPath(import.meta.url)), "decoy.cjs")',
  ],
  [
    'import path from "node:path"; import { fileURLToPath } from "node:url"; path.unrelated = () => "/real.cjs";',
    'path.join(path.dirname(fileURLToPath(import.meta.url)), "decoy.cjs")',
  ],
  [
    'import path from "node:path"; import { fileURLToPath } from "node:url"; const alias = path;',
    'alias.join(alias.dirname(fileURLToPath(import.meta.url)), "decoy.cjs")',
  ],
  ["", '"./decoy.cjs"'],
])(
  "preserves native and literal preload expressions %s %s",
  async (declaration, expression) => {
    const root = await createTestTempDirectory("rea-native-path-owner-");
    await writeFile(
      join(root, "decoy.cjs"),
      'module.exports = "native preload";\n',
    );
    await writeFile(
      join(root, "main.mjs"),
      `import { BrowserWindow } from "electron";\n${declaration}\nnew BrowserWindow({ webPreferences: { preload: ${expression} } });\n`,
    );
    const result = await analyzeJavaScriptApplication({
      input_path: root,
      format: "directory",
    });
    if (!result.ok) throw result.error;
    const { graph } = javascriptApplicationAnalysisResultSchema.parse(
      result.value.normalized_result,
    );
    const preloads = graph.nodes
      .filter(({ kind }) => kind === "electron-preload")
      .flatMap(({ observations }) => observations);
    expect(preloads).not.toHaveLength(0);
    expect(
      preloads.every(
        ({ properties }) =>
          properties.resolution_status === "resolved" &&
          properties.resolved_path === "decoy.cjs",
      ),
    ).toBe(true);
  },
);
