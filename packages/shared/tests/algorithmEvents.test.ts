import { describe, expect, it } from "vitest";
import { type AlgorithmEventRow, selectAlgorithmEvents30d } from "../src/algorithmEvents";

// 2026-06-15; the trailing-30d window is [2026-05-16, 2026-06-15].
const asOf = new Date("2026-06-15T00:00:00.000Z");
const DAY = 86_400_000;
const daysBefore = (n: number) => new Date(asOf.getTime() - n * DAY);

function ev(over: Partial<AlgorithmEventRow> = {}): AlgorithmEventRow {
  return { kind: "core_update", startedAt: daysBefore(60), endedAt: null, ...over };
}

describe("selectAlgorithmEvents30d", () => {
  it("includes a still-ongoing rollout (ended_at NULL), even if it began long ago", () => {
    const out = selectAlgorithmEvents30d([ev({ startedAt: daysBefore(90), endedAt: null })], asOf);
    expect(out).toHaveLength(1);
    expect(out[0]?.ended_at).toBeNull();
  });

  it("includes an event that ended inside the 30-day window", () => {
    const out = selectAlgorithmEvents30d(
      [ev({ startedAt: daysBefore(40), endedAt: daysBefore(5) })],
      asOf,
    );
    expect(out).toHaveLength(1);
  });

  it("excludes an event that ended before the window opened", () => {
    const out = selectAlgorithmEvents30d(
      [ev({ startedAt: daysBefore(60), endedAt: daysBefore(40) })],
      asOf,
    );
    expect(out).toHaveLength(0);
  });

  it("excludes an event that has not started yet (starts after asOf)", () => {
    const out = selectAlgorithmEvents30d(
      [ev({ startedAt: new Date(asOf.getTime() + DAY), endedAt: null })],
      asOf,
    );
    expect(out).toHaveLength(0);
  });

  it("maps rows to the agent shape with ISO strings, sorted by start", () => {
    const out = selectAlgorithmEvents30d(
      [
        ev({ kind: "spam_update", startedAt: daysBefore(3), endedAt: daysBefore(1) }),
        ev({ kind: "core_update", startedAt: daysBefore(20), endedAt: null }),
      ],
      asOf,
    );
    expect(out.map((e) => e.kind)).toEqual(["core_update", "spam_update"]);
    expect(out[0]).toEqual({
      kind: "core_update",
      started_at: daysBefore(20).toISOString(),
      ended_at: null,
    });
    expect(out[1]?.ended_at).toBe(daysBefore(1).toISOString());
  });

  it("accepts ISO string inputs as well as Date", () => {
    const out = selectAlgorithmEvents30d(
      [{ kind: "core_update", startedAt: daysBefore(10).toISOString(), endedAt: null }],
      asOf,
    );
    expect(out).toHaveLength(1);
  });

  it("skips rows with an unparseable started_at", () => {
    const out = selectAlgorithmEvents30d([ev({ startedAt: "not-a-date" })], asOf);
    expect(out).toHaveLength(0);
  });
});
