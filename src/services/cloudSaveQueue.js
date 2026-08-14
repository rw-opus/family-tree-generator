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
    snapshotKey = (snapshot) => snapshot?.id || "default",
    snapshotFingerprint = () => undefined,
    rebaseSnapshot = (snapshot) => snapshot,
    isConflictError = (error) => error?.code === "TREE_SAVE_CONFLICT",
  } = {},
) {
  let timer = null;
  let latestSnapshot;
  let latestFingerprint;
  let revision = 0;
  let savedRevision = 0;
  let enqueuedRevision = 0;
  let pendingCount = 0;
  let tail = Promise.resolve();
  let disposed = false;
  let lastError = null;
  let conflictError = null;
  let contextEpoch = 0;
  const savedBases = new Map();

  const state = () => {
    const dirty = revision > savedRevision;
    const pending = pendingCount > 0;
    return {
      dirty,
      pending,
      revision,
      savedRevision,
      error: lastError,
      conflict: Boolean(conflictError),
      phase: conflictError
        ? "conflict"
        : lastError
          ? "error"
          : dirty || pending
            ? "saving"
            : "saved",
    };
  };
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
    if (conflictError) return Promise.reject(conflictError);
    if (disposed || revision <= Math.max(savedRevision, enqueuedRevision)) return tail;

    const snapshot = latestSnapshot;
    const key = snapshotKey(snapshot);
    const operationEpoch = contextEpoch;
    const saveRevision = revision;
    enqueuedRevision = saveRevision;
    pendingCount += 1;
    lastError = null;
    notify();
    onSaveStart(snapshot);

    const operation = tail
      .catch(() => undefined)
      .then(() => {
        if (conflictError) throw conflictError;
        const savedBase = savedBases.get(key);
        return save(savedBase ? rebaseSnapshot(snapshot, savedBase) : snapshot);
      })
      .then((result) => {
        if (operationEpoch !== contextEpoch) return result;
        savedRevision = Math.max(savedRevision, saveRevision);
        lastError = null;
        savedBases.set(key, result);
        if (!disposed) onSaveSuccess(result, snapshot);
        return result;
      })
      .catch((error) => {
        if (operationEpoch !== contextEpoch) throw error;
        if (enqueuedRevision === saveRevision) enqueuedRevision = savedRevision;
        lastError = error;
        if (isConflictError(error)) conflictError = error;
        if (!disposed) onSaveError(error, snapshot);
        throw error;
      })
      .finally(() => {
        if (operationEpoch !== contextEpoch) return;
        pendingCount = Math.max(0, pendingCount - 1);
        notify();
      });
    tail = operation;
    return operation;
  };

  const schedule = (snapshot) => {
    if (disposed) return revision;
    const fingerprint = snapshotFingerprint(snapshot);
    if (
      latestSnapshot !== undefined &&
      fingerprint !== undefined &&
      fingerprint === latestFingerprint
    ) {
      // A save response may update only its server revision. Retain that fresh
      // metadata without treating it as another user edit or writing forever.
      latestSnapshot = snapshot;
      return revision;
    }
    latestSnapshot = snapshot;
    latestFingerprint = fingerprint;
    revision += 1;
    if (!conflictError) lastError = null;
    clearScheduledTimer();
    timer = setTimer(() => {
      timer = null;
      flush().catch(() => undefined);
    }, delay);
    notify();
    return revision;
  };

  const acknowledge = (snapshot, savedResult = snapshot) => {
    if (disposed) return revision;
    // Moving to another stored tree abandons the old tree's local queue
    // context. An already-running request cannot be cancelled, but its late
    // success or conflict must not alter or block the newly active tree.
    contextEpoch += 1;
    clearScheduledTimer();
    latestSnapshot = snapshot;
    latestFingerprint = snapshotFingerprint(snapshot);
    revision += 1;
    savedRevision = revision;
    enqueuedRevision = revision;
    lastError = null;
    conflictError = null;
    pendingCount = 0;
    savedBases.set(snapshotKey(snapshot), savedResult);
    tail = Promise.resolve(savedResult);
    notify();
    return revision;
  };

  const dispose = () => {
    disposed = true;
    contextEpoch += 1;
    clearScheduledTimer();
  };

  return {
    schedule,
    acknowledge,
    flush,
    dispose,
    getState: state,
    hasUnsavedChanges: () => {
      const current = state();
      return current.dirty || current.pending;
    },
  };
}
