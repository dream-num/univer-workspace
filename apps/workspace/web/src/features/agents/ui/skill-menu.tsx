import { useEffect, useId, useRef, useState } from "react";
import type { AgentScope, SkillCatalog } from "../agent.types";
import { useAgentClient } from "./client";
import { useAgentMessages } from "./messages";

type MenuKey = Pick<KeyboardEvent, "key" | "isComposing" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "preventDefault">;
export function useSkillMenu(text: string, scope: AgentScope, disabled: boolean, onComplete: (text: string) => void) {
  const client = useAgentClient();
  const listboxId = useId();
  const cache = useRef(new Map<string, Promise<SkillCatalog | null>>());
  const [loaded, setLoaded] = useState<{ key: string; catalog: SkillCatalog | null } | null>(null);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const scopeKey = scope.kind === "repository" ? scope.spaceId : null;
  const key = JSON.stringify(scopeKey);
  const trigger = /^\/[^\s]*$/.test(text) && !disabled;
  useEffect(() => { setIndex(0); setDismissed(false); }, [text, key]);
  useEffect(() => {
    if (!trigger) return;
    let cancelled = false;
    let request = cache.current.get(key);
    if (!request) {
      request = client.runner().then((runner) => runner.skills(scopeKey === null ? { kind: "global" }
        : { kind: "repository", spaceId: scopeKey, baseWorktreeId: null })).catch(() => { cache.current.delete(key); return null; });
      cache.current.set(key, request);
    }
    void request.then((catalog) => { if (!cancelled) setLoaded({ key, catalog }); });
    return () => { cancelled = true; };
  }, [client, key, scopeKey, trigger]);
  const items = trigger && !dismissed && loaded?.key === key
    ? (loaded.catalog?.skills ?? []).filter((skill) => skill.userInvocable && skill.name.startsWith(text.slice(1))) : [];
  const selected = index % (items.length || 1);
  function choose(position: number) {
    const skill = items[position];
    if (skill) onComplete(`/${skill.name} `);
  }
  function onKeyDown(event: MenuKey): boolean {
    if (!items.length || event.isComposing || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return false;
    event.preventDefault();
    if (event.key === "Escape") setDismissed(true);
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") setIndex((selected + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
    else choose(selected);
    return true;
  }
  const optionId = (name: string) => `${listboxId}-${name}`;
  const inputProps = {
    role: "combobox" as const,
    "aria-expanded": items.length > 0,
    "aria-controls": items.length ? listboxId : undefined,
    "aria-autocomplete": "list" as const,
    "aria-activedescendant": items[selected] ? optionId(items[selected].name) : undefined,
  };
  return { items, selected, choose, onKeyDown, listboxId, optionId, inputProps };
}
export function SkillMenu({ menu }: { readonly menu: ReturnType<typeof useSkillMenu> }) {
  const m = useAgentMessages();
  const selected = useRef<HTMLButtonElement>(null);
  const activeId = menu.inputProps["aria-activedescendant"];
  useEffect(() => { selected.current?.scrollIntoView({ block: "nearest" }); }, [activeId]);
  return menu.items.length ? <div id={menu.listboxId} className="agent-skill-menu" role="listbox" aria-label={m.invokeSkill}>
    {menu.items.map((skill, index) => <button type="button" role="option" key={skill.name} id={menu.optionId(skill.name)} tabIndex={-1}
      ref={menu.selected === index ? selected : null} aria-selected={menu.selected === index}
      onMouseDown={(event) => event.preventDefault()} onClick={() => menu.choose(index)}>
      <span className="agent-skill-menu-heading"><strong>/{skill.name}</strong><span>{skill.source === "repository" ? m.repository : m.personalSkill}</span></span>
      <span className="agent-skill-menu-description">{skill.description}</span>
      {skill.argumentHint ? <span className="agent-skill-menu-hint">{skill.argumentHint}</span> : null}
    </button>)}
  </div> : null;
}
