import { expect, it } from "vitest";
import { parseInterfaceBuilderRecords } from "./interfaceBuilderKeyedArchive.js";

it("reports hierarchy roots omitted by the ibtool projection limit", () => {
  const hierarchy = Array.from({ length: 20_001 }, (_, index) => ({
    objectID: String(index),
  }));
  const result = parseInterfaceBuilderRecords({
    "com.apple.ibtool.document.hierarchy": hierarchy,
  });
  expect(result.hierarchy).toHaveLength(20_000);
  expect(result.omittedHierarchyReferences).toBe(1);
});
