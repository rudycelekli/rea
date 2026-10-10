import { afterEach, expect, it, vi } from "vitest";
import { ProviderStartupDeadline } from "./ProviderDeadline.js";

afterEach(() => vi.useRealTimers());
it("does not shorten an accepted long startup deadline to one millisecond", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const deadline = new ProviderStartupDeadline(2_147_483_647 + 25);
  try {
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(deadline.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(25);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.interruption).toBe("timeout");
  } finally {
    deadline.dispose();
  }
});
