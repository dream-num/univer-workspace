import { BrowserCollaborationSocketService } from '@univerjs-pro/collaboration-client-ui';
import { ISnapshotServerService } from '@univerjs-pro/collaboration';
import { Inject, Injector, IConfigService, ILogService } from '@univerjs/core';
import { HTTPService } from '@univerjs/network';

/** The configured Workspace socket is absolute and must not depend on the
 * Desktop document's custom-scheme origin. Uses the SDK's public protected URL
 * seam; its ticket acquisition, WS, protocol, reconnect and queues stay intact. */
export class WorkspaceCollaborationSocketService extends BrowserCollaborationSocketService {
  protected override _createSocketURL(raw: string, ticket: string): string {
    const url = new URL(raw);
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash)
      throw new Error('Invalid Workspace collaboration URL.');
    url.searchParams.set('sessionTicket', ticket);
    return url.href;
  }
}
// Public Redi parameter decorators, without enabling application-wide legacy
// decorator compilation. Keep the exact five dependencies of the SDK base.
[Injector, HTTPService, IConfigService, ILogService, ISnapshotServerService].forEach(
  (dependency, index) => Inject(dependency)(WorkspaceCollaborationSocketService, undefined, index),
);
