import { expect, it } from "vitest";
import { createAnalysisExecution } from "./AnalysisProvider.js";
import { EnhancedTools } from "./EnhancedTools.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { ok } from "../domain/result.js";

it("returns cancellation rather than a successful partial trace after aborting expansion", async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  const tools = new EnhancedTools({
    async execute(operation) {
      calls.push(operation);
      if (operation === "procedure_address")
        return ok(
          createAnalysisExecution("0x1000", {
            id: "fixture",
            name: "Fixture",
            version: "1",
          }),
        );
      if (operation === "procedure_callees") {
        controller.abort();
        return ok(
          createAnalysisExecution(["0x2000"], {
            id: "fixture",
            name: "Fixture",
            version: "1",
          }),
        );
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  });
  const result = await tools.execute(
    "trace_call_path",
    { start: "main", direction: "forward" },
    controller.signal,
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Cancelled trace was reported as successful");
  expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  expect(calls).toEqual(["procedure_address", "procedure_callees"]);
});
