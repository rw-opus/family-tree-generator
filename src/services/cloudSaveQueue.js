const defaultSetTimer = (callback, delay) => globalThis.setTimeout(callback, delay);
const defaultClearTimer = (timer) => globalThis.clearTimeout(timer);

/**
 * Serialises cloud writes so an older, slower request can never overwrite a
 * newer tree snapshot. The latest scheduled snapshot remains flushable before
 * navigation, and failed saves remain dirty for a later retry.
 */
export function createCloudSaveQueue(
  save,
  {
    delay = 900,
    setTimer = defaultSetTimer,
    clearTimer = defaultClearTimer,
    onStateChange = () => {},
    onSaveStart = () => {},
    onSaveSuccess = () => {},
    onSaveError = () => {},
  } = {},
) {
  let timer = null;
  let latestSnapshot;
  let revision = 0;
  let savedRevision = 0;
  let enqueuedRevision = 0;
  let pendingCount = 0;
  let tail = Promise.resolve();
  let disposed = false;

  const state = () => ({
    dirty: revision > savedRevision,
    pending: pendingCount > 0,
    revision,
    savedRevision,
  });
  const notify = () => {
    if (!disposed) onStateChange(state());
  };
  const clearScheduledTimer = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  const flush = () => {
    clearScheduledTimer();
    if (disposed || revision <= Math.max(savedRevision, enqueuedRevision)) return tail;

    const snapshot = latestSnapshot;
    const saveRevision = revision;
    enqueuedRevision = saveRevision;
    pendingCount += 1;
    notify();
    onSaveStart(snapshot);

    const operation = tail
      .catch(() => undefined)
      .then(() => save(snapshot))
      .then((result) => {
        savedRevision = Math.max(savedRevision, saveRevision);
        if (!disposed) onSaveSuccess(result, snapshot);
        return result;
      })
      .catch((error) => {
        if (enqueuedRevision === saveRevision) enqueuedRevision = savedRevision;
        if (!disposed) onSaveError(error, snapshot);
        throw error;
      })
      .finally(() => {
        pendingCount = Math.max(0, pendingCount - 1);
        notify();
      });
    tail = operation;
    return operation;
  };

  const schedule = (snapshot) => {
    if (disposed) return revision;
    latestSnapshot = snapshot;
    revision += 1;
    clearScheduledTimer();
    timer = setTimer(() => {
      timer = null;
      flush().catch(() => undefined);
    }, delay);
    notify();
    return revision;
  };

  const dispose = () => {
    disposed = true;
    clearScheduledTimer();
  };

  return {
    schedule,
    flush,
    dispose,
    getState: state,
    hasUnsavedChanges: () => {
      const current = state();
      return current.dirty || current.pending;
    },
  };
}
