import { expect, it } from "vitest";
import { parseInterfaceBuilderRecords } from "./interfaceBuilderKeyedArchive.js";

it("preserves ibtool custom classes and authored labels", () => {
  // Field spellings captured from Xcode ibtool --objects on an owned Cocoa XIB.
  const result = parseInterfaceBuilderRecords({
    "com.apple.ibtool.document.objects": {
      "-1": {
        class: "IBNSCustomObject",
        "custom-class": "FirstResponder",
        ibExternalExplicitLabel: "First Responder",
      },
    },
  });
  expect(result.objects[0]).toMatchObject({
    class_name: "FirstResponder",
    name: "First Responder",
    kind: "placeholder",
  });
});
