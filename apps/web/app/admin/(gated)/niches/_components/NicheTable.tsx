"use client";

import { useState, useTransition } from "react";
import { approveForValidationAction, rejectCandidateAction } from "../actions";

export interface NicheScoreSummary {
  id: string;
  scoredAt: string;
  model: string;
  totalScore: number;
  rubricVersion: string;
  breakdown: Record<string, { score: number; evidence: unknown }>;
  notes: string | null;
}

export interface NicheRow {
  candidateId: string;
  topic: string;
  topicSlug: string;
  source: string;
  relatedKeywords: string[];
  surfacedAt: string;
  trademarkCheckState: string;
  killListMatch: { category?: { id?: string } } | null;
  state: string;
  score: NicheScoreSummary | null;
}

const REJECT_REASONS: { value: string; label: string }[] = [
  { value: "manual_operator_kill", label: "Operator kill (handmatig)" },
  { value: "kill_list_match", label: "Kill-list match" },
  { value: "duplicate_topic", label: "Duplicate topic" },
  { value: "other", label: "Other" },
];

const cellStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderBottom: "1px solid #f0f0f0",
  fontSize: "0.875rem",
  verticalAlign: "top",
};

const btnStyle: React.CSSProperties = {
  padding: "0.25rem 0.5rem",
  fontSize: "0.75rem",
  borderRadius: "0.25rem",
  cursor: "pointer",
  border: "1px solid #d4d4d4",
  background: "#fff",
};

export function NicheTable({ rows }: { rows: NicheRow[] }) {
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, { kind: "ok" | "err"; msg: string }>>({});

  return (
    <div style={{ border: "1px solid #e5e5e5", borderRadius: "0.5rem", overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead style={{ background: "#fafafa" }}>
          <tr>
            <th style={{ ...cellStyle, textAlign: "left" }}>Topic</th>
            <th style={{ ...cellStyle, textAlign: "left" }}>Source</th>
            <th style={{ ...cellStyle, textAlign: "right" }}>Score</th>
            <th style={{ ...cellStyle, textAlign: "left" }}>State</th>
            <th style={{ ...cellStyle, textAlign: "left" }}>Trademark</th>
            <th style={{ ...cellStyle, textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <NicheRowView
              key={row.candidateId}
              row={row}
              expanded={openRow === row.candidateId}
              onToggle={() =>
                setOpenRow((cur) => (cur === row.candidateId ? null : row.candidateId))
              }
              feedback={feedback[row.candidateId]}
              setFeedback={(f) => setFeedback((m) => ({ ...m, [row.candidateId]: f }))}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NicheRowView({
  row,
  expanded,
  onToggle,
  feedback,
  setFeedback,
}: {
  row: NicheRow;
  expanded: boolean;
  onToggle: () => void;
  feedback: { kind: "ok" | "err"; msg: string } | undefined;
  setFeedback: (f: { kind: "ok" | "err"; msg: string }) => void;
}) {
  const [pending, startTransition] = useTransition();
  const total = row.score?.totalScore;
  const stateAlreadyDecided = row.state !== "candidate";

  const onApprove = () => {
    if (!confirm(`Approve "${row.topic}" voor validation?`)) return;
    startTransition(async () => {
      const res = await approveForValidationAction(row.candidateId);
      setFeedback(
        res.ok ? { kind: "ok", msg: "Approved" } : { kind: "err", msg: res.error ?? "fout" },
      );
    });
  };

  const onReject = () => {
    const reason = prompt(
      `Reden voor reject van "${row.topic}"?\nOpties:\n${REJECT_REASONS.map((r) => `- ${r.value}`).join("\n")}`,
      "manual_operator_kill",
    );
    if (!reason) return;
    const details = prompt("Optionele details (max 500 tekens):", "") ?? "";
    startTransition(async () => {
      const res = await rejectCandidateAction(
        row.candidateId,
        reason.trim(),
        details.trim() || null,
      );
      setFeedback(
        res.ok ? { kind: "ok", msg: "Rejected" } : { kind: "err", msg: res.error ?? "fout" },
      );
    });
  };

  return (
    <>
      <tr style={{ opacity: pending ? 0.5 : 1 }}>
        <td style={cellStyle}>
          <div style={{ fontWeight: 500 }}>{row.topic}</div>
          <div style={{ fontSize: "0.75rem", color: "#737373" }}>{row.topicSlug}</div>
        </td>
        <td style={cellStyle}>{row.source}</td>
        <td style={{ ...cellStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          <strong style={{ color: scoreColor(total) }}>{total ?? "—"}</strong>
        </td>
        <td style={cellStyle}>
          <StateBadge state={row.state} />
        </td>
        <td style={cellStyle}>
          <span style={{ fontSize: "0.75rem" }}>{row.trademarkCheckState}</span>
          {row.killListMatch?.category?.id && (
            <div style={{ fontSize: "0.75rem", color: "#dc2626" }}>
              kill: {row.killListMatch.category.id}
            </div>
          )}
        </td>
        <td style={{ ...cellStyle, textAlign: "right", whiteSpace: "nowrap" }}>
          <button type="button" style={btnStyle} onClick={onToggle}>
            {expanded ? "Sluit" : "Breakdown"}
          </button>{" "}
          <button
            type="button"
            style={{ ...btnStyle, background: "#16a34a", color: "#fff", borderColor: "#16a34a" }}
            disabled={pending || stateAlreadyDecided}
            onClick={onApprove}
          >
            Approve
          </button>{" "}
          <button
            type="button"
            style={{ ...btnStyle, background: "#dc2626", color: "#fff", borderColor: "#dc2626" }}
            disabled={pending || stateAlreadyDecided}
            onClick={onReject}
          >
            Reject
          </button>
          {feedback && (
            <div
              style={{
                fontSize: "0.75rem",
                marginTop: "0.25rem",
                color: feedback.kind === "ok" ? "#16a34a" : "#dc2626",
              }}
            >
              {feedback.msg}
            </div>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} style={{ ...cellStyle, background: "#fafafa" }}>
            <BreakdownView row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

function BreakdownView({ row }: { row: NicheRow }) {
  if (!row.score) {
    return <em style={{ color: "#737373" }}>Geen score beschikbaar.</em>;
  }
  const entries = Object.entries(row.score.breakdown).filter(([k]) => k !== "haiku_first_pass");

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.875rem", marginBottom: "0.5rem" }}>
          Score breakdown — rubric {row.score.rubricVersion} · {row.score.model}
        </h3>
        <table style={{ width: "100%", fontSize: "0.8125rem" }}>
          <tbody>
            {entries.map(([key, val]) => {
              const score = (val as { score: number }).score;
              return (
                <tr key={key}>
                  <td style={{ padding: "0.125rem 0.5rem 0.125rem 0", color: "#525252" }}>{key}</td>
                  <td
                    style={{
                      padding: "0.125rem 0",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      color: scoreColor(score),
                    }}
                  >
                    {score}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {row.score.notes && (
          <p style={{ fontSize: "0.8125rem", marginTop: "0.5rem", color: "#525252" }}>
            <strong>Notes:</strong> {row.score.notes}
          </p>
        )}
      </div>
      <div>
        <h3 style={{ fontSize: "0.875rem", marginBottom: "0.5rem" }}>Evidence</h3>
        <details style={{ fontSize: "0.75rem" }}>
          <summary style={{ cursor: "pointer", color: "#525252" }}>
            Toon raw evidence ({entries.length} criteria)
          </summary>
          <pre
            style={{
              background: "#fff",
              padding: "0.5rem",
              borderRadius: "0.25rem",
              border: "1px solid #e5e5e5",
              fontSize: "0.6875rem",
              maxHeight: 400,
              overflow: "auto",
            }}
          >
            {JSON.stringify(Object.fromEntries(entries), null, 2)}
          </pre>
        </details>
        <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "#737373" }}>
          <div>Surfaced: {new Date(row.surfacedAt).toLocaleString("nl-NL")}</div>
          <div>Scored: {new Date(row.score.scoredAt).toLocaleString("nl-NL")}</div>
          <div>Related: {row.relatedKeywords.slice(0, 6).join(", ")}</div>
        </div>
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    candidate: { bg: "#e5e5e5", fg: "#404040" },
    approved_for_validation: { bg: "#dbeafe", fg: "#1d4ed8" },
    validating: { bg: "#fef3c7", fg: "#a16207" },
    go: { bg: "#dcfce7", fg: "#15803d" },
    pivot: { bg: "#fef9c3", fg: "#854d0e" },
    killed: { bg: "#fee2e2", fg: "#b91c1c" },
  };
  const c = colors[state] ?? { bg: "#e5e5e5", fg: "#404040" };
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        padding: "0.125rem 0.5rem",
        borderRadius: "9999px",
        fontSize: "0.6875rem",
        fontWeight: 500,
      }}
    >
      {state}
    </span>
  );
}

function scoreColor(score: number | undefined): string {
  if (score === undefined) return "#737373";
  if (score >= 75) return "#15803d";
  if (score >= 55) return "#a16207";
  return "#525252";
}
