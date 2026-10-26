import React, { useEffect, useReducer } from 'react';
import { ComponentManager } from '@univerjs/ui';
import {
  CustomDecorationType,
  DocumentDataModel,
  ICommandService,
  type Injector,
  UniverInstanceType,
  IUniverInstanceService,
} from '@univerjs/core';
import { RichTextEditingMutation } from '@univerjs/docs';
import {
  IThreadCommentDataSourceService,
  ResolveCommentCommand,
  ThreadCommentModel,
} from '@univerjs/thread-comment';
import {
  ThreadCommentTree,
  ThreadCommentTreeLocation,
} from '@univerjs/thread-comment-ui';

/** SDK 1.1.0's Docs panel filters its list to extant decorations. Remote
 * bodies outlive text removal. Extend the formal panel through its public
 * component override and hydrate missing roots through its existing datasource.
 * No parallel storage, author identity, anchor transformation or comment writes.
 */
export function installDocCommentRetention(injector: Injector, unitId: string) {
  const registry = injector.get(ComponentManager),
    model = injector.get(ThreadCommentModel);
  const source = injector.get(IThreadCommentDataSourceService),
    commands = injector.get(ICommandService);
  const instances = injector.get(IUniverInstanceService);
  const panelKey = 'univer.doc.thread-comment-panel';
  const Original = registry.get(panelKey);
  let active = true;
  let pending: Promise<void> | undefined;
  const refresh = () =>
    (pending ??= (async () => {
      // An empty filter is the existing Comment endpoint's Unit-wide list.
      const roots = await source.listThreadComments(unitId, 'default_doc', []);
      if (!active || !roots) return;
      for (const root of roots)
        if (!model.getRootComment(unitId, 'default_doc', root.threadId)) {
          model.addComment(unitId, 'default_doc', { ...root, ref: '' });
        }
      if (roots.length)
        await model.syncThreadComments(
          unitId,
          'default_doc',
          roots.map((root) => root.threadId),
        );
    })().finally(() => {
      pending = undefined;
    }));
  function RetainedDocComments() {
    const [, rerender] = useReducer((value: number) => value + 1, 0);
    useEffect(() => {
      const a = model.commentUpdate$.subscribe(() => rerender());
      const b = commands.onCommandExecuted((command) => {
        if (command.id === RichTextEditingMutation.id) rerender();
      });
      return () => {
        a.unsubscribe();
        b.dispose();
      };
    }, []);
    const document = instances.getUnit<DocumentDataModel>(unitId);
    const body = document?.getBody();
    const anchors = new Set(
      (document?.getCustomDecorations() ?? [])
        .filter(
          (range) =>
            range.type === CustomDecorationType.COMMENT &&
            !!body?.dataStream
              .slice(range.startIndex, range.endIndex + 1)
              .replace(/[\r\n\x00-\x1f]/g, '')
              .trim(),
        )
        .map((range) => range.id),
    );
    const orphaned = model
      .getUnit(unitId)
      .filter(
        (thread) =>
          thread.subUnitId === 'default_doc' && !anchors.has(thread.root.id),
      );
    return (
      <div className="sp-retained-comments">
        {orphaned.length > 0 && (
          <section
            aria-label="Original text unavailable"
            className="sp-orphan-comments"
          >
            <h3>Original text unavailable</h3>
            <p>
              The discussion is preserved. Its original text is no longer
              available.
            </p>
            {orphaned.map((thread) => (
              <ThreadCommentTree
                key={thread.threadId}
                id={thread.root.id}
                unitId={unitId}
                subUnitId={thread.subUnitId}
                type={UniverInstanceType.UNIVER_DOC}
                location={ThreadCommentTreeLocation.PANEL}
                full
                displayRef="Original text unavailable"
                getSubUnitName={() => ''}
                onResolve={(resolved) => {
                  void commands.executeCommand(ResolveCommentCommand.id, {
                    unitId,
                    subUnitId: thread.subUnitId,
                    commentId: thread.root.id,
                    resolved,
                  });
                }}
              />
            ))}
          </section>
        )}
        <Original />
      </div>
    );
  }
  const registration = registry.register(panelKey, RetainedDocComments, {
    override: true,
  });
  return {
    refresh,
    dispose() {
      active = false;
      registration.dispose();
    },
  };
}
