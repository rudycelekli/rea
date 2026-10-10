import { expect, it } from "vitest";
import { parseInterfaceBuilderRecords } from "./interfaceBuilderKeyedArchive.js";

it("distinguishes image views and cells from their image resources", () => {
  // NSImageView and NSImageCell observed in Xcode ibtool --objects output.
  const { objects } = parseInterfaceBuilderRecords({
    "com.apple.ibtool.document.objects": {
      view: { class: "NSImageView" },
      cell: { class: "NSImageCell" },
      image: { class: "NSImage" },
    },
  });
  expect(objects.map(({ kind }) => kind)).toEqual(["view", "view", "resource"]);
});
