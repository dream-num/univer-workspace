import { ThreadCommentPanelService } from "@univerjs/thread-comment-ui";
import { StartAddCommentOperation } from "@univerjs/docs-thread-comment-ui";
import { IMenuManagerService, ICanvasPopupService } from "@univerjs/ui";
import { CreateDocTextRangeCommentCommand } from "@univerjs/docs-thread-comment";
import {
  DependentOn,
  ICommandService,
  Inject,
  Injector,
  Plugin,
  LocaleService,
  LocaleType,
  UserManagerService,
} from "@univerjs/core";
import {
  AddCommentCommand,
  DeleteCommentCommand,
  DeleteCommentTreeCommand,
  IThreadCommentDataSourceService,
  ResolveCommentCommand,
  UpdateCommentCommand,
  UniverThreadCommentPlugin,
  isThreadCommentDocumentBody,
  normalizeThreadCommentContent,
  type IBaseComment,
  type IThreadCommentDataSource,
} from "@univerjs/thread-comment";
import { CommentSolvedStatus, type IListCommentsResponse, type IReply } from "@univerjs/protocol";

export const COMMENT_WRITE_COMMANDS = new Set([
  CreateDocTextRangeCommentCommand.id,
  AddCommentCommand.id,
  UpdateCommentCommand.id,
  ResolveCommentCommand.id,
  DeleteCommentCommand.id,
  DeleteCommentTreeCommand.id,
]);

function body(content: string) {
  let value;
  try {
    const parsed: unknown = JSON.parse(content);
    if (isThreadCommentDocumentBody(parsed)) value = parsed;
  } catch {
    /* Legacy plain-text comments. */
  }
  value ??= normalizeThreadCommentContent(content);
  if (value.paragraphs?.length) return value;
  // The SDK accepts minimal bodies but its comment view renders paragraphs only.
  // Supply paragraph boundaries in the read cache, never in persisted Comment data.
  const dataStream = value.dataStream.endsWith("\r\n")
    ? value.dataStream
    : `${value.dataStream}\r\n`;
  return {
    ...value,
    dataStream,
    paragraphs: [...dataStream.matchAll(/\r/g)].map((match) => ({
      startIndex: match.index,
      paragraphId: `readonly-${match.index}`,
    })),
  };
}

/** A body read never changes the draft's persisted anchor or writes to Comment. */
export function createReadonlyCommentDataSource(
  load: (unitId: string, threadIds: string[]) => Promise<IListCommentsResponse>,
): IThreadCommentDataSource {
  const reject = async (): Promise<never> => {
    throw new Error("Worktree comments are read-only.");
  };
  return {
    addComment: reject,
    updateComment: reject,
    resolveComment: reject,
    deleteComment: reject,
    deleteThread: reject,
    async listComments(unitId, subUnitId, threadIds) {
      if (!threadIds.length) return [];
      const response = await load(unitId, threadIds);
      if (response.error && response.error.code !== 1)
        throw new Error(response.error.message || "Unable to read comments.");
      return threadIds.flatMap((threadId) => {
        const thread = response.comments?.[threadId];
        const root =
          thread?.replies.find((reply) => reply.replyId === threadId) ?? thread?.replies[0];
        if (!thread || !root) return [];
        const convert = (reply: IReply): IBaseComment => ({
          id: reply.replyId,
          threadId,
          unitId,
          subUnitId,
          text: body(reply.content),
          personId: reply.userId,
          dT: new Date(Number(reply.createTimestamp)).toLocaleString(),
          ...(reply === root ? {} : { parentId: threadId }),
        });
        return [
          {
            ...convert(root),
            id: threadId,
            resolved: thread.solved === CommentSolvedStatus.Solved,
            children: thread.replies.filter((reply) => reply !== root).map(convert),
          },
        ];
      });
    },
    // Keep only anchor identity in snapshots, never hydrated bodies or solved state.
    saveCommentToSnapshot: ({ id, threadId, ref, authorName, personId }) => ({
      id,
      threadId,
      ref,
      ...(authorName === undefined ? {} : { authorName, personId }),
    }),
  };
}

export interface ReadonlyCommentOptions {
  readonly endpoint: string;
  readonly container: HTMLElement;
  readonly panelCommandId?: string;
}

/** Owns read-only body integration for this runtime; no remote writer is installed. */
export class ReadonlyCommentPlugin extends Plugin {
  static override pluginName = "WORKSPACE_READONLY_COMMENT_PLUGIN";
  constructor(
    private readonly options: ReadonlyCommentOptions,
    protected readonly _injector: Injector,
  ) {
    super();
  }
  override onStarting(): void {
    const abort = new AbortController();
    this.disposeWithMe(() => abort.abort());
    const service = this._injector.get(IThreadCommentDataSourceService);
    service.dataSource = createReadonlyCommentDataSource(async (unitId, threadIds) => {
      const response = await fetch(
        `${this.options.endpoint}/unit/${encodeURIComponent(unitId)}/list`,
        {
          signal: abort.signal,
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unitId, threadId: threadIds }),
        },
      );
      if (!response.ok) throw new Error(`Unable to read comments (${response.status}).`);
      const result = (await response.json()) as IListCommentsResponse;
      for (const user of Object.values(result.users ?? {}))
        this._injector.get(UserManagerService).addUser(user);
      return result;
    });
    service.syncUpdateMutationToColla = false;
    this.disposeWithMe(
      this._injector.get(ICommandService).beforeCommandExecuted((command) => {
        if (COMMENT_WRITE_COMMANDS.has(command.id))
          throw new Error("Worktree comments are read-only.");
      }),
    );
    // SDK canvas popups default to a body portal. Keep this runtime's popups in
    // its UI tree so scoped read-only presentation also covers floating toolbars.
    // Remove when the SDK supports an editor-owned portal container.
    if (this._injector.has(ICanvasPopupService)) {
      const popups = this._injector.get(ICanvasPopupService);
      const original = popups.addPopup;
      const scoped = (popup: Parameters<typeof original>[0]) =>
        original.call(popups, { ...popup, portal: false });
      popups.addPopup = scoped;
      this.disposeWithMe(() => {
        if (popups.addPopup === scoped) popups.addPopup = original;
      });
    }
    this.options.container.setAttribute("data-workspace-readonly-comments", "true");
    this.disposeWithMe(() =>
      this.options.container.removeAttribute("data-workspace-readonly-comments"),
    );
  }
  override onRendered(): void {
    // The Doc text-selection menu has its own portal and uses the public menu
    // registry. Hide only its authoring operation; panel navigation stays enabled.
    if (this._injector.has(IMenuManagerService)) {
      this._injector
        .get(IMenuManagerService)
        .updateMenuConfig({ [StartAddCommentOperation.id]: { hidden: true } });
    }
    // Comparison hosts hide the SDK ribbon. Keep comments readable through the
    // standard panel even when the native authoring toolbar is absent.
    if (this.options.panelCommandId) {
      const container = this.options.container;
      const originalPosition = container.style.position;
      if (getComputedStyle(container).position === "static") {
        container.style.position = "relative";
        this.disposeWithMe(() => {
          container.style.position = originalPosition;
        });
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "workspace-readonly-comment-open";
      button.textContent =
        this._injector.get(LocaleService).getCurrentLocale() === LocaleType.ZH_CN
          ? "查看评论（只读）"
          : "View comments (read-only)";
      const open = () => {
        void this._injector.get(ICommandService).executeCommand(this.options.panelCommandId!);
      };
      button.addEventListener("click", open);
      this.options.container.append(button);
      const panel = this._injector.get(ThreadCommentPanelService);
      this.disposeWithMe(
        panel.panelVisible$.subscribe((visible) => {
          button.hidden = visible;
        }),
      );
      this.disposeWithMe(() => {
        button.removeEventListener("click", open);
        button.remove();
      });
    }
    // Mobile toolbars and the panel add button have no aria-label. Mark only
    // comment authoring buttons inside this editor, including lazy panel mounts.
    const authoringButtons = new Set<Element>();
    const markAuthoringButtons = () => {
      for (const button of this.options.container.querySelectorAll("button")) {
        const text = button.textContent?.trim() ?? "";
        const label = button.getAttribute("aria-label") ?? text;
        // Pro thumbnail/record counters use the addComment label for opening an
        // existing thread. Preserve numeric counters as read-only entry points.
        if (
          !["添加评论", "Add comment", "Insert comment", "评论管理", "Comments"].includes(label) ||
          /^\d+$/.test(text)
        )
          continue;
        button.setAttribute("data-workspace-readonly-comment-write", "true");
        authoringButtons.add(button);
      }
    };
    const containerObserver = new MutationObserver(markAuthoringButtons);
    containerObserver.observe(this.options.container, { childList: true, subtree: true });
    markAuthoringButtons();
    this.disposeWithMe(() => {
      containerObserver.disconnect();
      for (const button of authoringButtons)
        button.removeAttribute("data-workspace-readonly-comment-write");
    });
  }
}

Inject(Injector)(ReadonlyCommentPlugin, undefined, 1);
DependentOn(UniverThreadCommentPlugin)(ReadonlyCommentPlugin);
