import { expect } from "vitest";
import { z } from "zod";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest(
  "invalidates a possible with-body member write through CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-with-member-write-");
    await writeFixtureFiles(root, {
      "package.json": JSON.stringify({
        name: "with-write-probe",
        version: "1.0.0",
        main: "main.js",
      }),
      "main.js": `
      const shared = { mode: "initial", keep: 1 };
      const unrelated = {};
      with (unrelated) { shared.mode = "updated"; }
      module.exports.read = function read() { return shared.mode; };
      module.exports.keep = function keep() { return shared.keep; };
    `,
    });
    const shapeSchema = z.object({
      semantic_role: z.literal("export-return-shapes"),
      exported_name: z.string(),
      static_return_shapes: z.array(
        z.object({
          fields: z.array(z.object({ state: z.string(), value: z.unknown() })),
        }),
      ),
    });
    for (const surface of ["CLI", "stdio MCP"] as const) {
      const result = await analyzeJavaScriptDirectory(surface, cli, root);
      const shapes = result.graph.nodes.flatMap(({ observations }) =>
        observations.flatMap(({ properties }) => {
          const parsed = shapeSchema.safeParse(properties);
          return parsed.success ? [parsed.data] : [];
        }),
      );
      expect(
        shapes.find((shape) => shape.exported_name === "read")
          ?.static_return_shapes[0]?.fields[0],
      ).toMatchObject({ state: "unknown", value: null });
      expect(
        shapes.find((shape) => shape.exported_name === "keep")
          ?.static_return_shapes[0]?.fields[0],
      ).toMatchObject({ state: "literal", value: 1 });
    }
  },
);
