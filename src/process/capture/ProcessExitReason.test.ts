import type { IPty } from "@lydell/node-pty";
import { afterEach, expect, it, vi } from "vitest";
import { parseProcessScenario } from "../../domain/process/processScenario.js";
import { awaitTerminalExit } from "./ProcessCaptureLifecycle.js";
import type { ProcessTimer } from "./ProcessTimer.js";

afterEach(() => vi.useRealTimers());
it("preserves idle timeout when the overall deadline arrives before PTY exit", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let exit: ((value: { exitCode: number }) => void) | undefined;
  const kill = vi.fn();
  const terminal = {
    onExit: (callback: typeof exit) => {
      exit = callback;
    },
    kill,
  } as unknown as IPty;
  const pending = awaitTerminalExit({
    terminal,
    scenario: parseProcessScenario({
      executable: "/bin/true",
      working_directory: "/",
      timeout_ms: 40,
      idle_timeout_ms: 20,
    }),
    started: 0,
    lastOutput: () => 0,
    signal: undefined,
    timers: new Set<ProcessTimer>(),
    interactions: [],
    dispatchedEventIndexes: new Set<number>(),
    recordEvent: () => {},
  });
  await vi.advanceTimersByTimeAsync(40);
  exit!({ exitCode: -1 });
  expect((await pending).reason).toBe("idle_timeout");
  expect(kill).toHaveBeenCalledOnce();
});
