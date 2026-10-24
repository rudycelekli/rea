import { expect, it } from "vitest";

import { detectReferenceSourceLanguage } from "./referenceSourceClassification.js";

it("labels capital .H headers as C++ and lowercase .h headers as C", () => {
  expect(detectReferenceSourceLanguage("widget.H")).toBe("C++");
  expect(detectReferenceSourceLanguage("widget.h")).toBe("C");
  expect(detectReferenceSourceLanguage("widget.C")).toBe("C++");
  expect(detectReferenceSourceLanguage("widget.M")).toBe("Objective-C++");
});
