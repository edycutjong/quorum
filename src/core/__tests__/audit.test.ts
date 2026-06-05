import { describe, it, expect, vi, afterEach } from "vitest";
import { audit, setAuditWriter, type AuditRecord } from "../audit";

describe("audit.ts — structured audit log", () => {
  afterEach(() => setAuditWriter(null));

  it("is a no-op when no writer is registered", () => {
    // Should not throw with no sink.
    expect(() => audit({ event: "model_load", modelId: "m" })).not.toThrow();
  });

  it("emits a timestamped record to the registered writer", () => {
    const records: (AuditRecord & { ts: string })[] = [];
    setAuditWriter((r) => records.push(r));
    audit({ event: "inference", label: "researcher", promptTokens: 12 });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ event: "inference", label: "researcher", promptTokens: 12 });
    expect(typeof records[0].ts).toBe("string");
  });

  it("swallows writer errors (logging must never break inference)", () => {
    setAuditWriter(() => { throw new Error("disk full"); });
    expect(() => audit({ event: "model_unload", modelId: "m" })).not.toThrow();
  });

  it("stops emitting after the writer is cleared", () => {
    const writer = vi.fn();
    setAuditWriter(writer);
    audit({ event: "model_load", modelId: "m" });
    setAuditWriter(null);
    audit({ event: "model_load", modelId: "m2" });
    expect(writer).toHaveBeenCalledTimes(1);
  });
});
