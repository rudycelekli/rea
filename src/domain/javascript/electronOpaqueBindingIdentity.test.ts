import { expect, it } from "vitest";

import { analyzeParsedJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";

const window = "new s.BrowserWindow({webPreferences:{nodeIntegration:true}})";
const replace = 'eval("s={BrowserWindow:class{}}");';
const bootstrap = (consumer: string, strict = true) =>
  `(()=>{var m={45840:e=>{e.exports=require("electron")},100:(e,t,n)=>{${strict ? '"use strict";' : ""}${consumer}}},c={};` +
  "function n(t){var r=c[t];if(void 0!==r)return r.exports;var o=c[t]={exports:{}};" +
  "return m[t](o,o.exports,n),o.exports}n(100)})();";

const windowsIn = (source: string) => {
  const parsed = parseJavaScriptSource(source, "main.cjs");
  expect(parsed).not.toBeNull();
  if (parsed === null) throw new Error("Expected valid CommonJS fixture");
  expect(parsed.errors).toEqual([]);
  const result = analyzeParsedJavaScriptStaticSource(source, parsed);
  expect(result.parse_status).not.toBe("failed");
  return result.electron.browser_windows;
};

it.each([
  ["Webpack external", (body: string) => bootstrap(`let s=n(45840);${body}`)],
  [
    "literal require",
    (body: string) => `(()=>{let s=require("electron");${body}})();`,
  ],
] as const)(
  "checks each %s read without caching validity across direct eval",
  (_name, wrap) => {
    const source = wrap(`${window};${replace}${window};`);
    const windows = windowsIn(source);
    expect(windows).toHaveLength(1);
    expect(windows[0]?.location.start.column).toBe(source.indexOf(window));
  },
);

it("does not treat a sloppy-eval shadow as the outer Electron binding", () => {
  const source = bootstrap(
    `const s=n(45840);function consume(){${window};eval("var s={BrowserWindow:class{}}");${window};}consume();`,
    false,
  );
  const windows = windowsIn(source);
  expect(windows).toHaveLength(1);
  expect(windows[0]?.location.start.column).toBe(source.indexOf(window));
});

it.each([
  ["indirect eval", '(0,eval)("s={BrowserWindow:class{}}");'],
  ["optional eval", 'eval?.("s={BrowserWindow:class{}}");'],
  [
    "a different lexical binding",
    'function other(){let s;eval("s={BrowserWindow:class{}}");}other();',
  ],
  ["a block-shadowed binding", '{let s;eval("s={BrowserWindow:class{}}");}'],
] as const)(
  "preserves the local Electron binding across %s",
  (_name, effect) => {
    expect(
      windowsIn(bootstrap(`let s=n(45840);${effect}${window};`)),
    ).toHaveLength(1);
  },
);

it("preserves a shadowed non-strict eval call", () => {
  expect(
    windowsIn(
      bootstrap(
        `let s=n(45840);function eval(value){}${replace}${window};`,
        false,
      ),
    ),
  ).toHaveLength(1);
});

it("preserves the constructor captured before eval in its arguments", () => {
  expect(
    windowsIn(
      bootstrap(
        'let s=n(45840);new s.BrowserWindow(eval("s={BrowserWindow:class{}}"));',
      ),
    ),
  ).toHaveLength(1);
});

it.each([
  [
    "a persistent binding across calls",
    `let s=n(45840);function consume(){${window};${replace}}consume();consume();`,
  ],
  [
    "a deferred effect in a nested closure",
    `let s=n(45840);function change(){${replace}}change();${window};`,
  ],
  [
    "a binding retained across loop iterations",
    `let s=n(45840);for(let i=0;i<2;i++){${window};${replace}}`,
  ],
] as const)("does not order away %s", (_name, body) => {
  expect(windowsIn(bootstrap(body))).toHaveLength(0);
});

it("does not order away a sloppy-eval shadow from a prior loop iteration", () => {
  expect(
    windowsIn(
      bootstrap(
        `const s=n(45840);function consume(){for(let i=0;i<2;i++){${window};eval("var s={BrowserWindow:class{}}");}}consume();`,
        false,
      ),
    ),
  ).toHaveLength(0);
});

it("does not introduce a caller-local shadow from strict eval", () => {
  expect(
    windowsIn(
      bootstrap(
        `const s=n(45840);function consume(){eval("var s={BrowserWindow:class{}}");${window};}consume();`,
      ),
    ),
  ).toHaveLength(1);
});

it("retains possible Electron writes through a binding made uncertain by eval", () => {
  expect(
    windowsIn(
      '(()=>{let s=require("electron");eval("0");s.BrowserWindow=class{};const exact=require("electron");new exact.BrowserWindow({webPreferences:{nodeIntegration:true}})})();',
    ),
  ).toHaveLength(0);
});

const electronIn = (source: string) => {
  const parsed = parseJavaScriptSource(source, "main.cjs");
  if (parsed === null) throw new Error("Expected valid CommonJS fixture");
  expect(parsed.errors).toEqual([]);
  return analyzeParsedJavaScriptStaticSource(source, parsed).electron;
};

const replaceAll =
  'eval("s={ipcMain:{on(){},handle(){}},ipcRenderer:{send(){},invoke(){}},contextBridge:{exposeInMainWorld(){}}}");';

it.each([
  ["ipcMain.on", 's.ipcMain.on("chan",()=>{});', "ipc"],
  ["ipcMain.handle", 's.ipcMain.handle("chan",()=>{});', "ipc"],
  ["ipcRenderer.send", 's.ipcRenderer.send("chan");', "ipc"],
  ["ipcRenderer.invoke", 's.ipcRenderer.invoke("chan");', "ipc"],
  [
    "contextBridge.exposeInMainWorld",
    's.contextBridge.exposeInMainWorld("api",{ping(){}});',
    "context_bridge_apis",
  ],
] as const)(
  "does not report %s through a binding replaced by direct eval",
  (_name, call, collection) => {
    for (const wrap of [
      (body: string) => bootstrap(`let s=n(45840);${body}`),
      (body: string) => `(()=>{let s=require("electron");${body}})();`,
    ]) {
      expect(electronIn(wrap(call))[collection]).toHaveLength(1);
      expect(electronIn(wrap(`${replaceAll}${call}`))[collection]).toEqual([]);
    }
  },
);

it("keeps IPC registered before a direct eval replaces the binding", () => {
  const electron = electronIn(
    `(()=>{let s=require("electron");s.ipcMain.on("before",()=>{});${replaceAll}s.ipcMain.on("after",()=>{})})();`,
  );
  expect(electron.ipc.map(({ channel }) => channel)).toEqual(["before"]);
});

it("keeps IPC through a binding a strict nested eval cannot replace", () => {
  expect(
    electronIn(
      bootstrap(
        'const s=n(45840);function other(){eval("var s={}");}other();s.ipcMain.on("chan",()=>{});',
      ),
    ).ipc,
  ).toHaveLength(1);
});
