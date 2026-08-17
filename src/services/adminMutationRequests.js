const STORAGE_PREFIX = "family-tree-generator.admin-entitlement-request.v1:";
export const PENDING_ADMIN_MUTATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const descriptorKey = ({ operation, targetUserId, payload }) =>
  `${STORAGE_PREFIX}${encodeURIComponent(
    JSON.stringify([String(operation), String(targetUserId), payload]),
  )}`;

const localStorageOrNull = () => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};

const storedRequestId = (storage, key, now = Date.now()) => {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return "";
    const value = JSON.parse(raw);
    const requestId = String(value?.requestId || "").trim();
    const createdAt = Number(value?.createdAt);
    if (
      !requestId ||
      !Number.isFinite(createdAt) ||
      createdAt > now ||
      now - createdAt > PENDING_ADMIN_MUTATION_MAX_AGE_MS
    ) {
      storage.removeItem(key);
      return "";
    }
    return requestId;
  } catch {
    return "";
  }
};

export function getOrCreatePendingAdminMutation(descriptor, createRequestId) {
  const key = descriptorKey(descriptor);
  const storage = localStorageOrNull();
  if (!storage) {
    throw new Error(
      "This browser cannot safely retain an admin change for retry. Enable local storage and try again.",
    );
  }
  const persistedRequestId = storedRequestId(storage, key);
  if (persistedRequestId) return persistedRequestId;

  const requestId = String(createRequestId?.() || "").trim();
  if (!requestId) throw new Error("Could not create an admin change request ID.");

  try {
    storage.setItem(key, JSON.stringify({ requestId, createdAt: Date.now() }));
  } catch {
    throw new Error(
      "This browser could not safely retain the admin change for retry. Free local storage and try again.",
    );
  }
  if (storedRequestId(storage, key) !== requestId) {
    throw new Error(
      "This browser could not verify the saved admin change request. No change was sent.",
    );
  }
  return requestId;
}

export function clearPendingAdminMutation(descriptor, requestId) {
  const key = descriptorKey(descriptor);
  const expectedRequestId = String(requestId || "").trim();
  if (!expectedRequestId) return;

  const storage = localStorageOrNull();
  if (storedRequestId(storage, key) === expectedRequestId) {
    try {
      storage.removeItem(key);
    } catch {
      // Keeping a completed request ID is fail-safe: a later retry remains
      // idempotent instead of issuing a duplicate entitlement change.
    }
  }
}
