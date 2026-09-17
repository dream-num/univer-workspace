import { expect, it, vi } from 'vitest';
import { disposeViewerResources } from '../src/client/viewer/dispose.ts';

it('closes the remaining resources when an SDK cleanup throws, without crashing the DSH slot', () => {
  const report = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const events: string[] = [];
    const error = new Error('already disposed');
    expect(() => disposeViewerResources(
      () => { events.push('subscription'); throw error; },
      () => { events.push('facade'); throw error; },
      () => { events.push('runtime'); },
    )).not.toThrow();
    expect(events).toEqual(['subscription', 'facade', 'runtime']);
    expect(report).toHaveBeenCalledTimes(2);
  } finally { report.mockRestore(); }
});
