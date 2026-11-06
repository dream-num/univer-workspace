import { useState, type FormEvent } from "react";
import type { components } from "../../../../generated/http/schema.js";
import { useUpdateNode } from "./nodes.commands";
import { useI18n } from "../../shared/i18n";
import { Button, Dialog, DialogClose, Field, Input, toast } from "../../shared/ui";

type Node = components["schemas"]["NodePage"]["nodes"][number];

export function useNodeEditDialog() {
  const [editNode, setEditNode] = useState<Node | null>(null);
  const [editName, setEditName] = useState("");
  const [editParentNodeId, setEditParentNodeId] = useState("");
  const { t } = useI18n();
  const updateNode = useUpdateNode();

  const submitEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editName.trim()) return;
    if (!editNode) {
      toast.error("No node is selected.");
      return;
    }
    updateNode.mutate(
      {
        nodeId: editNode.id,
        body: {
          ...(editNode.capabilities.rename ? { name: editName.trim() } : {}),
          ...(editNode.capabilities.move ? { parentNodeId: editParentNodeId.trim() || null } : {}),
        },
      },
      {
        onSuccess: () => {
          setEditNode(null);
          toast.success(t("itemUpdated"));
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : t("updateFailed")),
      },
    );
  };

  return {
    onEdit: (node: Node) => {
      setEditName(node.name);
      setEditParentNodeId("");
      setEditNode(node);
    },
    dialog: (
      <NodeEditDialog
        {...{
          editNode,
          setEditNode,
          editName,
          setEditName,
          editParentNodeId,
          setEditParentNodeId,
          submitEdit,
        }}
        pending={updateNode.isPending}
      />
    ),
  };
}

export function NodeEditDialog({
  editNode,
  setEditNode,
  editName,
  setEditName,
  editParentNodeId,
  setEditParentNodeId,
  submitEdit,
  pending,
}: {
  readonly editNode: Node | null;
  readonly setEditNode: (node: Node | null) => void;
  readonly editName: string;
  readonly setEditName: (name: string) => void;
  readonly editParentNodeId: string;
  readonly setEditParentNodeId: (id: string) => void;
  readonly submitEdit: (event: FormEvent) => void;
  readonly pending: boolean;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={Boolean(editNode)}
      onOpenChange={(next) => {
        if (!next) setEditNode(null);
      }}
      title={editNode ? t("editNodeTitle", { name: editNode.name }) : t("editNodeFallback")}
      footer={
        <>
          <DialogClose render={<Button variant="secondary">{t("cancel")}</Button>} />
          <Button onClick={submitEdit} disabled={pending}>
            {t("save")}
          </Button>
        </>
      }
    >
      <form onSubmit={submitEdit} className="grid gap-4">
        {editNode?.capabilities.rename ? (
          <Field label={t("name")} htmlFor="edit-node-name" required>
            <Input
              id="edit-node-name"
              maxLength={255}
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
            />
          </Field>
        ) : null}
        {editNode?.capabilities.move ? (
          <Field
            label={t("destinationParentNodeId")}
            htmlFor="edit-node-parent"
            hint={t("destinationParentNodeHint")}
          >
            <Input
              id="edit-node-parent"
              value={editParentNodeId}
              onChange={(event) => setEditParentNodeId(event.target.value)}
            />
          </Field>
        ) : null}
      </form>
    </Dialog>
  );
}
