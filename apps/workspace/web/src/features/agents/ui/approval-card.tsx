import { Button } from "../../../shared/ui/button";
import type { PendingApproval } from "../approvals";
import { useAgentMessages } from "./messages";

export function ApprovalCard({ approval, disabled, onDecide }: {
  readonly approval: PendingApproval;
  readonly disabled: boolean;
  readonly onDecide: (approved: boolean) => void;
}) {
  const m = useAgentMessages();
  return <section className="agent-approval" aria-label={m.publishAction}>
    <h2>{m.publishAction}</h2><strong>{approval.toolName}</strong>
    <p className="agent-note">{m.publishNotice}</p>
    <pre>{JSON.stringify(approval.action.input, null, 2)}</pre>
    <div className="agent-approval-actions">
      <Button disabled={disabled} onClick={() => onDecide(true)}>{m.publish}</Button>
      <Button variant="secondary" disabled={disabled} onClick={() => onDecide(false)}>{m.reject}</Button>
    </div>
  </section>;
}
