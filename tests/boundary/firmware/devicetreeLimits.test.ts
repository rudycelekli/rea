import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DevicetreeProvider } from "../../../src/firmware/devicetree/DevicetreeProvider.js";
import { DevicetreeService } from "../../../src/application/binaryDiagnostics/DevicetreeService.js";
import {
  devicetreeFixture,
  type FixtureNode,
} from "../../../src/firmware/devicetree/Devicetree.fixture.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const exhaust = async (depth: number, maxDepth: number) => {
  let leaf: FixtureNode = { name: "leaf" };
  for (let level = 2; level < depth; level++)
    leaf = { name: `n${String(level)}`, children: [leaf] };
  const root = await createTestTempDirectory("rea-dtb-limits-");
  const path = join(root, "board.dtb");
  await writeFile(path, devicetreeFixture({ name: "", children: [leaf] }));
  const result = await new DevicetreeService(new DevicetreeProvider()).inspect({
    path,
    max_depth: maxDepth,
  });
  if (result.ok) throw new Error("Expected a depth refusal");
  return projectAnalysisError(result.error);
};

it("does not recommend raising max_depth already at its schema ceiling", async () => {
  const error = await exhaust(257, 256);
  expect(error.code).toBe("resource_constraint");
  expect(error.details).toMatchObject({
    reported_limits: { limit: "max_depth", selected: 256 },
  });
  const text = JSON.stringify([error.message, error.remediation]);
  expect(text).toContain("256 schema ceiling");
  expect(text).not.toMatch(/raise that caller-selected limit/u);
});

it("still recommends raising max_depth below its schema ceiling", async () => {
  const error = await exhaust(5, 4);
  expect(error.details).toMatchObject({
    reported_limits: { limit: "max_depth", selected: 4 },
  });
  expect(JSON.stringify([error.message, error.remediation])).toMatch(
    /raise that caller-selected limit/u,
  );
});
