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
  let activeOperation = null;
  let activeRevision = 0;
  let queuedFlush = null;
  let tail = Promise.resolve();
  let disposed = false;
  let lastError = null;
  let conflictError = null;
  let contextEpoch = 0;
  const savedBases = new Map();

  const state = () => {
    const dirty = revision > savedRevision;
    const pending = Boolean(activeOperation || queuedFlush);
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

  const createDeferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  };

  const startLatestSave = () => {
    clearScheduledTimer();
    if (conflictError) return Promise.reject(conflictError);
    if (disposed || revision <= savedRevision) return tail;

    const snapshot = latestSnapshot;
    const key = snapshotKey(snapshot);
    const operationEpoch = contextEpoch;
    const saveRevision = revision;
    activeRevision = saveRevision;
    lastError = null;
    let submittedSnapshot = snapshot;
    let startError = null;
    try {
      const savedBase = savedBases.get(key);
      submittedSnapshot = savedBase ? rebaseSnapshot(snapshot, savedBase) : snapshot;
      // Record lineage synchronously with the transition to an active request.
      // A same-tick edit must not be able to replace the journal target before
      // this exact snapshot is known to be capable of reaching the server.
      onSaveStart(submittedSnapshot);
    } catch (error) {
      startError = error;
    }
    let settledResult;
    let settledError;
    let operation;
    operation = Promise.resolve()
      .then(() => {
        if (startError) throw startError;
        if (conflictError) throw conflictError;
        return save(submittedSnapshot);
      })
      .then((result) => {
        settledResult = result;
        if (operationEpoch !== contextEpoch) return result;
        savedRevision = Math.max(savedRevision, saveRevision);
        lastError = null;
        savedBases.set(key, result);
        if (!disposed) onSaveSuccess(result, submittedSnapshot);
        return result;
      })
      .catch((error) => {
        settledError = error;
        if (operationEpoch !== contextEpoch) throw error;
        lastError = error;
        if (isConflictError(error)) conflictError = error;
        if (!disposed) onSaveError(error, snapshot);
        throw error;
      })
      .finally(() => {
        if (operationEpoch !== contextEpoch || activeOperation !== operation) return;
        activeOperation = null;
        activeRevision = 0;

        const queued = queuedFlush;
        queuedFlush = null;
        if (queued && conflictError) {
          queued.reject(conflictError);
          notify();
          return;
        }
        if (queued && !disposed && revision > savedRevision) {
          const nextOperation = startLatestSave();
          nextOperation.then(queued.resolve, queued.reject);
          return;
        }
        if (queued) {
          if (settledError) queued.reject(settledError);
          else queued.resolve(settledResult);
        }
        notify();
      });
    activeOperation = operation;
    tail = operation;
    notify();
    return operation;
  };

  const flush = () => {
    clearScheduledTimer();
    if (conflictError) return Promise.reject(conflictError);
    if (disposed) return tail;
    if (!activeOperation) {
      if (revision <= savedRevision) return tail;
      return startLatestSave();
    }
    if (queuedFlush) return queuedFlush.promise;
    if (revision <= activeRevision) return activeOperation;

    // Keep one mutable, not-yet-started slot behind the active request. The
    // snapshot itself is captured only when that request starts, so every edit
    // made while the active request is in flight is folded into the one next
    // write. This also ensures onSaveStart observes the actual latest snapshot
    // whose ownership fingerprint can become server state.
    queuedFlush = createDeferred();
    notify();
    return queuedFlush.promise;
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
    lastError = null;
    conflictError = null;
    const abandonedFlush = queuedFlush;
    queuedFlush = null;
    activeOperation = null;
    activeRevision = 0;
    savedBases.set(snapshotKey(snapshot), savedResult);
    tail = Promise.resolve(savedResult);
    abandonedFlush?.resolve(savedResult);
    notify();
    return revision;
  };

  const dispose = () => {
    disposed = true;
    contextEpoch += 1;
    clearScheduledTimer();
    const abandonedFlush = queuedFlush;
    queuedFlush = null;
    activeOperation = null;
    activeRevision = 0;
    abandonedFlush?.resolve(latestSnapshot);
  };

  const hasUnsavedChanges = () => {
    const current = state();
    return current.dirty || current.pending;
  };

  const isSnapshotSaved = (snapshot) => {
    if (latestSnapshot === undefined || hasUnsavedChanges()) return false;
    const fingerprint = snapshotFingerprint(snapshot);
    return fingerprint !== undefined && fingerprint === latestFingerprint;
  };

  return {
    schedule,
    acknowledge,
    flush,
    dispose,
    getState: state,
    hasUnsavedChanges,
    isSnapshotSaved,
  };
}
