import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ShieldCheck, ShieldQuestion } from "lucide-react";
import type { ReactNode } from "react";
import type { components } from "../../../../generated/http/schema";
import { AuthCard, sessionQueryOptions } from "../auth";
import { nodeQueryOptions } from "../nodes/nodes.queries";
import {
  nodeGrantsQueryOptions,
  nodeLinkSharingQueryOptions,
  teamMembersQueryOptions,
  userSearchQueryOptions,
  useSetLinkSharing,
  useSetMemberRole,
  useSetNodeGrant,
} from "../permissions";
import { spaceQueryOptions, useUpdateSpace } from "../spaces";
import { useI18n } from "../../shared/i18n";
import { Alert, Button, Spinner } from "../../shared/ui";
import { confirmLevelLabel, confirmText, parseConfirmRequest, type ConfirmLevel, type ConfirmNames, type ConfirmRequest } from "./confirm-request";

type PublicUser = components["schemas"]["PublicUser"];
type Of<A extends ConfirmRequest["action"]> = { readonly request: Extract<ConfirmRequest, { readonly action: A }> };
interface Read { readonly isPending: boolean; readonly error: Error | null }

export function ConfirmPage({ action, search, returnTo }: { readonly action: string; readonly search: string; readonly returnTo: string | undefined }) {
  const session = useQuery(sessionQueryOptions);
  const { t } = useI18n();
  if (session.isPending) return <Loading />;
  if (!session.data?.authenticated || session.data.user.kind !== "human") {
    return (
      <main className="auth-backdrop grid min-h-dvh place-items-center px-5 py-8">
        <div className="flex w-full flex-col items-center gap-6">
          <Alert className="w-[min(420px,100%)]" title={t("cliLoginSignInFirst")}>{t("confirmSignInDescription")}</Alert>
          <AuthCard {...(returnTo === undefined ? {} : { returnTo })} />
        </div>
      </main>
    );
  }
  const request = parseConfirmRequest(action, new URLSearchParams(search));
  if (!request) return <Card title={t("confirmInvalidTitle")}><Refused message={t("confirmInvalidDescription")} /></Card>;
  switch (request.action) {
    case "public": return <PublicPanel request={request} />;
    case "member": return <MemberPanel request={request} />;
    case "grant": return <GrantPanel request={request} />;
    case "link-sharing": return <LinkSharingPanel request={request} />;
  }
}

function PublicPanel({ request }: Of<"public">) {
  const space = useQuery(spaceQueryOptions(request.spaceId));
  const update = useUpdateSpace(request.spaceId);
  return <Panel request={request} reads={[space]} names={{ repository: repositoryName(space.data) }}
    before={space.data?.publicRead ? "public" : null} write={update} onConfirm={() => update.mutate({ publicRead: true })} />;
}

function MemberPanel({ request }: Of<"member">) {
  const space = useQuery(spaceQueryOptions(request.spaceId));
  const members = useQuery(teamMembersQueryOptions(request.spaceId));
  const member = members.data?.members.find(({ user }) => user.id === request.userId);
  const user = useNamedUser(request.userId, member?.user, members.isSuccess);
  const setRole = useSetMemberRole();
  return <Panel request={request} reads={[space, members, user]} names={{ repository: repositoryName(space.data), user: user.name }}
    before={member?.role ?? null} write={setRole} onConfirm={() => setRole.mutate(request)} />;
}

function GrantPanel({ request }: Of<"grant">) {
  const node = useQuery(nodeQueryOptions(request.nodeId));
  const grants = useQuery(nodeGrantsQueryOptions(request.nodeId));
  const grant = grants.data?.grants.find(({ user }) => user.id === request.userId);
  const user = useNamedUser(request.userId, grant?.user, grants.isSuccess);
  const setGrant = useSetNodeGrant();
  return <Panel request={request} reads={[node, grants, user]} names={{ ...fileName(node.data), user: user.name }}
    before={grant?.role ?? null} write={setGrant} onConfirm={() => setGrant.mutate(request)} />;
}

function LinkSharingPanel({ request }: Of<"link-sharing">) {
  const node = useQuery(nodeQueryOptions(request.nodeId));
  const sharing = useQuery(nodeLinkSharingQueryOptions(request.nodeId));
  const setSharing = useSetLinkSharing();
  return <Panel request={request} reads={[node, sharing]} names={fileName(node.data)}
    before={sharing.data?.enabled ? sharing.data.role : null} write={setSharing}
    onConfirm={() => setSharing.mutate({ nodeId: request.nodeId, enabled: true, role: request.role })} />;
}

const repositoryName = (space: components["schemas"]["SpaceView"] | undefined) => space?.fullName ?? space?.name;
const fileName = (data: components["schemas"]["NodeResponse"] | undefined): ConfirmNames =>
  data ? { file: data.node.name, folder: data.node.resource === null } : {};

function useNamedUser(userId: string, listedUser: PublicUser | undefined, listLoaded: boolean): Read & { readonly name: string | undefined } {
  const { t } = useI18n();
  const search = useQuery({ ...userSearchQueryOptions(userId), enabled: listLoaded && !listedUser });
  const user = listedUser ?? search.data?.users.find(({ id }) => id === userId);
  return {
    name: user && `${user.displayName} (@${user.username})`,
    isPending: !listedUser && search.isPending,
    error: search.error ?? (search.isSuccess && !user ? new Error(t("confirmUserUnknown")) : null),
  };
}

function Panel({ request, reads, names, before, write, onConfirm }: {
  readonly request: ConfirmRequest;
  readonly reads: readonly Read[];
  readonly names: ConfirmNames;
  readonly before: ConfirmLevel;
  readonly write: { readonly isPending: boolean; readonly isSuccess: boolean; readonly error: Error | null };
  readonly onConfirm: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const failed = reads.find((read) => read.error)?.error;
  if (failed) return <Card title={t("confirmUnavailableTitle")}><Refused message={failed.message} /></Card>;
  if (reads.some((read) => read.isPending)) return <Loading />;
  const { title, consequence } = confirmText(request, names, t);
  const open = () => void navigate("spaceId" in request
    ? { to: "/spaces/$spaceId", params: { spaceId: request.spaceId } }
    : { to: "/nodes/$nodeId", params: { nodeId: request.nodeId } });
  return (
    <Card title={title} done={write.isSuccess}>
      <p className="m-0 text-sm text-muted-foreground">{consequence}</p>
      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border p-4 text-sm">
        <div>
          <dt className="text-muted-foreground">{t("confirmNow")}</dt>
          <dd className="font-medium">{confirmLevelLabel(request.action, write.isSuccess ? after(request) : before, t)}</dd>
        </div>
        {write.isSuccess ? null : (
          <div>
            <dt className="text-muted-foreground">{t("confirmAfter")}</dt>
            <dd className="font-medium">{confirmLevelLabel(request.action, after(request), t)}</dd>
          </div>
        )}
      </dl>
      {write.error ? <Alert variant="destructive">{write.error.message}</Alert> : null}
      {write.isSuccess ? (
        <>
          <Alert variant="success">{t("confirmDone")}</Alert>
          <Button className="w-full" size="lg" onClick={open}>{t("confirmOpen")}</Button>
        </>
      ) : (
        <>
          <Button className="w-full" size="lg" disabled={write.isPending} onClick={onConfirm}>{t("confirmAction")}</Button>
          <Button className="w-full" size="lg" variant="secondary" onClick={open}>{t("confirmGiveUp")}</Button>
        </>
      )}
    </Card>
  );
}

const after = (request: ConfirmRequest): ConfirmLevel => (request.action === "public" ? "public" : request.role);

function Refused({ message }: { readonly message: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <>
      <Alert variant="destructive">{message}</Alert>
      <Button className="w-full" size="lg" variant="secondary" onClick={() => void navigate({ to: "/home" })}>{t("backToHome")}</Button>
    </>
  );
}

function Loading() {
  const { t } = useI18n();
  return (
    <main className="auth-backdrop grid min-h-dvh place-items-center">
      <Spinner aria-label={t("confirmLoading")} />
    </main>
  );
}

function Card({ title, done = false, children }: { readonly title: string; readonly done?: boolean; readonly children: ReactNode }) {
  return (
    <main className="auth-backdrop grid min-h-dvh place-items-center px-5 py-8">
      <div className="w-[min(440px,100%)] rounded-2xl border border-border bg-background p-8 shadow-lg max-[480px]:border-0 max-[480px]:bg-transparent max-[480px]:p-4 max-[480px]:shadow-none">
        <div className="mb-5 flex flex-col items-start gap-3.5">
          <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
            {done ? <ShieldCheck aria-hidden="true" /> : <ShieldQuestion aria-hidden="true" />}
          </span>
          <h1 className="m-0 text-xl font-bold tracking-tight break-words">{title}</h1>
        </div>
        <div className="grid gap-5">{children}</div>
      </div>
    </main>
  );
}
