import type { IPty } from "@lydell/node-pty";
import { afterEach, expect, it, vi } from "vitest";
import { parseProcessScenario } from "../../domain/process/processScenario.js";
import { scheduleScenarioInteractions } from "./ProcessCaptureJournal.js";
import type { TerminalRenderer } from "./TerminalRenderer.js";
import type { ProcessTimer } from "./ProcessTimer.js";

afterEach(() => vi.useRealTimers());
it("uses the capture start rather than scheduler setup as the interaction origin", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(75);
  const write = vi.fn();
  scheduleScenarioInteractions({
    scenario: parseProcessScenario({
      executable: "/bin/cat",
      working_directory: "/",
      events: [{ type: "input", at_ms: 100, data: "input" }],
    }),
    getTerminal: () => ({ write }) as unknown as IPty,
    timers: new Set<ProcessTimer>(),
    interactions: [],
    renderer: {} as TerminalRenderer,
    started: 0,
    dispatchedEventIndexes: new Set<number>(),
    recordEvent: () => {},
  });
  await vi.advanceTimersByTimeAsync(25);
  expect(write).toHaveBeenCalledWith("input");
});
