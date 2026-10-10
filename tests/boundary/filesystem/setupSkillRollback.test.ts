import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type writeFileAtomic from "write-file-atomic";
import { expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { installCanonicalSkill } from "../../../src/application/SetupSkill.js";

const failures = vi.hoisted(() => ({ destination: "", original: "" }));
vi.mock("write-file-atomic", async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof writeFileAtomic }>();
  return {
    default: async (...args: Parameters<typeof actual.default>) => {
      if (args[0] === failures.destination)
        throw new Error(
          args[1] === failures.original ? "restore failed" : "install failed",
        );
      return actual.default(...args);
    },
  };
});

it("restores other skill files when one destination cannot be restored", async () => {
  const home = await createTestTempDirectory("rea-skill-rollback-");
  const root = join(home, ".agents/skills/reverse-engineer-anything");
  const skill = join(root, "SKILL.md");
  const guide = join(root, "references/native-and-artifacts.md");
  await mkdir(dirname(guide), { recursive: true });
  await writeFile(skill, "original skill\n");
  await writeFile(guide, "original guide\n");
  failures.destination = guide;
  failures.original = "original guide\n";
  try {
    expect(await installCanonicalSkill(home, ["codex"])).toBe("failed");
    expect(await readFile(skill, "utf8")).toBe("original skill\n");
    expect(await readFile(`${guide}.rea.backup`, "utf8")).toBe(
      "original guide\n",
    );
  } finally {
    failures.destination = "";
    failures.original = "";
  }
});
