import { expect, it } from "vitest";

import { CdpCaptureEvents } from "./CdpCaptureEvents.js";
import { inspectWebPageInputSchema } from "../domain/browserObservation.js";
import { webPageInspectionSchema } from "../domain/browserObservationSchemas.js";

const origin = "http://127.0.0.1:43127";

const captureWithConsoleTimestamp = (timestamp: unknown): CdpCaptureEvents => {
  const capture = new CdpCaptureEvents(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: origin,
      allowed_origins: [origin],
      target_id: "allowed-page",
    }),
    new Set([origin]),
  );
  const params: Record<string, unknown> = {
    type: "log",
    args: [],
    stackTrace: {
      callFrames: [{ url: `${origin}/app.js`, lineNumber: 0, columnNumber: 0 }],
    },
  };
  if (timestamp !== undefined) params.timestamp = timestamp;
  capture.ingest({ method: "Runtime.consoleAPICalled", params });
  return capture;
};

it.each([
  ["an omitted timestamp", undefined],
  ["a non-finite timestamp", Number.NaN],
  ["a string timestamp", "123"],
  ["an explicit null timestamp", null],
])(
  "retains %s as unknown and marks console coverage invalid",
  (_label, timestamp) => {
    const capture = captureWithConsoleTimestamp(timestamp);
    const event = capture.console[0];

    expect(event?.timestamp).toBeNull();
    expect(capture.completeness.snapshot().excluded).toContainEqual({
      section: "console_events",
      reason: "invalid_protocol_value",
      count: 1,
    });
    expect(
      webPageInspectionSchema.shape.console.shape.events.element.safeParse(
        event,
      ).success,
    ).toBe(true);
  },
);

it.each([
  ["Unix epoch", 0],
  ["pre-epoch", -1],
])("preserves a finite %s console timestamp", (_label, timestamp) => {
  const capture = captureWithConsoleTimestamp(timestamp);

  expect(capture.console[0]?.timestamp).toBe(timestamp);
  expect(capture.completeness.snapshot().excluded).not.toContainEqual(
    expect.objectContaining({
      section: "console_events",
      reason: "invalid_protocol_value",
    }),
  );
});

it.each([
  {
    lineNumber: -3,
    columnNumber: 7.5,
    line: null,
    column: null,
    invalid: true,
  },
  { lineNumber: 3, columnNumber: -2, line: 3, column: null, invalid: true },
  { lineNumber: "3", columnNumber: 2, line: null, column: 2, invalid: true },
  { lineNumber: 0, columnNumber: 0, line: 0, column: 0, invalid: false },
  { lineNumber: 12, columnNumber: 4, line: 12, column: 4, invalid: false },
  { line: null, column: null, invalid: false },
])(
  "preserves source coordinate uncertainty across console and initiator events: %j",
  ({ lineNumber, columnNumber, line, column, invalid }) => {
    const capture = new CdpCaptureEvents(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: origin,
        allowed_origins: [origin],
        target_id: "allowed-page",
      }),
      new Set([origin]),
    );
    const frame = {
      url: `${origin}/app.js`,
      ...(lineNumber === undefined ? {} : { lineNumber }),
      ...(columnNumber === undefined ? {} : { columnNumber }),
    };
    capture.ingest({
      method: "Runtime.consoleAPICalled",
      params: {
        type: "log",
        args: [],
        timestamp: 1,
        stackTrace: { callFrames: [frame] },
      },
    });
    capture.ingest({
      method: "Network.requestWillBeSent",
      params: {
        requestId: "request",
        timestamp: 1,
        type: "Fetch",
        request: { url: `${origin}/api`, method: "GET", headers: {} },
        initiator: { type: "script", stack: { callFrames: [frame] } },
      },
    });
    expect(capture.console[0]).toMatchObject({
      url: `${origin}/app.js`,
      line,
      column,
    });
    expect(capture.network.get("request")?.initiator).toMatchObject({
      url: `${origin}/app.js`,
      line,
      column,
    });
    for (const section of ["console_events", "network_initiators"]) {
      const exclusions = capture.completeness
        .snapshot()
        .excluded.filter(
          (item) =>
            item.section === section &&
            item.reason === "invalid_protocol_value",
        );
      expect(exclusions).toEqual(
        invalid
          ? [{ section, reason: "invalid_protocol_value", count: 1 }]
          : [],
      );
    }
  },
);
