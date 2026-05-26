"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

export interface NicheFilters {
  state:
    | "all"
    | "candidate"
    | "approved_for_validation"
    | "validating"
    | "go"
    | "pivot"
    | "building"
    | "mature"
    | "promoted"
    | "killed"
    | "archived";
  source: string;
  search: string;
  minScore: number;
  maxScore: number;
}

const STATE_OPTIONS: { value: NicheFilters["state"]; label: string }[] = [
  { value: "all", label: "Alle states" },
  { value: "candidate", label: "Candidate" },
  { value: "approved_for_validation", label: "Approved for validation" },
  { value: "validating", label: "Validating" },
  { value: "go", label: "Go" },
  { value: "pivot", label: "Pivot" },
  { value: "killed", label: "Killed" },
];

const SOURCE_OPTIONS = [
  "all",
  "dataforseo",
  "bol_trends",
  "awin_programmes",
  "daisycon_programs",
  "yt_trending",
  "wiki_pageviews",
  "other",
];

const labelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#525252",
  display: "block",
  marginBottom: "0.25rem",
};
const inputStyle: React.CSSProperties = {
  padding: "0.375rem 0.5rem",
  border: "1px solid #d4d4d4",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  width: "100%",
  boxSizing: "border-box",
};

export function FilterBar({ initial }: { initial: NicheFilters }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const apply = useCallback(
    (patch: Partial<NicheFilters>) => {
      const next = new URLSearchParams(searchParams);
      const merged: NicheFilters = { ...initial, ...patch };
      setOrDelete(next, "state", merged.state, "all");
      setOrDelete(next, "source", merged.source, "all");
      setOrDelete(next, "q", merged.search, "");
      setOrDelete(next, "min", String(merged.minScore), "0");
      setOrDelete(next, "max", String(merged.maxScore), "100");
      startTransition(() => router.replace(`?${next.toString()}`));
    },
    [initial, router, searchParams],
  );

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 120px 120px",
        gap: "0.75rem",
        padding: "0.75rem",
        border: "1px solid #e5e5e5",
        borderRadius: "0.5rem",
        background: "#fafafa",
        opacity: pending ? 0.6 : 1,
      }}
    >
      <div>
        <label htmlFor="f-search" style={labelStyle}>
          Zoek op topic
        </label>
        <input
          id="f-search"
          style={inputStyle}
          type="search"
          defaultValue={initial.search}
          placeholder="bv. aeropress"
          onChange={(e) => apply({ search: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor="f-state" style={labelStyle}>
          State
        </label>
        <select
          id="f-state"
          style={inputStyle}
          defaultValue={initial.state}
          onChange={(e) => apply({ state: e.target.value as NicheFilters["state"] })}
        >
          {STATE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="f-source" style={labelStyle}>
          Source
        </label>
        <select
          id="f-source"
          style={inputStyle}
          defaultValue={initial.source}
          onChange={(e) => apply({ source: e.target.value })}
        >
          {SOURCE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "Alle sources" : s}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="f-min" style={labelStyle}>
          Min score
        </label>
        <input
          id="f-min"
          style={inputStyle}
          type="number"
          min={0}
          max={100}
          defaultValue={initial.minScore}
          onBlur={(e) => apply({ minScore: Number(e.target.value) })}
        />
      </div>
      <div>
        <label htmlFor="f-max" style={labelStyle}>
          Max score
        </label>
        <input
          id="f-max"
          style={inputStyle}
          type="number"
          min={0}
          max={100}
          defaultValue={initial.maxScore}
          onBlur={(e) => apply({ maxScore: Number(e.target.value) })}
        />
      </div>
    </form>
  );
}

function setOrDelete(
  params: URLSearchParams,
  key: string,
  value: string,
  defaultValue: string,
): void {
  if (value === defaultValue) params.delete(key);
  else params.set(key, value);
}
