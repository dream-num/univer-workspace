import React, { useEffect, useState } from 'react';
import type { Face } from '../client.js';
import type { Content } from '../model.js';
import type { Proposal } from '../editing.js';
import { Viewer } from '../viewer.js';
import { button, iconButton, Icon } from './primitives.js';

/** Review remains in the current document. The Server returns the saved shared
 * side and exact merge candidate together with its version-bound review token. */
export function AIChanges({
  face,
  file,
  sessionId,
}: {
  face: Face;
  file: Content;
  sessionId: string | null;
}) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [review, setReview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const p = await face.editingStatus(sessionId, file.nodeId);
        if (!stopped) setProposal(p);
      } catch (cause) {
        if (!stopped)
          setError(cause instanceof Error ? cause.message : '无法检查 AI 修改');
      }
    };
    void poll();
    const timer = setInterval(poll, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [face, file.nodeId, sessionId]);
  async function action(action: string) {
    if (!proposal || !sessionId || busy) return;
    setBusy(true);
    setError('');
    try {
      const value = await face.editingAction({
        action,
        sessionId,
        nodeId: file.nodeId,
        proposalId: proposal.id,
        reviewToken: review?.reviewToken,
      });
      if (action === 'review') {
        const unit = value.comparisons?.find(
          (entry: any) =>
            entry.unitId === file.unitId &&
            entry.resourceId === file.resourceId,
        );
        if (!unit || value.comparisons.length !== 1)
          throw new Error('变更范围与当前文档不一致。');
        setLoaded({});
        setReview({ ...unit.comparison, reviewToken: value.reviewToken });
      } else {
        setProposal(value);
        setReview(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法完成操作');
      if (action === 'apply') {
        setReview(null);
        setProposal(
          await face
            .editingStatus(sessionId!, file.nodeId)
            .catch(() => proposal),
        );
      }
    } finally {
      setBusy(false);
    }
  }
  if (!proposal && !error) return null;
  const phase = proposal?.phase;
  const label =
    phase &&
    {
      editing: 'Editing with AI',
      applying: 'Applying…',
      ready: 'Changes ready',
      canceling: 'Canceling…',
      canceled: 'Canceled',
      rejected: 'Rejected',
      applied: 'Applied',
      conflict: 'Conflict — Review again',
      failed: 'Editing failed',
    }[phase];
  return (
    <>
      <div className="sp-ai-changes" data-ai-phase={phase} aria-live="polite">
        <span>{label}</span>
        {phase === 'editing' && (
          <span className="tw-text-muted">共享内容尚未更改</span>
        )}
        {(phase === 'ready' || phase === 'conflict') && (
          <>
            <button
              className={button}
              disabled={busy}
              onClick={() => action('review')}
            >
              Review changes
            </button>
            <button
              className={button}
              disabled={busy}
              onClick={() => action('reject')}
            >
              Reject
            </button>
          </>
        )}
        {phase === 'editing' && (
          <button
            className={button}
            disabled={busy}
            onClick={() => action('cancel')}
          >
            Cancel AI changes
          </button>
        )}
        {error && <span role="alert">{error}</span>}
        {proposal?.message && phase === 'failed' && (
          <span role="alert">{proposal.message}</span>
        )}
      </div>
      {review && (
        <section
          className="sp-ai-review sp-univer-scope"
          role="region"
          aria-label="Review AI changes"
        >
          <header>
            <strong>Review changes</strong>
            <span>{review.result?.summary?.total ?? 0} 处变更</span>
            <span className="tw-text-muted">检查本次修改后应用到共享文档</span>
            <div className="tw-ml-auto tw-flex tw-gap-2">
              <button
                className={button}
                disabled={busy}
                onClick={() => action('reject')}
              >
                Reject changes
              </button>
              <button
                className={button + ' sp-ai-apply'}
                disabled={busy || !loaded.left || !loaded.right}
                onClick={() => action('apply')}
              >
                {busy ? 'Applying…' : 'Apply changes'}
              </button>
              <button
                className={iconButton}
                aria-label="Close review"
                disabled={busy}
                onClick={() => setReview(null)}
              >
                <Icon name="close" />
              </button>
            </div>
          </header>
          <div className="sp-ai-review-sides">
            {(['left', 'right'] as const).map((side) => (
              <div className="sp-ai-review-side" key={side}>
                <div className="sp-ai-review-label">
                  {side === 'left'
                    ? 'Shared content · At review'
                    : 'Proposed changes · Pending approval'}
                </div>
                {review[side]?.unitData ? (
                  <ReviewSide
                    file={{
                      ...file,
                      sha256: review.reviewToken + side,
                      data: review[side].unitData,
                    }}
                    onReady={() =>
                      setLoaded((value) => ({ ...value, [side]: true }))
                    }
                  />
                ) : (
                  <p>此版本没有内容</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
function ReviewSide({ file, onReady }: { file: Content; onReady(): void }) {
  useEffect(() => {
    const element = document.querySelector(
      `[data-review-side="${file.sha256}"]`,
    );
    if (!element) return;
    const check = () => {
      if (element.querySelector('[data-viewer-state="ready"]')) onReady();
    };
    const observer = new MutationObserver(check);
    observer.observe(element, { attributes: true, subtree: true });
    check();
    return () => observer.disconnect();
  }, [file.sha256]);
  return (
    <div className="sp-ai-review-content" data-review-side={file.sha256}>
      <Viewer file={file} />
    </div>
  );
}
