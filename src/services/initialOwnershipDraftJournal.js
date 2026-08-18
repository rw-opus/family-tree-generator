import { TREE_DATA_LIMITS, utf8ByteLength } from "../domain/treeData.js";

export const INITIAL_OWNERSHIP_DRAFT_VERSION = 1;
export const INITIAL_OWNERSHIP_DRAFT_KEY_PREFIX =
  "family-tree-generator:initial-ownership-draft:v1:user:";
export const INITIAL_OWNERSHIP_DELETION_TOMBSTONE_KEY_PREFIX =
  "family-tree-generator:initial-ownership-deleted:v1:user:";
export const INITIAL_OWNERSHIP_DRAFT_DISMISSAL_KEY_PREFIX =
  "family-tree-generator:initial-ownership-draft-dismissal:v1:user:";

const DEFAULT_WRITER_ID = "default-writer";
const MAX_DRAFT_BYTES = 256 * 1024;
const MAX_DRAFT_ROWS = 512;
const MAX_DRAFT_NODES = 10_000;
const MAX_DRAFT_DEPTH = 16;
const MAX_SUBMITTED_FINGERPRINTS = 8;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export const INITIAL_OWNERSHIP_DRAFT_ERROR_CODES = Object.freeze({
  INVALID_ID: "INITIAL_OWNERSHIP_DRAFT_INVALID_ID",
  INVALID: "INITIAL_OWNERSHIP_DRAFT_INVALID",
  TOO_LARGE: "INITIAL_OWNERSHIP_DRAFT_TOO_LARGE",
  STORAGE_UNAVAILABLE: "INITIAL_OWNERSHIP_DRAFT_STORAGE_UNAVAILABLE",
  STORAGE_FAILURE: "INITIAL_OWNERSHIP_DRAFT_STORAGE_FAILURE",
  REVISION_CONFLICT: "INITIAL_OWNERSHIP_DRAFT_REVISION_CONFLICT",
  TREE_DELETED: "INITIAL_OWNERSHIP_DRAFT_TREE_DELETED",
});

export const INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES = Object.freeze({
  IDENTICAL: "identical",
  SAFE_TO_REPLAY: "safe-to-replay",
  CONFLICT: "conflict",
});

export class InitialOwnershipDraftError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "InitialOwnershipDraftError";
    this.code = code;
  }
}

export const isInitialOwnershipDraftError = (error) =>
  error instanceof InitialOwnershipDraftError ||
  Object.values(INITIAL_OWNERSHIP_DRAFT_ERROR_CODES).includes(error?.code);

const fail = (code, message, cause) =>
  new InitialOwnershipDraftError(code, message, cause ? { cause } : undefined);

const isRecord = (value) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

const assertIdentifier = (value, label, { rejectEmail = false, allowEmpty = false } = {}) => {
  if (
    typeof value !== "string" ||
    (!allowEmpty && !value.trim()) ||
    utf8ByteLength(value) > TREE_DATA_LIMITS.maxIdBytes ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    (rejectEmail && value.includes("@"))
  ) {
    throw fail(
      INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID_ID,
      `A valid ${label} is required for initial-ownership recovery.`,
    );
  }
  return value;
};

const assertUserId = (userId) =>
  assertIdentifier(userId, "authenticated user identifier", { rejectEmail: true });
const assertTreeId = (treeId) => assertIdentifier(treeId, "family identifier");
const assertPropertyId = (propertyId) => assertIdentifier(propertyId, "property identifier");
const assertWriterId = (writerId) => assertIdentifier(writerId, "browser-tab recovery identifier");

const userDraftPrefix = (userId) =>
  `${INITIAL_OWNERSHIP_DRAFT_KEY_PREFIX}${encodeURIComponent(assertUserId(userId))}:tree:`;

const treeDraftPrefix = (userId, treeId) =>
  `${userDraftPrefix(userId)}${encodeURIComponent(assertTreeId(treeId))}:property:`;

const userDismissalPrefix = (userId) =>
  `${INITIAL_OWNERSHIP_DRAFT_DISMISSAL_KEY_PREFIX}${encodeURIComponent(
    assertUserId(userId),
  )}:tree:`;

const treeDismissalPrefix = (userId, treeId) =>
  `${userDismissalPrefix(userId)}${encodeURIComponent(assertTreeId(treeId))}:property:`;

export const initialOwnershipDraftKey = (
  userId,
  treeId,
  propertyId,
  writerId = DEFAULT_WRITER_ID,
) =>
  `${treeDraftPrefix(userId, treeId)}${encodeURIComponent(
    assertPropertyId(propertyId),
  )}:writer:${encodeURIComponent(assertWriterId(writerId))}`;

export const initialOwnershipDeletionTombstoneKey = (userId, treeId) =>
  `${INITIAL_OWNERSHIP_DELETION_TOMBSTONE_KEY_PREFIX}${encodeURIComponent(
    assertUserId(userId),
  )}:tree:${encodeURIComponent(assertTreeId(treeId))}`;

export const initialOwnershipDraftDismissalKey = (
  userId,
  treeId,
  propertyId,
  writerId = DEFAULT_WRITER_ID,
) =>
  `${treeDismissalPrefix(userId, treeId)}${encodeURIComponent(
    assertPropertyId(propertyId),
  )}:writer:${encodeURIComponent(assertWriterId(writerId))}`;

export function initialOwnershipDraftWriterId({
  randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
} = {}) {
  return assertWriterId(
    randomUUID?.() || `writer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

const storageRevision = (value) => {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw fail(
      INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID,
      "A positive cloud storage revision is required for initial-ownership recovery.",
    );
  }
  return revision;
};

const validIsoDate = (value) => {
  if (typeof value !== "string" || !value) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};

const isoDate = (value) => {
  let candidate;
  try {
    candidate = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  } catch (cause) {
    throw fail(
      INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID,
      "A valid journal time is required.",
      cause,
    );
  }
  if (!validIsoDate(candidate)) {
    throw fail(INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID, "A valid journal time is required.");
  }
  return candidate;
};

const inspectJsonValue = (root, label) => {
  const stack = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    nodes += 1;
    if (nodes > MAX_DRAFT_NODES || depth > MAX_DRAFT_DEPTH) {
      throw fail(
        INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.TOO_LARGE,
        `${label} is too complex for the compact recovery journal.`,
      );
    }
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw fail(
          INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID,
          `${label} contains a non-finite number.`,
        );
      }
      continue;
    }
    if (typeof value === "string") {
      if (utf8ByteLength(value) > TREE_DATA_LIMITS.maxStringBytes) {
        throw fail(
          INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.TOO_LARGE,
          `${label} contains text that is too large for recovery.`,
        );
      }
      continue;
    }
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], depth: depth + 1 });
      }
      continue;
    }
    if (!isRecord(value)) {
      throw fail(
        INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID,
        `${label} must contain only plain JSON values.`,
      );
    }
    Object.keys(value).forEach((key) => {
      if (DANGEROUS_KEYS.has(key) || utf8ByteLength(key) > TREE_DATA_LIMITS.maxKeyBytes) {
        throw fail(
          INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID,
          `${label} contains an unsafe field name.`,
        );
      }
      stack.push({ value: value[key], depth: depth + 1 });
    });
  }
};

const cloneRecordArray = (value, label, { requireIds = false } = {}) => {
  if (!Array.isArray(value)) {
    throw fail(INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID, `${label} must be an array.`);
  }
  if (value.length > MAX_DRAFT_ROWS) {
    throw fail(
      INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.TOO_LARGE,
      `${label} has too many rows for the compact recovery journal.`,
    );
  }
  inspectJsonValue(value, label);
  value.forEach((row) => {
    if (!isRecord(row)) {
      throw fail(
        INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID,
        `${label} must contain only records.`,
      );
    }
    if (Object.prototype.hasOwnProperty.call(row, "id")) {
      assertIdentifier(row.id, `${label} row identifier`);
    } else if (requireIds) {
      throw fail(
        INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID,
        `${label} records require identifiers.`,
      );
    }
    if (Object.prototype.hasOwnProperty.call(row, "personId")) {
      assertIdentifier(row.personId, `${label} person identifier`, { allowEmpty: true });
    }
  });
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (cause) {
    throw fail(
      INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID,
      `${label} could not be copied safely.`,
      cause,
    );
  }
};

const cloneOwners = (owners) => cloneRecordArray(owners, "Initial ownership");

const cloneOutsideParties = (outsideParties) => {
  const cloned = cloneRecordArray(outsideParties, "Outside-party recovery", {
    requireIds: true,
  });
  const ids = new Set();
  cloned.forEach((party) => {
    if (ids.has(party.id)) {
      throw fail(
        INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID,
        "Outside-party recovery contains duplicate identifiers.",
      );
    }
    ids.add(party.id);
  });
  return cloned;
};

const validateOutsidePartySource = (value, label) => {
  if (!Array.isArray(value)) {
    throw fail(INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID, `${label} must be an array.`);
  }
  if (value.length > TREE_DATA_LIMITS.maxOutsideParties) {
    throw fail(
      INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.TOO_LARGE,
      `${label} contains too many records.`,
    );
  }
  const ids = new Set();
  value.forEach((party) => {
    if (!isRecord(party)) {
      throw fail(
        INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID,
        `${label} must contain only records.`,
      );
    }
    const id = assertIdentifier(party.id, `${label} row identifier`);
    if (ids.has(id)) {
      throw fail(
        INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID,
        `${label} contains duplicate identifiers.`,
      );
    }
    ids.add(id);
  });
  return { records: value, ids };
};

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
};

const canonicalJson = (value) => JSON.stringify(canonicalValue(value));
const FNV_1A_128_OFFSET = 0x6c62272e07bb014262b821756295c58dn;
const FNV_1A_128_PRIME = 0x0000000001000000000000000000013bn;
const FNV_1A_128_MASK = (1n << 128n) - 1n;

const compactCanonicalFingerprint = (value) => {
  const canonical = canonicalJson(value);
  let hash = FNV_1A_128_OFFSET;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= BigInt(canonical.charCodeAt(index));
    hash = (hash * FNV_1A_128_PRIME) & FNV_1A_128_MASK;
  }
  return `fnv1a128:${canonical.length}:${hash.toString(16).padStart(32, "0")}`;
};

const FINGERPRINT_PATTERN = /^fnv1a128:\d+:[0-9a-f]{32}$/u;
const assertFingerprint = (value, label = "ownership fingerprint") => {
  if (typeof value !== "string" || !FINGERPRINT_PATTERN.test(value)) {
    throw fail(INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID, `A valid ${label} is required.`);
  }
  return value;
};

export const initialOwnershipOwnersFingerprint = (owners) =>
  compactCanonicalFingerprint(cloneOwners(owners));

const resolveStorage = (storage, methods) => {
  let target;
  try {
    target = storage === undefined ? globalThis.localStorage : storage;
  } catch (cause) {
    throw fail(
      INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.STORAGE_UNAVAILABLE,
      "Initial-ownership recovery storage is unavailable in this browser.",
      cause,
    );
  }
  if (!target || methods.some((method) => typeof target[method] !== "function")) {
    throw fail(
      INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.STORAGE_UNAVAILABLE,
      "Initial-ownership recovery storage is unavailable in this browser.",
    );
  }
  return target;
};

const storageFailure = (operation, cause) =>
  fail(
    INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.STORAGE_FAILURE,
    `Initial-ownership recovery data could not be ${operation} safely in this browser.`,
    cause,
  );

const readStorageItem = (storage, key) => {
  try {
    return storage.getItem(key);
  } catch (cause) {
    throw storageFailure("read", cause);
  }
};

const storageKeys = (storage, { reverse = false } = {}) => {
  const keys = [];
  let length;
  try {
    length = Number(storage.length);
    if (!Number.isSafeInteger(length) || length < 0) throw new Error("Invalid storage length");
    for (let offset = 0; offset < length; offset += 1) {
      const index = reverse ? length - 1 - offset : offset;
      const key = storage.key(index);
      if (typeof key === "string") keys.push(key);
    }
  } catch (cause) {
    throw storageFailure("enumerated", cause);
  }
  return keys;
};

const serializeEnvelope = (envelope) => {
  let raw;
  try {
    raw = JSON.stringify(envelope);
  } catch (cause) {
    throw fail(
      INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID,
      "Initial-ownership recovery data could not be serialized.",
      cause,
    );
  }
  if (utf8ByteLength(raw) > MAX_DRAFT_BYTES) {
    throw fail(
      INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.TOO_LARGE,
      "Initial-ownership recovery data exceeds the compact browser-storage limit.",
    );
  }
  return raw;
};

const ENVELOPE_KEYS = [
  "baseOwnersFingerprint",
  "baseStorageRevision",
  "owners",
  "ownersFingerprint",
  "outsideParties",
  "propertyId",
  "recordFingerprint",
  "savedAt",
  "submittedOwnerFingerprints",
  "treeId",
  "userId",
  "version",
  "writerId",
].sort();

const envelopeBody = (envelope) => {
  const body = { ...envelope };
  delete body.recordFingerprint;
  return body;
};

const sealEnvelope = (body) => ({
  ...body,
  recordFingerprint: compactCanonicalFingerprint(body),
});

const invalidEnvelope = (cause) =>
  fail(
    INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID,
    "The initial-ownership recovery record is invalid and has been isolated.",
    cause,
  );

const parseEnvelope = (raw, { expectedUserId, expectedTreeId, expectedKey } = {}) => {
  if (typeof raw !== "string" || utf8ByteLength(raw) > MAX_DRAFT_BYTES) {
    throw fail(
      INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.TOO_LARGE,
      "The initial-ownership recovery record exceeds the compact storage limit.",
    );
  }
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (cause) {
    throw invalidEnvelope(cause);
  }
  if (
    !isRecord(envelope) ||
    envelope.version !== INITIAL_OWNERSHIP_DRAFT_VERSION ||
    JSON.stringify(Object.keys(envelope).sort()) !== JSON.stringify(ENVELOPE_KEYS)
  ) {
    throw invalidEnvelope();
  }

  let userId;
  let treeId;
  let propertyId;
  let writerId;
  let baseStorageRevision;
  let owners;
  let outsideParties;
  try {
    userId = assertUserId(envelope.userId);
    treeId = assertTreeId(envelope.treeId);
    propertyId = assertPropertyId(envelope.propertyId);
    writerId = assertWriterId(envelope.writerId);
    baseStorageRevision = storageRevision(envelope.baseStorageRevision);
    owners = cloneOwners(envelope.owners);
    outsideParties = cloneOutsideParties(envelope.outsideParties);
    assertFingerprint(envelope.baseOwnersFingerprint, "base ownership fingerprint");
    assertFingerprint(envelope.ownersFingerprint);
    assertFingerprint(envelope.recordFingerprint, "recovery-record fingerprint");
  } catch (cause) {
    throw invalidEnvelope(cause);
  }

  const submitted = envelope.submittedOwnerFingerprints;
  if (
    !validIsoDate(envelope.savedAt) ||
    !Array.isArray(submitted) ||
    submitted.length > MAX_SUBMITTED_FINGERPRINTS ||
    new Set(submitted).size !== submitted.length ||
    submitted.some((fingerprint) => !FINGERPRINT_PATTERN.test(fingerprint)) ||
    (expectedUserId !== undefined && userId !== expectedUserId) ||
    (expectedTreeId !== undefined && treeId !== expectedTreeId) ||
    (expectedKey !== undefined &&
      initialOwnershipDraftKey(userId, treeId, propertyId, writerId) !== expectedKey)
  ) {
    throw invalidEnvelope();
  }

  const referencedIds = new Set(
    owners
      .map((owner) => owner.personId)
      .filter((personId) => typeof personId === "string" && personId),
  );
  if (outsideParties.some((party) => !referencedIds.has(party.id))) throw invalidEnvelope();

  const ownersFingerprint = compactCanonicalFingerprint(owners);
  if (
    ownersFingerprint !== envelope.ownersFingerprint ||
    compactCanonicalFingerprint(envelopeBody(envelope)) !== envelope.recordFingerprint
  ) {
    throw invalidEnvelope();
  }

  const parsed = {
    version: INITIAL_OWNERSHIP_DRAFT_VERSION,
    userId,
    treeId,
    propertyId,
    writerId,
    baseStorageRevision,
    baseOwnersFingerprint: envelope.baseOwnersFingerprint,
    ownersFingerprint,
    submittedOwnerFingerprints: [...submitted],
    savedAt: envelope.savedAt,
    owners,
    outsideParties,
    recordFingerprint: envelope.recordFingerprint,
  };
  return parsed;
};

const validateDraftValue = (draft) => {
  let raw;
  try {
    raw = JSON.stringify(draft);
  } catch (cause) {
    throw invalidEnvelope(cause);
  }
  return parseEnvelope(raw);
};

const referencedOutsideParties = (owners, baseOutsideParties, outsideParties) => {
  const base = validateOutsidePartySource(baseOutsideParties, "Base outside parties");
  const current = validateOutsidePartySource(outsideParties, "Current outside parties");
  const referencedIds = new Set(
    owners
      .map((owner) => owner.personId)
      .filter((personId) => typeof personId === "string" && personId),
  );
  return cloneOutsideParties(
    current.records.filter((party) => referencedIds.has(party.id) && !base.ids.has(party.id)),
  );
};

const mergePendingOutsideParties = (
  owners,
  existingOutsideParties,
  includedOutsideParties,
  currentOutsideParties,
) => {
  const referencedIds = new Set(
    owners
      .map((owner) => owner.personId)
      .filter((personId) => typeof personId === "string" && personId),
  );
  const currentSource = validateOutsidePartySource(
    currentOutsideParties,
    "Current outside parties",
  );
  const currentById = new Map(
    cloneOutsideParties(currentSource.records.filter((party) => referencedIds.has(party.id))).map(
      (party) => [party.id, party],
    ),
  );
  const includedById = new Map(includedOutsideParties.map((party) => [party.id, party]));
  existingOutsideParties.forEach((party) => {
    if (!referencedIds.has(party.id) || includedById.has(party.id)) return;
    includedById.set(party.id, currentById.get(party.id) || party);
  });
  return [...includedById.values()];
};

const deletedTreeError = () =>
  fail(
    INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.TREE_DELETED,
    "This family was permanently deleted, so this browser tab cannot recreate its recovery data.",
  );

const assertTreeNotDeleted = (storage, userId, treeId) => {
  if (readStorageItem(storage, initialOwnershipDeletionTombstoneKey(userId, treeId)) !== null) {
    throw deletedTreeError();
  }
};

export function writeInitialOwnershipDraft(
  userId,
  {
    treeId,
    propertyId,
    baseStorageRevision,
    baseOwners,
    owners,
    baseOutsideParties = [],
    outsideParties = [],
    knownAncestorOwnerFingerprints = [],
  },
  { storage, now = new Date(), writerId = DEFAULT_WRITER_ID } = {},
) {
  const verifiedUserId = assertUserId(userId);
  const verifiedTreeId = assertTreeId(treeId);
  const verifiedPropertyId = assertPropertyId(propertyId);
  const verifiedWriterId = assertWriterId(writerId);
  const verifiedRevision = storageRevision(baseStorageRevision);
  const clonedBaseOwners = cloneOwners(baseOwners);
  const clonedOwners = cloneOwners(owners);
  const incomingBaseOwnersFingerprint = compactCanonicalFingerprint(clonedBaseOwners);
  const ownersFingerprint = compactCanonicalFingerprint(clonedOwners);
  if (
    !Array.isArray(knownAncestorOwnerFingerprints) ||
    knownAncestorOwnerFingerprints.length > MAX_SUBMITTED_FINGERPRINTS
  ) {
    throw fail(
      INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID,
      "Known initial-ownership ancestors are invalid.",
    );
  }
  const verifiedKnownAncestorFingerprints = [
    ...new Set(
      knownAncestorOwnerFingerprints.map((fingerprint) =>
        assertFingerprint(fingerprint, "known ancestor owner fingerprint"),
      ),
    ),
  ];
  let includedOutsideParties = referencedOutsideParties(
    clonedOwners,
    baseOutsideParties,
    outsideParties,
  );
  const target = resolveStorage(storage, ["getItem", "setItem", "removeItem"]);
  assertTreeNotDeleted(target, verifiedUserId, verifiedTreeId);
  const key = initialOwnershipDraftKey(
    verifiedUserId,
    verifiedTreeId,
    verifiedPropertyId,
    verifiedWriterId,
  );
  const existingRaw = readStorageItem(target, key);
  const existing = existingRaw
    ? parseEnvelope(existingRaw, {
        expectedUserId: verifiedUserId,
        expectedTreeId: verifiedTreeId,
        expectedKey: key,
      })
    : null;

  let submittedOwnerFingerprints = [
    ...new Set([
      ...(existing?.submittedOwnerFingerprints || []),
      ...verifiedKnownAncestorFingerprints,
    ]),
  ].slice(-MAX_SUBMITTED_FINGERPRINTS);
  let effectiveBaseStorageRevision = verifiedRevision;
  let effectiveBaseOwnersFingerprint = incomingBaseOwnersFingerprint;
  if (existing) {
    const sameBase = existing.baseOwnersFingerprint === incomingBaseOwnersFingerprint;
    const submittedBaseIndex = existing.submittedOwnerFingerprints.lastIndexOf(
      incomingBaseOwnersFingerprint,
    );
    const baseDescendsFromSubmitted = submittedBaseIndex >= 0;
    const revisionIsCurrent = verifiedRevision === existing.baseStorageRevision;
    const revisionAdvanced = verifiedRevision > existing.baseStorageRevision;
    const descendsFromPendingTarget =
      revisionIsCurrent && incomingBaseOwnersFingerprint === existing.ownersFingerprint;
    if (
      (!sameBase && !baseDescendsFromSubmitted && !descendsFromPendingTarget) ||
      (!revisionIsCurrent && !revisionAdvanced) ||
      (baseDescendsFromSubmitted && !descendsFromPendingTarget && !revisionAdvanced)
    ) {
      throw fail(
        INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.REVISION_CONFLICT,
        "Pending initial ownership already belongs to a different ownership base and was not overwritten.",
      );
    }
    if (revisionIsCurrent) {
      // No cloud acknowledgement has advanced this record, so a party carried
      // by the existing draft is still pending even if the live base array now
      // happens to contain that newly-created party.
      includedOutsideParties = mergePendingOutsideParties(
        clonedOwners,
        existing.outsideParties,
        includedOutsideParties,
        outsideParties,
      );
    }
    if (descendsFromPendingTarget) {
      // Consecutive UI edits use the latest in-memory owners as their input
      // base. Keep the original server base so S -> A -> B remains replayable.
      effectiveBaseStorageRevision = existing.baseStorageRevision;
      effectiveBaseOwnersFingerprint = existing.baseOwnersFingerprint;
    } else if (baseDescendsFromSubmitted) {
      submittedOwnerFingerprints = existing.submittedOwnerFingerprints.slice(
        submittedBaseIndex + 1,
      );
    }
  }

  const body = {
    version: INITIAL_OWNERSHIP_DRAFT_VERSION,
    userId: verifiedUserId,
    treeId: verifiedTreeId,
    propertyId: verifiedPropertyId,
    writerId: verifiedWriterId,
    baseStorageRevision: effectiveBaseStorageRevision,
    baseOwnersFingerprint: effectiveBaseOwnersFingerprint,
    ownersFingerprint,
    submittedOwnerFingerprints,
    savedAt: isoDate(now),
    owners: clonedOwners,
    outsideParties: includedOutsideParties,
  };
  const envelope = sealEnvelope(body);
  if (
    existing &&
    existing.baseStorageRevision === envelope.baseStorageRevision &&
    existing.baseOwnersFingerprint === envelope.baseOwnersFingerprint &&
    existing.ownersFingerprint === envelope.ownersFingerprint &&
    canonicalJson(existing.outsideParties) === canonicalJson(envelope.outsideParties) &&
    canonicalJson(existing.submittedOwnerFingerprints) ===
      canonicalJson(envelope.submittedOwnerFingerprints)
  ) {
    return existing;
  }

  const raw = serializeEnvelope(envelope);
  try {
    target.setItem(key, raw);
  } catch (cause) {
    throw storageFailure("stored", cause);
  }

  // A permanent deletion in another tab may land between the preflight check
  // and this write. In that case remove only the exact value written here.
  if (readStorageItem(target, initialOwnershipDeletionTombstoneKey(userId, treeId)) !== null) {
    if (readStorageItem(target, key) === raw) {
      try {
        target.removeItem(key);
      } catch (cause) {
        throw storageFailure("removed after concurrent deletion", cause);
      }
    }
    throw deletedTreeError();
  }
  if (readStorageItem(target, key) !== raw) throw storageFailure("verified");
  return parseEnvelope(raw, {
    expectedUserId: verifiedUserId,
    expectedTreeId: verifiedTreeId,
    expectedKey: key,
  });
}

export function readInitialOwnershipDraft(
  userId,
  treeId,
  propertyId,
  { storage, writerId = DEFAULT_WRITER_ID } = {},
) {
  const verifiedUserId = assertUserId(userId);
  const verifiedTreeId = assertTreeId(treeId);
  const target = resolveStorage(storage, ["getItem"]);
  const key = initialOwnershipDraftKey(verifiedUserId, verifiedTreeId, propertyId, writerId);
  const raw = readStorageItem(target, key);
  if (raw === null) return null;
  return parseEnvelope(raw, {
    expectedUserId: verifiedUserId,
    expectedTreeId: verifiedTreeId,
    expectedKey: key,
  });
}

const DISMISSAL_KEYS = [
  "dismissedAt",
  "propertyId",
  "recordFingerprint",
  "treeId",
  "userId",
  "version",
  "writerId",
].sort();

const parseDismissal = (
  raw,
  { expectedUserId, expectedTreeId, expectedPropertyId, expectedWriterId, expectedKey } = {},
) => {
  let marker;
  try {
    marker = JSON.parse(raw);
  } catch (cause) {
    throw invalidEnvelope(cause);
  }
  if (
    !isRecord(marker) ||
    marker.version !== INITIAL_OWNERSHIP_DRAFT_VERSION ||
    JSON.stringify(Object.keys(marker).sort()) !== JSON.stringify(DISMISSAL_KEYS) ||
    !validIsoDate(marker.dismissedAt)
  ) {
    throw invalidEnvelope();
  }
  let userId;
  let treeId;
  let propertyId;
  let writerId;
  let recordFingerprint;
  try {
    userId = assertUserId(marker.userId);
    treeId = assertTreeId(marker.treeId);
    propertyId = assertPropertyId(marker.propertyId);
    writerId = assertWriterId(marker.writerId);
    recordFingerprint = assertFingerprint(
      marker.recordFingerprint,
      "dismissed recovery-record fingerprint",
    );
  } catch (cause) {
    throw invalidEnvelope(cause);
  }
  if (
    (expectedUserId !== undefined && userId !== expectedUserId) ||
    (expectedTreeId !== undefined && treeId !== expectedTreeId) ||
    (expectedPropertyId !== undefined && propertyId !== expectedPropertyId) ||
    (expectedWriterId !== undefined && writerId !== expectedWriterId) ||
    (expectedKey !== undefined &&
      initialOwnershipDraftDismissalKey(userId, treeId, propertyId, writerId) !== expectedKey)
  ) {
    throw invalidEnvelope();
  }
  return {
    version: INITIAL_OWNERSHIP_DRAFT_VERSION,
    userId,
    treeId,
    propertyId,
    writerId,
    recordFingerprint,
    dismissedAt: marker.dismissedAt,
  };
};

export function listInitialOwnershipDrafts(userId, { storage } = {}) {
  const verifiedUserId = assertUserId(userId);
  const target = resolveStorage(storage, ["getItem", "key"]);
  const prefix = userDraftPrefix(verifiedUserId);
  const dismissalPrefix = userDismissalPrefix(verifiedUserId);
  const drafts = [];
  const invalidRecords = [];
  const keys = storageKeys(target);
  const inspectedDismissalKeys = new Set();
  keys
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => {
      const raw = readStorageItem(target, key);
      if (raw === null) return;
      try {
        const draft = parseEnvelope(raw, { expectedUserId: verifiedUserId, expectedKey: key });
        const markerKey = initialOwnershipDraftDismissalKey(
          verifiedUserId,
          draft.treeId,
          draft.propertyId,
          draft.writerId,
        );
        const markerRaw = readStorageItem(target, markerKey);
        if (markerRaw !== null) {
          inspectedDismissalKeys.add(markerKey);
          try {
            const marker = parseDismissal(markerRaw, {
              expectedUserId: verifiedUserId,
              expectedTreeId: draft.treeId,
              expectedPropertyId: draft.propertyId,
              expectedWriterId: draft.writerId,
              expectedKey: markerKey,
            });
            if (marker.recordFingerprint === draft.recordFingerprint) return;
          } catch (error) {
            invalidRecords.push({ kind: "dismissal", key: markerKey, raw: markerRaw, error });
          }
        }
        drafts.push(draft);
      } catch (error) {
        invalidRecords.push({ kind: "draft", key, raw, error });
      }
    });
  keys
    .filter((key) => key.startsWith(dismissalPrefix) && !inspectedDismissalKeys.has(key))
    .forEach((key) => {
      const raw = readStorageItem(target, key);
      if (raw === null) return;
      try {
        parseDismissal(raw, { expectedUserId: verifiedUserId, expectedKey: key });
      } catch (error) {
        invalidRecords.push({ kind: "dismissal", key, raw, error });
      }
    });
  drafts.sort(
    (left, right) =>
      left.treeId.localeCompare(right.treeId) ||
      left.propertyId.localeCompare(right.propertyId) ||
      left.writerId.localeCompare(right.writerId),
  );
  return { drafts, invalidRecords };
}

export function dismissInitialOwnershipDraft(
  userId,
  treeId,
  propertyId,
  expectedRecordFingerprint,
  { storage, writerId = DEFAULT_WRITER_ID, now = new Date() } = {},
) {
  const verifiedUserId = assertUserId(userId);
  const verifiedTreeId = assertTreeId(treeId);
  const verifiedPropertyId = assertPropertyId(propertyId);
  const verifiedWriterId = assertWriterId(writerId);
  const fingerprint = assertFingerprint(
    expectedRecordFingerprint,
    "exact recovery-record fingerprint",
  );
  const target = resolveStorage(storage, ["getItem", "setItem", "removeItem"]);
  assertTreeNotDeleted(target, verifiedUserId, verifiedTreeId);
  const recordKey = initialOwnershipDraftKey(
    verifiedUserId,
    verifiedTreeId,
    verifiedPropertyId,
    verifiedWriterId,
  );
  const raw = readStorageItem(target, recordKey);
  if (raw === null) return false;
  const draft = parseEnvelope(raw, {
    expectedUserId: verifiedUserId,
    expectedTreeId: verifiedTreeId,
    expectedKey: recordKey,
  });
  if (draft.recordFingerprint !== fingerprint) return false;
  const marker = {
    version: INITIAL_OWNERSHIP_DRAFT_VERSION,
    userId: verifiedUserId,
    treeId: verifiedTreeId,
    propertyId: verifiedPropertyId,
    writerId: verifiedWriterId,
    recordFingerprint: fingerprint,
    dismissedAt: isoDate(now),
  };
  const markerKey = initialOwnershipDraftDismissalKey(
    verifiedUserId,
    verifiedTreeId,
    verifiedPropertyId,
    verifiedWriterId,
  );
  const markerRaw = JSON.stringify(marker);
  try {
    target.setItem(markerKey, markerRaw);
  } catch (cause) {
    throw storageFailure("dismissed", cause);
  }
  if (
    readStorageItem(
      target,
      initialOwnershipDeletionTombstoneKey(verifiedUserId, verifiedTreeId),
    ) !== null
  ) {
    if (readStorageItem(target, markerKey) === markerRaw) {
      try {
        target.removeItem(markerKey);
      } catch (cause) {
        throw storageFailure("removed after concurrent deletion", cause);
      }
    }
    throw deletedTreeError();
  }
  if (readStorageItem(target, markerKey) !== markerRaw) {
    throw storageFailure("verified after dismissal");
  }
  return true;
}

export function markInitialOwnershipDraftSubmitted(
  userId,
  treeId,
  propertyId,
  submittedOwnersFingerprint,
  { storage, writerId = DEFAULT_WRITER_ID } = {},
) {
  const verifiedUserId = assertUserId(userId);
  const verifiedTreeId = assertTreeId(treeId);
  const verifiedPropertyId = assertPropertyId(propertyId);
  const fingerprint = assertFingerprint(submittedOwnersFingerprint);
  const target = resolveStorage(storage, ["getItem", "setItem", "removeItem"]);
  assertTreeNotDeleted(target, verifiedUserId, verifiedTreeId);
  const key = initialOwnershipDraftKey(
    verifiedUserId,
    verifiedTreeId,
    verifiedPropertyId,
    writerId,
  );
  const raw = readStorageItem(target, key);
  if (raw === null) return null;
  const existing = parseEnvelope(raw, {
    expectedUserId: verifiedUserId,
    expectedTreeId: verifiedTreeId,
    expectedKey: key,
  });
  if (
    fingerprint !== existing.ownersFingerprint &&
    !existing.submittedOwnerFingerprints.includes(fingerprint)
  ) {
    throw fail(
      INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.REVISION_CONFLICT,
      "Only this record's current ownership can be marked as submitted.",
    );
  }
  if (existing.submittedOwnerFingerprints.includes(fingerprint)) return existing;
  const body = {
    ...envelopeBody(existing),
    submittedOwnerFingerprints: [...existing.submittedOwnerFingerprints, fingerprint].slice(
      -MAX_SUBMITTED_FINGERPRINTS,
    ),
  };
  const nextRaw = serializeEnvelope(sealEnvelope(body));
  try {
    target.setItem(key, nextRaw);
  } catch (cause) {
    throw storageFailure("marked as submitted", cause);
  }
  if (
    readStorageItem(
      target,
      initialOwnershipDeletionTombstoneKey(verifiedUserId, verifiedTreeId),
    ) !== null
  ) {
    if (readStorageItem(target, key) === nextRaw) {
      try {
        target.removeItem(key);
      } catch (cause) {
        throw storageFailure("removed after concurrent deletion", cause);
      }
    }
    throw deletedTreeError();
  }
  if (readStorageItem(target, key) !== nextRaw) throw storageFailure("verified after submission");
  return parseEnvelope(nextRaw, {
    expectedUserId: verifiedUserId,
    expectedTreeId: verifiedTreeId,
    expectedKey: key,
  });
}

/**
 * Acknowledge one ownership snapshot saved by this writer. An unchanged
 * pending record is removed. A newer descendant remains recoverable and is
 * rebased only when the saved fingerprint was marked as submitted first.
 */
export function acknowledgeInitialOwnershipDraftSave(
  userId,
  treeId,
  propertyId,
  savedOwnersFingerprint,
  expectedBaseStorageRevision,
  nextBaseStorageRevision,
  { storage, writerId = DEFAULT_WRITER_ID } = {},
) {
  const verifiedUserId = assertUserId(userId);
  const verifiedTreeId = assertTreeId(treeId);
  const verifiedPropertyId = assertPropertyId(propertyId);
  const savedFingerprint = assertFingerprint(savedOwnersFingerprint, "saved owner fingerprint");
  const expectedRevision = storageRevision(expectedBaseStorageRevision);
  const nextRevision = storageRevision(nextBaseStorageRevision);
  if (nextRevision <= expectedRevision) {
    throw fail(
      INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID,
      "The acknowledged cloud revision must advance before ownership recovery is rebased.",
    );
  }

  const target = resolveStorage(storage, ["getItem", "setItem", "removeItem"]);
  assertTreeNotDeleted(target, verifiedUserId, verifiedTreeId);
  const key = initialOwnershipDraftKey(
    verifiedUserId,
    verifiedTreeId,
    verifiedPropertyId,
    writerId,
  );
  const raw = readStorageItem(target, key);
  if (raw === null) return { action: "none", draft: null };
  const existing = parseEnvelope(raw, {
    expectedUserId: verifiedUserId,
    expectedTreeId: verifiedTreeId,
    expectedKey: key,
  });
  if (existing.baseStorageRevision !== expectedRevision) {
    throw fail(
      INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.REVISION_CONFLICT,
      "Pending initial ownership belongs to a different cloud revision and was not acknowledged.",
    );
  }

  if (existing.ownersFingerprint === savedFingerprint) {
    const cleared = clearInitialOwnershipDraft(
      verifiedUserId,
      verifiedTreeId,
      verifiedPropertyId,
      existing.recordFingerprint,
      { storage: target, writerId },
    );
    if (!cleared) {
      throw fail(
        INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.REVISION_CONFLICT,
        "Pending initial ownership changed before its saved snapshot could be cleared.",
      );
    }
    return { action: "cleared", draft: null };
  }

  const submittedIndex = existing.submittedOwnerFingerprints.lastIndexOf(savedFingerprint);
  if (submittedIndex < 0) {
    throw fail(
      INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.REVISION_CONFLICT,
      "The saved ownership is not a submitted ancestor of this browser tab's pending edit.",
    );
  }
  const body = {
    ...envelopeBody(existing),
    baseStorageRevision: nextRevision,
    baseOwnersFingerprint: savedFingerprint,
    submittedOwnerFingerprints: existing.submittedOwnerFingerprints.slice(submittedIndex + 1),
  };
  const nextRaw = serializeEnvelope(sealEnvelope(body));
  try {
    target.setItem(key, nextRaw);
  } catch (cause) {
    throw storageFailure("rebased after save", cause);
  }
  if (
    readStorageItem(
      target,
      initialOwnershipDeletionTombstoneKey(verifiedUserId, verifiedTreeId),
    ) !== null
  ) {
    if (readStorageItem(target, key) === nextRaw) {
      try {
        target.removeItem(key);
      } catch (cause) {
        throw storageFailure("removed after concurrent deletion", cause);
      }
    }
    throw deletedTreeError();
  }
  if (readStorageItem(target, key) !== nextRaw) {
    throw storageFailure("verified after save rebase");
  }
  return {
    action: "rebased",
    draft: parseEnvelope(nextRaw, {
      expectedUserId: verifiedUserId,
      expectedTreeId: verifiedTreeId,
      expectedKey: key,
    }),
  };
}

export function clearInitialOwnershipDraft(
  userId,
  treeId,
  propertyId,
  expectedRecordFingerprint,
  { storage, writerId = DEFAULT_WRITER_ID } = {},
) {
  const verifiedUserId = assertUserId(userId);
  const verifiedTreeId = assertTreeId(treeId);
  const fingerprint = assertFingerprint(
    expectedRecordFingerprint,
    "exact recovery-record fingerprint",
  );
  const target = resolveStorage(storage, ["getItem", "removeItem"]);
  const key = initialOwnershipDraftKey(verifiedUserId, verifiedTreeId, propertyId, writerId);
  const raw = readStorageItem(target, key);
  if (raw === null) return false;
  const existing = parseEnvelope(raw, {
    expectedUserId: verifiedUserId,
    expectedTreeId: verifiedTreeId,
    expectedKey: key,
  });
  if (existing.recordFingerprint !== fingerprint) return false;
  try {
    target.removeItem(key);
  } catch (cause) {
    throw storageFailure("cleared", cause);
  }
  if (readStorageItem(target, key) !== null) throw storageFailure("verified after clearing");
  const markerKey = initialOwnershipDraftDismissalKey(
    verifiedUserId,
    verifiedTreeId,
    propertyId,
    writerId,
  );
  try {
    target.removeItem(markerKey);
  } catch (cause) {
    throw storageFailure("cleared with its dismissal metadata", cause);
  }
  if (readStorageItem(target, markerKey) !== null) {
    throw storageFailure("verified after clearing dismissal metadata");
  }
  return true;
}

const serverPartyState = (draft, serverTree) => {
  const people = Array.isArray(serverTree?.people) ? serverTree.people : [];
  const outsideParties = Array.isArray(serverTree?.outsideParties) ? serverTree.outsideParties : [];
  const peopleIds = new Set(
    people.map((person) => person?.id).filter((id) => typeof id === "string" && id),
  );
  const outsideById = new Map(
    outsideParties
      .filter((party) => typeof party?.id === "string" && party.id)
      .map((party) => [party.id, party]),
  );
  const includedById = new Map(draft.outsideParties.map((party) => [party.id, party]));
  const conflictingPartyIds = [];
  const outsidePartiesToAdd = [];
  includedById.forEach((party, id) => {
    if (peopleIds.has(id)) {
      conflictingPartyIds.push(id);
      return;
    }
    const serverParty = outsideById.get(id);
    if (!serverParty) {
      outsidePartiesToAdd.push(party);
    } else if (canonicalJson(serverParty) !== canonicalJson(party)) {
      conflictingPartyIds.push(id);
    }
  });
  const availableIds = new Set([...peopleIds, ...outsideById.keys(), ...includedById.keys()]);
  const missingPartyIds = [
    ...new Set(
      draft.owners
        .map((owner) => owner.personId)
        .filter((id) => typeof id === "string" && id && !availableIds.has(id)),
    ),
  ];
  return { conflictingPartyIds, missingPartyIds, outsidePartiesToAdd };
};

export function compareInitialOwnershipDraftToTree(draft, serverTree) {
  const verifiedDraft = validateDraftValue(draft);
  if (!isRecord(serverTree) || serverTree.id !== verifiedDraft.treeId) {
    throw fail(
      INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID,
      "Initial ownership can only be compared with the same fetched family.",
    );
  }
  const serverStorageRevision = storageRevision(serverTree.storageRevision);
  const property = Array.isArray(serverTree.properties)
    ? serverTree.properties.find((candidate) => candidate?.id === verifiedDraft.propertyId)
    : null;
  if (!property) {
    return {
      state: INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.CONFLICT,
      reason: "missing-property",
      serverStorageRevision,
      baseStorageRevision: verifiedDraft.baseStorageRevision,
      baseOwnersFingerprint: verifiedDraft.baseOwnersFingerprint,
      targetOwnersFingerprint: verifiedDraft.ownersFingerprint,
      serverOwnersFingerprint: null,
      ownersIdentical: false,
      outsidePartiesToAdd: [],
      missingPartyIds: [],
      conflictingPartyIds: [],
    };
  }
  const serverOwners = cloneOwners(Array.isArray(property.owners) ? property.owners : []);
  const serverOwnersFingerprint = compactCanonicalFingerprint(serverOwners);
  const ownersIdentical = serverOwnersFingerprint === verifiedDraft.ownersFingerprint;
  const partyState = serverPartyState(verifiedDraft, serverTree);
  let state = INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.CONFLICT;
  let reason = "owners-diverged";
  if (partyState.conflictingPartyIds.length) {
    reason = "outside-party-collision";
  } else if (partyState.missingPartyIds.length) {
    reason = "missing-owner-party";
  } else if (ownersIdentical && !partyState.outsidePartiesToAdd.length) {
    state = INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.IDENTICAL;
    reason = "target-owners-match";
  } else if (
    serverOwnersFingerprint === verifiedDraft.baseOwnersFingerprint ||
    verifiedDraft.submittedOwnerFingerprints.includes(serverOwnersFingerprint)
  ) {
    state = INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.SAFE_TO_REPLAY;
    reason =
      serverOwnersFingerprint === verifiedDraft.baseOwnersFingerprint
        ? "base-owners-match"
        : "submitted-owner-ancestor-match";
  } else if (ownersIdentical && partyState.outsidePartiesToAdd.length) {
    reason = "outside-party-save-unconfirmed";
  }
  return {
    state,
    reason,
    serverStorageRevision,
    baseStorageRevision: verifiedDraft.baseStorageRevision,
    baseOwnersFingerprint: verifiedDraft.baseOwnersFingerprint,
    targetOwnersFingerprint: verifiedDraft.ownersFingerprint,
    serverOwnersFingerprint,
    ownersIdentical,
    outsidePartiesToAdd: cloneOutsideParties(partyState.outsidePartiesToAdd),
    missingPartyIds: [...partyState.missingPartyIds],
    conflictingPartyIds: [...partyState.conflictingPartyIds],
  };
}

export function recoverInitialOwnershipDraftTree(draft, serverTree) {
  const verifiedDraft = validateDraftValue(draft);
  const comparison = compareInitialOwnershipDraftToTree(verifiedDraft, serverTree);
  if (comparison.state === INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.CONFLICT) {
    throw fail(
      INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.REVISION_CONFLICT,
      "Initial ownership changed elsewhere and cannot be replayed automatically.",
    );
  }
  return {
    ...serverTree,
    properties: serverTree.properties.map((property) =>
      property.id === verifiedDraft.propertyId
        ? { ...property, owners: cloneOwners(verifiedDraft.owners) }
        : property,
    ),
    outsideParties: [
      ...(Array.isArray(serverTree.outsideParties) ? serverTree.outsideParties : []),
      ...cloneOutsideParties(comparison.outsidePartiesToAdd),
    ],
  };
}

const TOMBSTONE_KEYS = ["deletedAt", "tombstoneId", "treeId", "userId", "version"].sort();

const parseTombstone = (raw, { expectedUserId, expectedTreeId } = {}) => {
  let tombstone;
  try {
    tombstone = JSON.parse(raw);
  } catch (cause) {
    throw invalidEnvelope(cause);
  }
  if (
    !isRecord(tombstone) ||
    tombstone.version !== INITIAL_OWNERSHIP_DRAFT_VERSION ||
    JSON.stringify(Object.keys(tombstone).sort()) !== JSON.stringify(TOMBSTONE_KEYS) ||
    !validIsoDate(tombstone.deletedAt)
  ) {
    throw invalidEnvelope();
  }
  let userId;
  let treeId;
  let tombstoneId;
  try {
    userId = assertUserId(tombstone.userId);
    treeId = assertTreeId(tombstone.treeId);
    tombstoneId = assertIdentifier(tombstone.tombstoneId, "deletion tombstone identifier");
  } catch (cause) {
    throw invalidEnvelope(cause);
  }
  if (
    (expectedUserId !== undefined && userId !== expectedUserId) ||
    (expectedTreeId !== undefined && treeId !== expectedTreeId)
  ) {
    throw invalidEnvelope();
  }
  return {
    version: INITIAL_OWNERSHIP_DRAFT_VERSION,
    userId,
    treeId,
    tombstoneId,
    deletedAt: tombstone.deletedAt,
  };
};

export function readInitialOwnershipDeletionTombstone(userId, treeId, { storage } = {}) {
  const verifiedUserId = assertUserId(userId);
  const verifiedTreeId = assertTreeId(treeId);
  const target = resolveStorage(storage, ["getItem"]);
  const raw = readStorageItem(
    target,
    initialOwnershipDeletionTombstoneKey(verifiedUserId, verifiedTreeId),
  );
  if (raw === null) return null;
  return parseTombstone(raw, {
    expectedUserId: verifiedUserId,
    expectedTreeId: verifiedTreeId,
  });
}

export function markInitialOwnershipTreeDeleted(
  userId,
  treeId,
  {
    storage,
    now = new Date(),
    randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
  } = {},
) {
  const verifiedUserId = assertUserId(userId);
  const verifiedTreeId = assertTreeId(treeId);
  const target = resolveStorage(storage, ["getItem", "setItem", "removeItem", "key"]);
  const tombstone = {
    version: INITIAL_OWNERSHIP_DRAFT_VERSION,
    userId: verifiedUserId,
    treeId: verifiedTreeId,
    tombstoneId: assertIdentifier(
      randomUUID?.() || `deleted-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      "deletion tombstone identifier",
    ),
    deletedAt: isoDate(now),
  };
  const tombstoneKey = initialOwnershipDeletionTombstoneKey(verifiedUserId, verifiedTreeId);
  const raw = JSON.stringify(tombstone);
  try {
    target.setItem(tombstoneKey, raw);
  } catch (cause) {
    throw storageFailure("protected after permanent deletion", cause);
  }
  if (readStorageItem(target, tombstoneKey) !== raw) {
    throw storageFailure("verified after permanent deletion");
  }

  const prefix = treeDraftPrefix(verifiedUserId, verifiedTreeId);
  const metadataPrefix = treeDismissalPrefix(verifiedUserId, verifiedTreeId);
  const clearedRecordKeys = new Set();
  const clearedMetadataKeys = new Set();
  // Storage keys are indexed over a live collection. Another tab can remove a
  // lower-index entry while it is being enumerated, shifting a later key past
  // the first scan. The tombstone prevents new valid writes; repeat removal
  // and verification until two consecutive complete scans observe neither
  // kind of record. The second scan also closes a false-empty result caused by
  // an unrelated lower-index key disappearing during the first enumeration.
  let cleanupComplete = false;
  let consecutiveEmptyScans = 0;
  for (let pass = 0; pass < 64; pass += 1) {
    const keys = storageKeys(target, { reverse: true });
    const recordKeys = keys.filter((key) => key.startsWith(prefix));
    const metadataKeys = keys.filter((key) => key.startsWith(metadataPrefix));
    if (!recordKeys.length && !metadataKeys.length) {
      consecutiveEmptyScans += 1;
      if (consecutiveEmptyScans >= 2) {
        cleanupComplete = true;
        break;
      }
      continue;
    }
    consecutiveEmptyScans = 0;
    for (const key of recordKeys) {
      clearedRecordKeys.add(key);
      try {
        target.removeItem(key);
      } catch (cause) {
        throw storageFailure("cleared after permanent deletion", cause);
      }
      if (readStorageItem(target, key) !== null) {
        throw storageFailure("verified after permanent deletion cleanup");
      }
    }
    for (const key of metadataKeys) {
      clearedMetadataKeys.add(key);
      try {
        target.removeItem(key);
      } catch (cause) {
        throw storageFailure("cleared recovery metadata after permanent deletion", cause);
      }
      if (readStorageItem(target, key) !== null) {
        throw storageFailure("verified recovery-metadata cleanup after permanent deletion");
      }
    }
  }
  if (!cleanupComplete) {
    throw storageFailure("verified after permanent deletion cleanup");
  }
  return {
    tombstone,
    clearedRecordCount: clearedRecordKeys.size,
    clearedMetadataCount: clearedMetadataKeys.size,
  };
}

export function clearInitialOwnershipDeletionTombstoneForRecreation(
  userId,
  treeId,
  expectedTombstoneId,
  { storage } = {},
) {
  const verifiedUserId = assertUserId(userId);
  const verifiedTreeId = assertTreeId(treeId);
  const verifiedTombstoneId = assertIdentifier(
    expectedTombstoneId,
    "exact deletion tombstone identifier",
  );
  const target = resolveStorage(storage, ["getItem", "removeItem"]);
  const key = initialOwnershipDeletionTombstoneKey(verifiedUserId, verifiedTreeId);
  const raw = readStorageItem(target, key);
  if (raw === null) return false;
  const tombstone = parseTombstone(raw, {
    expectedUserId: verifiedUserId,
    expectedTreeId: verifiedTreeId,
  });
  if (tombstone.tombstoneId !== verifiedTombstoneId) return false;
  try {
    target.removeItem(key);
  } catch (cause) {
    throw storageFailure("cleared for deliberate family recreation", cause);
  }
  if (readStorageItem(target, key) !== null) {
    throw storageFailure("verified after deliberate family recreation");
  }
  return true;
}
