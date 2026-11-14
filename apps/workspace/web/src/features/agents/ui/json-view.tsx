import { useState } from "react";
import { useAgentMessages } from "./messages";

export function CopyValue({ text, request = false }: { readonly text: string; readonly request?: boolean }) {
  const { tr } = useAgentMessages();
  const [state, setState] = useState<"ready" | "copied" | "failed">("ready");
  return <button type="button" onClick={() => { void navigator.clipboard.writeText(text).then(() => setState("copied"), () => setState("failed")); }}>
    {state === "copied" ? tr.copied : state === "failed" ? tr.copyFailed : request ? tr.copyRequest : tr.copy}
  </button>;
}
export function LongText({ text }: { readonly text: string }) {
  const { tr } = useAgentMessages();
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n").length;
  const folded = lines > 30 || text.length > 240;
  return <div>{folded ? <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
    {expanded ? tr.collapse : tr.expand} · {lines} {tr.lines} · {new Blob([text]).size} B
  </button> : null}<pre>{folded && !expanded ? text.slice(0, 240).split("\n").slice(0, 10).join("\n") + "…" : text}</pre></div>;
}
function JsonNode({ value, depth = 0, name }: { readonly value: unknown; readonly depth?: number; readonly name?: string }) {
  const { tr } = useAgentMessages();
  const serialized = JSON.stringify(value) ?? String(value);
  const [expanded, setExpanded] = useState(depth < 3 && new Blob([serialized]).size <= 4096);
  if (typeof value === "string") {
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { parsed = undefined; }
    if (parsed !== null && typeof parsed === "object") return <div className="trajectory-json-node"><span>{name} <small>{tr.jsonString}</small></span><JsonNode value={parsed} depth={depth} /></div>;
    return <div className="trajectory-json-node">{name ? <strong>{name}</strong> : null}<LongText text={value} /></div>;
  }
  if (value === null || typeof value !== "object") return <div className="trajectory-json-node">{name ? `${name}: ` : ""}{serialized}</div>;
  const entries = Object.entries(value);
  return <div className="trajectory-json-node">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "▾" : "▸"} {name} {Array.isArray(value) ? "[]" : "{}"} · {entries.length} {Array.isArray(value) ? tr.items : tr.keys} · {new Blob([serialized]).size} B</button>
    {expanded ? entries.map(([key, item]) => <JsonNode key={key} name={key} value={item} depth={depth + 1} />) : null}
  </div>;
}
export function JsonView({ value, raw }: { readonly value: unknown; readonly raw?: string }) {
  const { tr } = useAgentMessages();
  const [mode, setMode] = useState("tree");
  const original = raw ?? JSON.stringify(value, null, 2) ?? String(value);
  return <div className="trajectory-json"><div className="trajectory-actions">
    <button type="button" aria-pressed={mode === "tree"} onClick={() => setMode("tree")}>{tr.tree}</button>
    <button type="button" aria-pressed={mode === "raw"} onClick={() => setMode("raw")}>{tr.raw}</button><CopyValue text={original} />
  </div>{mode === "raw" ? <LongText text={original} /> : <JsonNode value={value} />}</div>;
}
