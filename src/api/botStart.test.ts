import { describe, it, expect, vi } from "vitest";
import { startBotWithFallback } from "./routes/bots.js";

describe("startBotWithFallback - trade with key, watch without", () => {
  it("returns trade when signing start succeeds", async () => {
    const runner = { start: vi.fn(async (_opts: { withSigner: boolean }) => undefined) };
    await expect(startBotWithFallback(runner)).resolves.toBe("trade");
    expect(runner.start).toHaveBeenCalledWith({ withSigner: true });
  });

  it("falls back to watch-only on missing-key failure", async () => {
    const runner = {
      start: vi.fn(async (opts: { withSigner: boolean }) => {
        if (opts.withSigner) throw new Error("PRIVATE_KEY is required for trading.");
      }),
    };
    await expect(startBotWithFallback(runner)).resolves.toBe("watch");
    expect(runner.start).toHaveBeenCalledTimes(2);
    expect(runner.start).toHaveBeenLastCalledWith({ withSigner: false });
  });

  it("rethrows non-key failures without fallback", async () => {
    const runner = {
      start: vi.fn(async (_opts: { withSigner: boolean }) => {
        throw new Error("indexer exploded");
      }),
    };
    await expect(startBotWithFallback(runner)).rejects.toThrow("indexer exploded");
    expect(runner.start).toHaveBeenCalledTimes(1);
  });
});
