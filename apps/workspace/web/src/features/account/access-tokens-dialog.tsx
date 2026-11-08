import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { components } from "../../../../generated/http/schema.js";
import { useI18n, type MessageKey } from "../../shared/i18n";
import { Alert, Button, ConfirmDialog, Dialog, Field, Input, Select } from "../../shared/ui";
import { createAccessToken, revokeAccessToken } from "./access-tokens.commands";
import { accessTokensQueryOptions } from "./access-tokens.queries";

type McpScope = components["schemas"]["McpScope"];
type TokenView = { kind: "list" } | { kind: "new" } | { kind: "created"; token: string };

const scopeDescriptions = {
  read: "accessTokenScopeRead",
  write: "accessTokenScopeWrite",
  publish: "accessTokenScopePublish",
  "worktree:merge": "accessTokenScopeMerge",
} satisfies Record<McpScope, MessageKey>;
const allScopes = ["read", "write", "publish", "worktree:merge"] satisfies McpScope[];

// Access tokens unmount on close so the plaintext cannot reappear on reopening.
export function AccessTokensDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return open ? <AccessTokensDialogContent onOpenChange={onOpenChange} /> : null;
}

function AccessTokensDialogContent({
  onOpenChange,
}: {
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { t, language } = useI18n();
  const client = useQueryClient();
  const tokens = useQuery(accessTokensQueryOptions);
  const [view, setView] = useState<TokenView>({ kind: "list" });
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<McpScope[]>(allScopes);
  const [expiry, setExpiry] = useState<"never" | "30" | "90">("never");
  const [validationError, setValidationError] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const create = useMutation({
    mutationFn: async (body: components["schemas"]["PersonalAccessTokenCreate"]) => {
      const created = await createAccessToken(body);
      setView({ kind: "created", token: created.token });
      // Keep the plaintext out of TanStack Query's mutation cache.
      return created.record;
    },
    onSuccess: (record) => {
      client.setQueryData(accessTokensQueryOptions.queryKey, (previous) => ({
        tokens: [record, ...(previous?.tokens ?? [])],
      }));
      void client.invalidateQueries({ queryKey: accessTokensQueryOptions.queryKey });
    },
  });
  const revoke = useMutation({
    mutationFn: revokeAccessToken,
    onSuccess: (_data, id) => {
      client.setQueryData(
        accessTokensQueryOptions.queryKey,
        (previous) =>
          previous && {
            tokens: previous.tokens.filter((token) => token.id !== id),
          },
      );
      void client.invalidateQueries({ queryKey: accessTokensQueryOptions.queryKey });
    },
  });
  const busy = create.isPending || revoke.isPending;
  const activeTokens = tokens.data?.tokens.filter((token) => token.revokedAt === null) ?? [];
  const date = (value: number | null) =>
    value === null ? t("accessTokenNever") : new Date(value).toLocaleString(language);
  const returnToList = () => {
    setView({ kind: "list" });
    setCopyStatus("idle");
    setValidationError("");
    create.reset();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!name.trim() || name.trim().length > 100) {
      setValidationError(t("accessTokenNameRequired"));
      return;
    }
    if (scopes.length === 0) {
      setValidationError(t("accessTokenScopeRequired"));
      return;
    }
    setValidationError("");
    create.mutate({
      name: name.trim(),
      scopes,
      expiresAt: expiry === "never" ? null : Date.now() + Number(expiry) * 24 * 60 * 60 * 1000,
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      title={t("accessTokens")}
      description={t("accessTokensDescription")}
      width="xl"
      footer={
        view.kind === "new" ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={returnToList}>
              {t("cancel")}
            </Button>
            <Button type="submit" form="access-token-form" disabled={busy}>
              {t("accessTokenCreate")}
            </Button>
          </>
        ) : (
          <Button
            disabled={busy}
            onClick={() => (view.kind === "created" ? returnToList() : onOpenChange(false))}
          >
            {t("accessTokenDone")}
          </Button>
        )
      }
    >
      {view.kind === "list" ? (
        <div className="grid gap-4">
          <Button
            className="justify-self-start"
            disabled={busy}
            onClick={() => {
              setName("");
              setScopes(allScopes);
              setExpiry("never");
              revoke.reset();
              setView({ kind: "new" });
            }}
          >
            {t("accessTokenNew")}
          </Button>
          {tokens.isPending ? <p role="status">{t("dashboardLoading")}</p> : null}
          {tokens.error ? <Alert variant="destructive">{tokens.error.message}</Alert> : null}
          {revoke.error ? <Alert variant="destructive">{revoke.error.message}</Alert> : null}
          {tokens.data && activeTokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("accessTokensEmpty")}</p>
          ) : null}
          <ul className="grid gap-3">
            {activeTokens.map((token) => (
              <li key={token.id} className="grid gap-3 rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 font-medium break-words">{token.name}</span>
                  <ConfirmDialog
                    trigger={
                      <Button variant="secondary" size="sm">
                        {t("accessTokenRevoke")}
                      </Button>
                    }
                    title={t("accessTokenRevokeTitle")}
                    description={t("accessTokenRevokeDescription", { name: token.name })}
                    confirmText={t("accessTokenRevoke")}
                    cancelText={t("cancel")}
                    danger
                    disabled={busy}
                    onConfirm={() => revoke.mutate(token.id)}
                  />
                </div>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">{t("accessTokenScopes")}</dt>
                    <dd className="break-words">{token.scopes.join(", ")}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("accessTokenCreated")}</dt>
                    <dd>{date(token.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("accessTokenLastUsed")}</dt>
                    <dd>
                      {token.lastUsedAt === null
                        ? t("accessTokenNeverUsed")
                        : date(token.lastUsedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("accessTokenExpires")}</dt>
                    <dd>{date(token.expiresAt)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </div>
      ) : view.kind === "new" ? (
        <form id="access-token-form" className="grid gap-4" onSubmit={submit}>
          <Field label={t("name")} htmlFor="access-token-name" required>
            <Input
              id="access-token-name"
              value={name}
              maxLength={100}
              required
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <fieldset className="grid gap-2" disabled={busy}>
            <legend className="mb-2 text-sm font-medium">{t("accessTokenScopes")}</legend>
            {allScopes.map((scope) => (
              <label key={scope} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 accent-primary"
                  checked={scopes.includes(scope)}
                  aria-label={scope}
                  onChange={(event) => {
                    setScopes((previous) =>
                      event.target.checked
                        ? [...previous, scope]
                        : previous.filter((value) => value !== scope),
                    );
                  }}
                />
                <span>
                  <span className="font-medium">{scope}</span>
                  <span className="block text-muted-foreground">{t(scopeDescriptions[scope])}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Field label={t("accessTokenExpires")}>
            <Select
              value={expiry}
              onValueChange={setExpiry}
              disabled={busy}
              aria-label={t("accessTokenExpires")}
              options={[
                { value: "never", label: t("accessTokenNever") },
                { value: "30", label: t("accessToken30Days") },
                { value: "90", label: t("accessToken90Days") },
              ]}
            />
          </Field>
          {validationError ? <Alert variant="destructive">{validationError}</Alert> : null}
          {create.error ? <Alert variant="destructive">{create.error.message}</Alert> : null}
        </form>
      ) : (
        <div className="grid gap-4">
          <Alert variant="warning">{t("accessTokenShownOnce")}</Alert>
          <Field label={t("accessTokenSecret")} htmlFor="access-token-secret">
            <Input
              id="access-token-secret"
              readOnly
              value={view.token}
              className="font-mono"
              onFocus={(event) => event.target.select()}
            />
          </Field>
          <Button
            variant="secondary"
            className="justify-self-start"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(view.token);
                setCopyStatus("copied");
              } catch {
                setCopyStatus("failed");
              }
            }}
          >
            {t("accessTokenCopy")}
          </Button>
          {copyStatus === "copied" ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t("accessTokenCopied")}
            </p>
          ) : null}
          {copyStatus === "failed" ? (
            <Alert variant="destructive">{t("accessTokenCopyFailed")}</Alert>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
