import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "preserves the first skill backup through a repair and idempotent rerun",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-skill-first-backup-");
    const skill = join(
      home,
      ".agents/skills/reverse-engineer-anything/SKILL.md",
    );
    const backup = `${skill}.rea.backup`;
    await mkdir(dirname(skill), { recursive: true });
    const original = "first original skill snapshot\n";
    await writeFile(skill, "current stale skill bytes\n");
    await writeFile(backup, original);
    const environment = {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: home,
      XDG_CACHE_HOME: home,
    };
    for (let run = 0; run < 2; run += 1) {
      const result = await cli.run({
        arguments: ["setup", "--skill=true", "--yes", "--json"],
        environment,
        timeoutMs: 15_000,
      });
      expect(result.exitCode).toBe(0);
      expect(result.json).toMatchObject({ status: "ready" });
      expect(await readFile(backup, "utf8")).toBe(original);
    }
  },
);

cliTest(
  "creates one exact skill backup and retains it when a reference is repaired",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-skill-create-backup-");
    const skill = join(
      home,
      ".agents/skills/reverse-engineer-anything/SKILL.md",
    );
    const reference = join(
      dirname(skill),
      "references/native-and-artifacts.md",
    );
    await mkdir(dirname(reference), { recursive: true });
    const original = Buffer.from([0x66, 0x69, 0x72, 0x73, 0x74, 0xff, 0x0a]);
    const originalReference = "first reference bytes\n";
    await writeFile(skill, original);
    await writeFile(reference, originalReference);
    const environment = {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: home,
      XDG_CACHE_HOME: home,
    };
    const first = await cli.run({
      arguments: ["setup", "--skill=true", "--yes", "--json"],
      environment,
      timeoutMs: 15_000,
    });
    expect(first.exitCode).toBe(0);
    expect(await readFile(`${skill}.rea.backup`)).toEqual(original);
    expect(await readFile(`${reference}.rea.backup`, "utf8")).toBe(
      originalReference,
    );
    await writeFile(reference, "later reference edit\n");
    const repaired = await cli.run({
      arguments: ["setup", "--skill=true", "--yes", "--json"],
      environment,
      timeoutMs: 15_000,
    });
    expect(repaired.exitCode).toBe(0);
    expect(await readFile(`${skill}.rea.backup`)).toEqual(original);
    expect(await readFile(`${reference}.rea.backup`, "utf8")).toBe(
      originalReference,
    );
  },
);

cliTest.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "fails without rewriting a stale skill when its first backup is unreadable",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-skill-unreadable-backup-");
    const skill = join(
      home,
      ".agents/skills/reverse-engineer-anything/SKILL.md",
    );
    const backup = `${skill}.rea.backup`;
    await mkdir(dirname(skill), { recursive: true });
    const original = "stale skill to retain\n";
    const firstBackup = "unreadable first snapshot\n";
    await writeFile(skill, original);
    await writeFile(backup, firstBackup);
    await chmod(backup, 0o000);
    const initial = await lstat(skill);
    try {
      const result = await cli.run({
        arguments: ["setup", "--skill=true", "--yes", "--json"],
        environment: {
          HOME: home,
          USERPROFILE: home,
          XDG_CONFIG_HOME: home,
          XDG_CACHE_HOME: home,
        },
        timeoutMs: 15_000,
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({ status: "needs_human" });
      expect(await readFile(skill, "utf8")).toBe(original);
      expect((await lstat(skill)).ino).toBe(initial.ino);
    } finally {
      await chmod(backup, 0o600);
    }
    expect(await readFile(backup, "utf8")).toBe(firstBackup);
  },
);
