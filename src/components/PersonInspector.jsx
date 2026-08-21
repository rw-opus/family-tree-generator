import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Baby, Check, FilePlus2, Heart, Pencil, Trash2, UserRound, UsersRound } from "lucide-react";
import {
  composeFullName,
  createPerson,
  fatherSurnameDefaultPatch,
  givenNamesFromFullName,
  hasDesignation,
  personChoiceLabel,
  personDisplayName,
  personGivenNames,
  personIdentityIssues,
  parentageDescription,
  personRelationshipCounts,
  personSurname,
  personDesignations,
  removalWouldSeverFamily,
  sortPeopleForChoice,
  surnameFromFullName,
} from "../domain/people.js";
import {
  applyParentSuggestions,
  solePartnerParentSuggestions,
} from "../domain/parentSuggestions.js";
import { validateCausaMortisDeclaration } from "../domain/causaMortisCoverage.js";
import { INHERITANCE_CAUSA_MORTIS_CUTOFF } from "../domain/article5A.js";
import {
  editedIntestacyAllocations,
  intestacyLegalContextSignature,
  intestateAllocations,
  isPersonDeceased,
  linkedSpousesFor,
  missingPotentialIntestateParents,
  previewPropertyTransferCapacity,
  spouseDeathDatesAreOptionalForIntestacy,
  willAllocationReadiness,
} from "../domain/familyOwnership.js";
import { approximateFraction } from "../domain/ownership.js";
import { roundMoney } from "../domain/money.js";
import {
  buildCurrentOwnerPresentations,
  formatOwnershipFraction,
  formatOwnershipPercentage,
  ownerPresentationsById,
  reconcileFractionPercentageDisplay,
  recordedNonNegativeMoney,
} from "../domain/ownershipPresentation.js";
import {
  addFractions,
  MAX_FRACTION_INTEGER,
  ZERO_FRACTION,
  compareFractions,
  fractionToNumber,
  normaliseFraction,
} from "../domain/fractions.js";
import {
  fractionForShare,
  normalisePercentageInput,
  shareFromFraction,
  shareFromFractionInput,
  shareFromPercentage,
  shareFromPercentageInput,
} from "../domain/shares.js";
import { isValidIsoDate, isoDateToDisplay } from "../domain/dateFormat.js";
import { effectiveDateOfDeath } from "../domain/deceasedStatus.js";
import { genealogyDeathDateText } from "../domain/genealogyDates.js";
import { operativeWillFromRecords, personWills, personWithWills } from "../domain/wills.js";
import {
  validateRelationshipDateChronology,
  validateTransferDateChronology,
  validateWillDateChronology,
} from "../domain/chronology.js";
import { isLegacyHistoricalLawWarning } from "../domain/successionRules.js";
import {
  isPotentialParentSurvivalUnresolved,
  synchronisePotentialParentSurvival,
} from "../domain/potentialParentSurvival.js";
import {
  findPartnerRelationship,
  linkPartnerRelationship,
  PARTNER_RELATIONSHIP_TYPES,
  partnerLinkEligibility,
  partnerRelationshipStatusAt,
  removePartnerRelationship,
  upsertPartnerRelationship,
} from "../domain/partnerRelationships.js";
import {
  buildPropertyVendorTaxReport,
  buildTaxCalculationReport,
  ownerProvenanceTranches,
} from "../domain/propertyVendorTax.js";
import { selectTranchePortions } from "../domain/trancheOwnership.js";
import { tagStatusCreatedRecord } from "../domain/statusToggleSessions.js";
import { MARITAL_STATUS_AT_DEATH_SOURCES } from "../domain/maritalStatusAtDeath.js";
import { DateInput } from "./DateInput.jsx";
import { IntestacyProposal, IntestateHeirConfirmation } from "./IntestateHeirConfirmation.jsx";
import { OutsidePartyCreator } from "./OutsidePartyCreator.jsx";
import { CausaMortisSection } from "./personInspector/CausaMortisSection.jsx";
import { FinalWithholdingTaxSection } from "./personInspector/FinalWithholdingTaxSection.jsx";

const relationshipActions = [
  { key: "father", label: "Father", icon: UserRound },
  { key: "mother", label: "Mother", icon: UserRound },
  { key: "marriage", label: "Wife / husband", icon: Heart },
  { key: "partnership", label: "Partner", icon: Heart },
  { key: "child", label: "Child", icon: Baby },
  { key: "sibling", label: "Brother / sister", icon: UsersRound },
];

const shareDisplayMode = (value) =>
  ["fraction", "percentage", "both"].includes(value) ? value : "both";

const blankDonationDraft = () => ({
  kind: "donation",
  doneeMode: "existing",
  doneeType: "individual",
  doneeId: "",
  doneeName: "",
  doneeSex: "",
  doneeRegistrationNumber: "",
  numerator: "",
  denominator: "",
  percentage: "",
  amountType: "all-share",
  shareInputMode: "fraction",
  date: "",
  designation: {},
  error: "",
});

export const IDENTITY_DRAFT_COMMIT_DELAY_MS = 700;
export const PERSON_RECORD_DRAFT_COMMIT_DELAY_MS = 700;

const bufferedRecordFields = [
  "deathDateText",
  "dateOfDeathUnknown",
  "wills",
  "willDate",
  "willNotaryName",
  "willDescription",
  "willHeirs",
];

const sameBufferedValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const bufferedRecordPatchMatchesPerson = (record, person) =>
  record?.personId === person?.id &&
  Object.entries(record.patch || {}).every(([field, value]) =>
    sameBufferedValue(person?.[field], value),
  );

let bufferedPersonRecordEditSequence = 0;

/**
 * Keeps an individual text/number draft below PersonInspector so a keystroke
 * does not rerender the inspector or send the whole tree through App. The
 * parent-owned controller commits every registered field as one person patch.
 */
function BufferedPersonRecordInput({
  personId,
  value = "",
  onRegisterController,
  applyDraft,
  commitUnchangedOnBlur = false,
  formatDraftAfterCommit,
  retainTouchedDraft = false,
  ...inputProps
}) {
  const initialValue = String(value ?? "");
  const [draft, setDraft] = useState(initialValue);
  const draftRef = useRef(initialValue);
  const baseValueRef = useRef(initialValue);
  const dirtyRef = useRef(false);
  const valueChangedRef = useRef(false);
  const timerRef = useRef(null);
  const applyDraftRef = useRef(applyDraft);
  const formatDraftAfterCommitRef = useRef(formatDraftAfterCommit);
  const requestFlushRef = useRef(() => true);
  const controllerRef = useRef(null);

  applyDraftRef.current = applyDraft;
  formatDraftAfterCommitRef.current = formatDraftAfterCommit;

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    globalThis.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  if (!controllerRef.current) {
    controllerRef.current = {
      personId,
      sequence: 0,
      hasPending: () => dirtyRef.current,
      apply: (person) =>
        dirtyRef.current
          ? applyDraftRef.current(person, draftRef.current, {
              changed: valueChangedRef.current,
            })
          : person,
      acknowledge: () => {
        clearTimer();
        dirtyRef.current = false;
        valueChangedRef.current = false;
        const committedDraft = formatDraftAfterCommitRef.current
          ? String(formatDraftAfterCommitRef.current(draftRef.current) ?? "")
          : draftRef.current;
        draftRef.current = committedDraft;
        baseValueRef.current = committedDraft;
        setDraft(committedDraft);
      },
      flush: () => requestFlushRef.current(),
    };
  }

  useEffect(() => {
    if (dirtyRef.current) return;
    const nextValue = String(value ?? "");
    if (draftRef.current === nextValue) return;
    draftRef.current = nextValue;
    baseValueRef.current = nextValue;
    setDraft(nextValue);
  }, [value]);

  useEffect(() => {
    const controller = controllerRef.current;
    const registration = onRegisterController?.(controller);
    requestFlushRef.current = registration?.flush || (() => true);
    return () => {
      if (controller.hasPending()) requestFlushRef.current();
      registration?.unregister?.();
      clearTimer();
    };
  }, [clearTimer, onRegisterController]);

  const updateDraft = (nextValue) => {
    draftRef.current = nextValue;
    dirtyRef.current = retainTouchedDraft || nextValue !== baseValueRef.current;
    valueChangedRef.current = retainTouchedDraft || nextValue !== baseValueRef.current;
    controllerRef.current.sequence = ++bufferedPersonRecordEditSequence;
    setDraft(nextValue);
    clearTimer();
    if (dirtyRef.current) {
      timerRef.current = globalThis.setTimeout(() => {
        timerRef.current = null;
        if (dirtyRef.current) requestFlushRef.current();
      }, PERSON_RECORD_DRAFT_COMMIT_DELAY_MS);
    }
  };

  const { onBlur, ...restInputProps } = inputProps;
  return (
    <input
      {...restInputProps}
      value={draft}
      onChange={(event) => updateDraft(event.target.value)}
      onBlur={(event) => {
        if (commitUnchangedOnBlur && !dirtyRef.current) {
          dirtyRef.current = true;
          valueChangedRef.current = false;
          controllerRef.current.sequence = ++bufferedPersonRecordEditSequence;
        }
        requestFlushRef.current();
        onBlur?.(event);
      }}
    />
  );
}

const personWithBufferedDeathDateText = (person, value) => ({
  ...person,
  deathDateText: value,
  dateOfDeathUnknown: false,
});

const personWithBufferedWillField = (person, willId, field, value) => {
  const wills = personWills(person);
  const sourceWills = wills.length
    ? wills
    : [{ id: willId, date: "", notaryName: "", description: "" }];
  return personWithWills(
    person,
    sourceWills.map((will) => (will.id === willId ? { ...will, [field]: value } : will)),
  );
};

const withoutTransientShareInput = (share) => {
  const persistedShare = { ...share };
  delete persistedShare.sharePercentInput;
  return persistedShare;
};

const personWithBufferedWillHeirFraction = (person, heirId, field, value) => ({
  ...person,
  willHeirs: (person.willHeirs || []).map((heir) =>
    heir.id === heirId
      ? withoutTransientShareInput({
          ...heir,
          ...shareFromFractionInput(heir, { [field]: value }),
        })
      : heir,
  ),
});

const personWithBufferedWillHeirPercentage = (person, heirId, value, { changed } = {}) => ({
  ...person,
  willHeirs: (person.willHeirs || []).map((heir) => {
    if (heir.id !== heirId) return heir;
    return withoutTransientShareInput({
      ...heir,
      ...shareFromFractionInput(
        changed ? { ...heir, ...shareFromPercentageInput(value) } : heir,
        {},
      ),
    });
  }),
});

const identityDraftFromPerson = (person = {}) => {
  const surname = personSurname(person);
  return {
    personId: person.id || "",
    givenNames: personGivenNames(person),
    surname,
    surnameAtBirth:
      person.surnameAtBirthReviewRequired === true
        ? person.surnameAtBirth || ""
        : person.surnameAtBirth || (person.sex === "Male" ? surname : ""),
  };
};

const identityDraftEquals = (left, right) =>
  left.personId === right.personId &&
  left.givenNames === right.givenNames &&
  left.surname === right.surname &&
  left.surnameAtBirth === right.surnameAtBirth;

const identityPatchMatchesPerson = (patch, person) =>
  Object.entries(patch || {}).every(([field, value]) => person?.[field] === value);

function identityPatchFromDraft(person, draft, dirtyFields) {
  const patch = {};
  const givenNames = dirtyFields.has("givenNames") ? draft.givenNames : personGivenNames(person);
  const surname = dirtyFields.has("surname") ? draft.surname : personSurname(person);

  if (dirtyFields.has("givenNames")) patch.givenNames = givenNames;
  if (dirtyFields.has("surname")) patch.surname = surname;
  if (dirtyFields.has("givenNames") || dirtyFields.has("surname")) {
    patch.fullName = composeFullName(givenNames, surname);
  }

  if (dirtyFields.has("surnameAtBirth")) {
    const needsBirthSurname = person.gedcomUnmarriedParents === true || person.sex === "Female";
    patch.surnameAtBirth = draft.surnameAtBirth;
    patch.surnameAtBirthReviewRequired = needsBirthSurname && !draft.surnameAtBirth.trim();
  } else if (
    dirtyFields.has("surname") &&
    person.sex === "Male" &&
    !person.surnameAtBirthReviewRequired &&
    (!person.surnameAtBirth || person.surnameAtBirth === personSurname(person))
  ) {
    patch.surnameAtBirth = surname;
  }

  return patch;
}

function BufferedIdentityFields({
  person,
  disabled,
  legalWorkspaceEnabled,
  onCommit,
  onRegisterPendingEditFlush,
}) {
  const initialDraft = identityDraftFromPerson(person);
  const [draft, setDraft] = useState(initialDraft);
  const draftRef = useRef(initialDraft);
  const baseDraftRef = useRef(initialDraft);
  const draftPersonRef = useRef(person);
  const latestPersonRef = useRef(person);
  const dirtyFieldsRef = useRef(new Set());
  const committedIdentityPatchRef = useRef(null);
  const commitTimerRef = useRef(null);
  const onCommitRef = useRef(onCommit);
  const commitRef = useRef(() => true);
  const overlayPeopleRef = useRef((sourcePeople) => sourcePeople);
  const acknowledgeOverlayRef = useRef(() => true);

  latestPersonRef.current = person;
  onCommitRef.current = onCommit;

  const clearCommitTimer = useCallback(() => {
    if (commitTimerRef.current === null) return;
    globalThis.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
  }, []);

  const currentIdentityOverlay = () => {
    const currentDraft = draftRef.current;
    const latestPerson = latestPersonRef.current;
    const draftPerson =
      latestPerson?.id === currentDraft.personId ? latestPerson : draftPersonRef.current;
    if (!draftPerson?.id) return null;
    const committed = committedIdentityPatchRef.current;
    const committedPatch =
      committed?.personId === currentDraft.personId ? committed.patch || {} : {};
    return {
      personId: currentDraft.personId,
      patch: {
        ...committedPatch,
        ...identityPatchFromDraft(draftPerson, currentDraft, new Set(dirtyFieldsRef.current)),
      },
    };
  };

  acknowledgeOverlayRef.current = (commitResult = null) => {
    clearCommitTimer();
    const overlay = currentIdentityOverlay();
    if (overlay && Object.keys(overlay.patch).length) {
      const committedPerson = Array.isArray(commitResult?.people)
        ? commitResult.people.find((candidate) => candidate.id === overlay.personId)
        : null;
      const committedPatch = committedPerson
        ? Object.fromEntries(
            Object.keys(overlay.patch).map((field) => [field, committedPerson[field]]),
          )
        : overlay.patch;
      committedIdentityPatchRef.current = {
        ...overlay,
        patch: committedPatch,
      };
    }
    dirtyFieldsRef.current.clear();
    baseDraftRef.current = draftRef.current;
    return true;
  };

  overlayPeopleRef.current = (sourcePeople = []) => {
    const overlay = currentIdentityOverlay();
    if (!overlay || !Object.keys(overlay.patch).length) return sourcePeople;
    return sourcePeople.map((candidate) =>
      candidate.id === overlay.personId ? { ...candidate, ...overlay.patch } : candidate,
    );
  };

  commitRef.current = (additionalPatch = null) => {
    clearCommitTimer();
    const dirtyFields = new Set(dirtyFieldsRef.current);
    const hasAdditionalPatch =
      additionalPatch && typeof additionalPatch === "object" && Object.keys(additionalPatch).length;
    if (!dirtyFields.size && !hasAdditionalPatch) return true;

    const overlay = currentIdentityOverlay();
    if (!overlay?.personId) return false;

    let committed;
    try {
      committed = onCommitRef.current?.(overlay.personId, {
        ...overlay.patch,
        ...(hasAdditionalPatch ? additionalPatch : {}),
      });
    } catch {
      return false;
    }
    if (committed === false || committed === null) return false;

    acknowledgeOverlayRef.current(committed);
    return committed ?? true;
  };

  const commitDraft = useCallback(() => commitRef.current(), []);
  const commitDraftWithPatch = useCallback((patch) => commitRef.current(patch), []);
  const hasPendingDraft = useCallback(() => dirtyFieldsRef.current.size > 0, []);
  const hasIdentityOverlay = useCallback(
    () =>
      dirtyFieldsRef.current.size > 0 ||
      Boolean(Object.keys(committedIdentityPatchRef.current?.patch || {}).length),
    [],
  );
  const getIdentityOverlayPersonId = useCallback(() => draftRef.current.personId || "", []);
  const overlayPeople = useCallback((sourcePeople) => overlayPeopleRef.current(sourcePeople), []);
  const acknowledgeOverlay = useCallback(
    (commitResult) => acknowledgeOverlayRef.current(commitResult),
    [],
  );

  useEffect(() => {
    if (!onRegisterPendingEditFlush) return undefined;
    return onRegisterPendingEditFlush({
      flush: commitDraft,
      flushWithPatch: commitDraftWithPatch,
      hasPending: hasPendingDraft,
      hasIdentityOverlay,
      getIdentityOverlayPersonId,
      overlayPeople,
      acknowledgeOverlay,
    });
  }, [
    acknowledgeOverlay,
    commitDraft,
    commitDraftWithPatch,
    getIdentityOverlayPersonId,
    hasIdentityOverlay,
    hasPendingDraft,
    onRegisterPendingEditFlush,
    overlayPeople,
  ]);

  useEffect(() => {
    const nextDraft = identityDraftFromPerson(person);
    if (draftRef.current.personId !== nextDraft.personId) {
      commitDraft();
      dirtyFieldsRef.current.clear();
      committedIdentityPatchRef.current = null;
      draftRef.current = nextDraft;
      baseDraftRef.current = nextDraft;
      draftPersonRef.current = person;
      setDraft(nextDraft);
      return;
    }
    const committed = committedIdentityPatchRef.current;
    if (
      committed?.personId === nextDraft.personId &&
      identityPatchMatchesPerson(committed.patch, person)
    ) {
      committedIdentityPatchRef.current = null;
    }
    if (
      dirtyFieldsRef.current.size === 0 &&
      !committedIdentityPatchRef.current &&
      !identityDraftEquals(draftRef.current, nextDraft)
    ) {
      draftRef.current = nextDraft;
      baseDraftRef.current = nextDraft;
      draftPersonRef.current = person;
      setDraft(nextDraft);
    }
  }, [
    commitDraft,
    person,
    person.givenNames,
    person.id,
    person.sex,
    person.surname,
    person.surnameAtBirth,
    person.surnameAtBirthReviewRequired,
  ]);

  useEffect(() => {
    const warnAboutPendingIdentity = (event) => {
      if (!dirtyFieldsRef.current.size) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnAboutPendingIdentity);
    return () => {
      window.removeEventListener("beforeunload", warnAboutPendingIdentity);
      // The App flushes registered editors before disposing its save queue.
      // This remains as a final safety net for standalone/programmatic unmounts.
      commitRef.current();
      clearCommitTimer();
    };
  }, [clearCommitTimer]);

  const updateDraft = (field, value) => {
    const nextDraft = { ...draftRef.current, [field]: value };
    const dirtyFields = dirtyFieldsRef.current;
    if (value === baseDraftRef.current[field]) dirtyFields.delete(field);
    else dirtyFields.add(field);

    if (
      field === "surname" &&
      !dirtyFields.has("surnameAtBirth") &&
      person.sex === "Male" &&
      !person.surnameAtBirthReviewRequired &&
      (!person.surnameAtBirth || person.surnameAtBirth === personSurname(person))
    ) {
      nextDraft.surnameAtBirth = value;
    }

    draftRef.current = nextDraft;
    setDraft(nextDraft);
    clearCommitTimer();
    if (dirtyFields.size) {
      commitTimerRef.current = globalThis.setTimeout(() => {
        commitTimerRef.current = null;
        commitRef.current();
      }, IDENTITY_DRAFT_COMMIT_DELAY_MS);
    }
  };

  return (
    <fieldset
      className="person-edit-fields"
      disabled={disabled}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) commitDraft();
      }}
    >
      <div className="inspector-fields">
        <label>
          <span>Name</span>
          <input
            data-person-field="given-names"
            autoFocus={!draft.givenNames}
            value={draft.givenNames}
            onChange={(event) => updateDraft("givenNames", event.target.value)}
            placeholder="Given name or names"
          />
        </label>
        <label>
          <span>Surname</span>
          <input
            data-person-field="surname"
            value={draft.surname}
            onChange={(event) => updateDraft("surname", event.target.value)}
            placeholder="Current surname"
          />
        </label>
        <label
          className={
            legalWorkspaceEnabled && person.surnameAtBirthReviewRequired
              ? "surname-at-birth-review-field"
              : undefined
          }
        >
          <span>Surname at birth</span>
          <input
            data-person-field="surname-at-birth"
            value={draft.surnameAtBirth}
            onChange={(event) => updateDraft("surnameAtBirth", event.target.value)}
            placeholder={person.sex === "Male" ? "Same as current surname" : ""}
          />
          {legalWorkspaceEnabled && person.surnameAtBirthReviewRequired && (
            <small className="surname-at-birth-review-note">
              The imported parents are recorded as unmarried. Confirm this surname.
            </small>
          )}
        </label>
      </div>
    </fieldset>
  );
}

const transferDraftFromRecord = (transfer = {}, amountFraction = null) => ({
  ...blankDonationDraft(),
  kind: transfer.kind === "sale" ? "sale" : "donation",
  doneeMode: "existing",
  doneeId: transfer.buyerId || "",
  numerator: String(amountFraction?.numerator ?? transfer.numerator ?? ""),
  denominator: String(amountFraction?.denominator ?? transfer.denominator ?? ""),
  amountType: "defined-share",
  shareInputMode: "fraction",
  date: transfer.date || "",
  designation: Object.fromEntries(
    (transfer.provenance || [])
      .filter((portion) => portion?.trancheId)
      .map((portion) => [
        portion.trancheId,
        {
          checked: true,
          numerator: String(portion.numerator ?? ""),
          denominator: String(portion.denominator ?? ""),
        },
      ]),
  ),
});

function initials(name) {
  const value = String(name || "").trim();
  if (!value) return "?";
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function ownershipLabel(
  share = 0,
  shareDisplay = "both",
  exactFraction = null,
  displayPercentageLabel = "",
) {
  const fractionText = formatOwnershipFraction(share, exactFraction);
  const percentageText = displayPercentageLabel || formatOwnershipPercentage(share, exactFraction);
  if (shareDisplay === "fraction") return fractionText;
  if (shareDisplay === "percentage") return percentageText;
  return `${fractionText} · ${percentageText}`;
}

const money = new Intl.NumberFormat("en-MT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

export function PersonInspector({
  people,
  legalWorkspaceEnabled = true,
  properties = [],
  vendorReport = null,
  taxCalculationReport = null,
  ownershipByPerson = {},
  ownershipFractionsByPerson = {},
  currentOwnerPresentationsByPerson = null,
  causaMortisCoverage = [],
  selectedPersonId,
  shareDisplay = "both",
  onShareDisplayChange,
  retainedIdentityLabels = [],
  familyPersonIds = null,
  personFamilyGroupCount = 1,
  outsideParties = [],
  onChange,
  onOutsidePartiesChange,
  onRecordDonation,
  onUpdateInterVivosTransfer,
  onDeleteInterVivosTransfer,
  deceasedStatusSession = null,
  interVivosStatusSession = null,
  onDeceasedStatusChange,
  onInterVivosStatusChange,
  onConfirmInitialAcquisition,
  onConfirmDonationAcquisitionValue,
  onSelectPerson,
  onSelectOutsideOwner,
  onDeletePerson,
  onRegisterPendingEditFlush,
}) {
  const [spouseChooserOpen, setSpouseChooserOpen] = useState(false);
  const [partnerRelationshipType, setPartnerRelationshipType] = useState(
    PARTNER_RELATIONSHIP_TYPES.MARRIAGE,
  );
  const [existingSpouseId, setExistingSpouseId] = useState("");
  const [childPartnerChooserOpen, setChildPartnerChooserOpen] = useState(false);
  const [childPartnerId, setChildPartnerId] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [causaMortisErrors, setCausaMortisErrors] = useState({});
  const [willOutsidePartyOpen, setWillOutsidePartyOpen] = useState(false);
  const [ownershipDisplay, setOwnershipDisplay] = useState(shareDisplayMode(shareDisplay));
  const [donationOpen, setDonationOpen] = useState(false);
  const [donationDraft, setDonationDraft] = useState(blankDonationDraft);
  const [editingTransferId, setEditingTransferId] = useState("");
  const identityDraftControllerRef = useRef(null);
  const personRecordInputControllersRef = useRef(new Set());
  const committedPersonRecordPatchesRef = useRef(new Map());
  const flushPersonRecordDraftsRef = useRef(() => true);
  const overlayPersonRecordRef = useRef((person) => person);
  const acknowledgePersonRecordRef = useRef(() => true);
  const personRecordControllerRef = useRef(null);
  const personDraftControllerRef = useRef(null);
  if (!personRecordControllerRef.current) {
    personRecordControllerRef.current = {
      flush: () => flushPersonRecordDraftsRef.current(),
      flushWithPatch: (patch) => flushPersonRecordDraftsRef.current(patch),
      hasPending: () =>
        [...personRecordInputControllersRef.current].some((controller) => controller.hasPending()),
      hasRecordOverlay: () =>
        committedPersonRecordPatchesRef.current.size > 0 ||
        [...personRecordInputControllersRef.current].some((controller) => controller.hasPending()),
      overlayPeople: (sourcePeople = []) =>
        sourcePeople.map((person) => overlayPersonRecordRef.current(person)),
      acknowledgeOverlay: (commitResult) => acknowledgePersonRecordRef.current(commitResult),
    };
  }
  if (!personDraftControllerRef.current) {
    personDraftControllerRef.current = {
      flush: () => {
        const recordController = personRecordControllerRef.current;
        const result = recordController?.hasPending?.()
          ? recordController.flush()
          : (identityDraftControllerRef.current?.flush?.() ?? true);
        return result !== false && result !== null;
      },
      hasPending: () =>
        Boolean(
          personRecordControllerRef.current?.hasPending?.() ||
          identityDraftControllerRef.current?.hasPending?.(),
        ),
    };
  }
  const registerPersonRecordInputController = useCallback((controller) => {
    personRecordInputControllersRef.current.add(controller);
    return {
      flush: () => flushPersonRecordDraftsRef.current(null, controller.personId),
      unregister: () => personRecordInputControllersRef.current.delete(controller),
    };
  }, []);
  const registerIdentityDraftController = useCallback((controller) => {
    identityDraftControllerRef.current = controller;
    return () => {
      if (identityDraftControllerRef.current === controller) {
        identityDraftControllerRef.current = null;
      }
    };
  }, []);
  useEffect(() => {
    if (!onRegisterPendingEditFlush) return undefined;
    return onRegisterPendingEditFlush(personDraftControllerRef.current);
  }, [onRegisterPendingEditFlush]);
  const selectedPerson =
    people.find((person) => person.id === selectedPersonId) ||
    (familyPersonIds === null ? people[0] : undefined);
  for (const [personId, committedPatch] of committedPersonRecordPatchesRef.current) {
    const canonicalPerson = people.find((person) => person.id === personId);
    if (!canonicalPerson || bufferedRecordPatchMatchesPerson(committedPatch, canonicalPerson)) {
      committedPersonRecordPatchesRef.current.delete(personId);
    }
  }
  const effectiveSelectedDeathDate = selectedPerson
    ? effectiveDateOfDeath(people, selectedPerson.id)
    : "";
  const selectedPersonIdentityIssues = useMemo(() => {
    if (!selectedPerson) return [];
    const issues = personIdentityIssues(selectedPerson);
    return legalWorkspaceEnabled ? issues : issues.filter((issue) => issue !== "Surname at birth");
  }, [legalWorkspaceEnabled, selectedPerson]);
  const currentFamilyPersonIds = Array.isArray(familyPersonIds)
    ? familyPersonIds
    : people.map((person) => person.id);
  const currentFamilyPersonIdSet = new Set(currentFamilyPersonIds);
  const sharedAcrossFamilies = personFamilyGroupCount > 1;
  const previousSelectedPersonIdRef = useRef("");
  const displayName = useCallback((person) => personDisplayName(person, people), [people]);
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const outsidePartiesById = useMemo(
    () => new Map(outsideParties.map((party) => [party.id, party])),
    [outsideParties],
  );
  const partyDisplayName = useCallback(
    (partyOrPerson) =>
      partyOrPerson?.fullName ||
      partyOrPerson?.name ||
      (partyOrPerson?.type === "company" ? "Unnamed company" : "Unnamed person"),
    [],
  );
  const displayParty = useCallback(
    (partyOrPerson) =>
      partyOrPerson && peopleById.has(partyOrPerson.id)
        ? displayName(partyOrPerson)
        : partyDisplayName(partyOrPerson),
    [displayName, partyDisplayName, peopleById],
  );
  const personSelectionLabel = useCallback(
    (partyOrPerson) =>
      partyOrPerson && peopleById.has(partyOrPerson.id)
        ? personChoiceLabel(partyOrPerson, people)
        : partyDisplayName(partyOrPerson),
    [partyDisplayName, people, peopleById],
  );
  const parentSuggestions = useMemo(() => solePartnerParentSuggestions(people), [people]);
  const relevantParentSuggestions = useMemo(
    () =>
      selectedPerson
        ? parentSuggestions.filter(
            (suggestion) =>
              suggestion.personId === selectedPerson.id ||
              suggestion.viaParentId === selectedPerson.id ||
              suggestion.suggestedPersonId === selectedPerson.id,
          )
        : [],
    [parentSuggestions, selectedPerson],
  );
  const missingIntestateParentRoles = useMemo(
    () =>
      legalWorkspaceEnabled && selectedPerson
        ? missingPotentialIntestateParents(people, selectedPerson.id)
        : [],
    [legalWorkspaceEnabled, people, selectedPerson],
  );
  const resolvedTaxCalculationReport = useMemo(() => {
    if (!legalWorkspaceEnabled || !properties[0]) return null;
    return (
      taxCalculationReport ||
      buildTaxCalculationReport(properties[0], people, outsideParties, vendorReport)
    );
  }, [
    legalWorkspaceEnabled,
    outsideParties,
    people,
    properties,
    taxCalculationReport,
    vendorReport,
  ]);
  const selectedVendorTax = useMemo(() => {
    if (!selectedPerson || !resolvedTaxCalculationReport) return null;
    return (
      resolvedTaxCalculationReport.vendors.find((vendor) => vendor.id === selectedPerson.id) || null
    );
  }, [resolvedTaxCalculationReport, selectedPerson]);

  useEffect(() => {
    const nextPersonId = selectedPerson?.id || "";
    const hasSavedOutgoingTransfer = Boolean(
      selectedPerson &&
      (properties[0]?.transfers || []).some((transfer) => transfer.sellerId === selectedPerson.id),
    );
    if (previousSelectedPersonIdRef.current === nextPersonId) {
      if (interVivosStatusSession && !hasSavedOutgoingTransfer) setDonationOpen(true);
      return;
    }
    previousSelectedPersonIdRef.current = nextPersonId;
    setSpouseChooserOpen(false);
    setPartnerRelationshipType(PARTNER_RELATIONSHIP_TYPES.MARRIAGE);
    setExistingSpouseId("");
    setChildPartnerChooserOpen(false);
    setChildPartnerId("");
    setCausaMortisErrors({});
    setWillOutsidePartyOpen(false);
    setDonationOpen(Boolean(interVivosStatusSession) && !hasSavedOutgoingTransfer);
    setDonationDraft(blankDonationDraft());
    setEditingTransferId("");
    setIsEditing(selectedPersonIdentityIssues.length > 0);
  }, [interVivosStatusSession, properties, selectedPerson, selectedPersonIdentityIssues]);

  useEffect(() => {
    setOwnershipDisplay(shareDisplayMode(shareDisplay));
  }, [shareDisplay]);

  const createMissingIntestateParents = () => {
    if (!selectedPerson || !missingIntestateParentRoles.length) return;
    const sourcePeople = peopleWithIdentityOverlay(people);
    const sourceSelected =
      sourcePeople.find((person) => person.id === selectedPerson.id) || selectedPerson;
    const stampedPeople = stampUnsignedIntestacyContexts(sourcePeople);
    const subjectName = personGivenNames(sourceSelected).trim() || displayName(sourceSelected);
    const selectedPatch = {};
    const createdParents = missingIntestateParentRoles.map((role) => {
      const relationship = role === "mother" ? "Mother" : "Father";
      const parent = tagStatusCreatedRecord(createPerson("Parent"), deceasedStatusSession, {
        role: "potential-parent",
      });
      Object.assign(parent, {
        givenNames: `${relationship} of ${subjectName}`,
        fullName: `${relationship} of ${subjectName}`,
        sex: role === "mother" ? "Female" : "Male",
        isPotentialIntestateParent: true,
        potentialParentAddedExplicitly: true,
        survivalStatusRequired: true,
        survivalStatusReferencePersonId: sourceSelected.id,
      });
      selectedPatch[`${role}Id`] = parent.id;
      selectedPatch[`${role}ExplicitlyUnassigned`] = false;
      return parent;
    });
    commitPeopleChange([
      ...stampedPeople.map((person) =>
        person.id === sourceSelected.id ? { ...person, ...selectedPatch } : person,
      ),
      ...createdParents,
    ]);
  };

  const stampUnsignedIntestacyContexts = (sourcePeople = peopleWithIdentityOverlay(people)) =>
    legalWorkspaceEnabled
      ? sourcePeople.map((person) => {
          if (
            !Array.isArray(person.intestateHeirs) ||
            !person.intestateHeirs.length ||
            person.intestateHeirsConfirmed !== true ||
            String(person.intestateConfirmationBasis || "").trim()
          ) {
            return person;
          }
          const calculated = intestateAllocations(sourcePeople, person.id);
          return {
            ...person,
            intestateConfirmationBasis: intestacyLegalContextSignature(person, calculated),
          };
        })
      : sourcePeople;

  const updatePerson = (personId, patch) => {
    // Migrate unsigned edited-beneficiary rows against the facts that existed
    // immediately before this edit. If this edit changes a death, marriage or
    // family context, the old manual override becomes visibly stale instead of
    // silently defeating the recalculated statutory shares.
    const stampedPeople = stampUnsignedIntestacyContexts();
    return onChange(
      stampedPeople.map((person) => {
        if (person.id !== personId) return person;
        const updated = { ...person, ...patch };
        return legalWorkspaceEnabled ? synchronisePotentialParentSurvival(updated) : updated;
      }),
    );
  };

  const updatePersonFromIdentityDraft = (personId, patch) => {
    const recordDraftWasPending = [...personRecordInputControllersRef.current].some(
      (controller) => controller.personId === personId && controller.hasPending(),
    );
    const committed = updatePerson(personId, patch);
    if (recordDraftWasPending && committed !== false && committed !== null) {
      acknowledgePersonRecordRef.current(committed, personId);
    }
    return committed;
  };

  const recordPatchFromOverlay = (basePerson, overlaidPerson) =>
    Object.fromEntries(
      bufferedRecordFields
        .filter((field) => !sameBufferedValue(basePerson?.[field], overlaidPerson?.[field]))
        .map((field) => [field, overlaidPerson?.[field]]),
    );

  overlayPersonRecordRef.current = (person) => {
    if (!person?.id) return person;
    let overlaid = person;
    const committed = committedPersonRecordPatchesRef.current.get(person.id);
    if (committed) overlaid = { ...overlaid, ...committed.patch };
    const pendingControllers = [...personRecordInputControllersRef.current]
      .filter((controller) => controller.personId === person.id && controller.hasPending())
      .sort((first, second) => first.sequence - second.sequence);
    for (const controller of pendingControllers) {
      if (controller.personId === person.id) {
        overlaid = controller.apply(overlaid);
      }
    }
    return overlaid;
  };

  const commitPersonPatchWithIdentity = (personId, patch) => {
    const identityController = identityDraftControllerRef.current;
    if (
      identityController?.getIdentityOverlayPersonId?.() === personId &&
      identityController?.hasIdentityOverlay?.() &&
      identityController.flushWithPatch
    ) {
      return identityController.flushWithPatch(patch);
    }
    return updatePerson(personId, patch);
  };

  acknowledgePersonRecordRef.current = (commitResult = null, targetPersonId = "") => {
    const basePerson = targetPersonId
      ? people.find((person) => person.id === targetPersonId)
      : selectedPerson;
    if (!basePerson) return false;
    const overlaidPerson = overlayPersonRecordRef.current(basePerson);
    const patch = recordPatchFromOverlay(basePerson, overlaidPerson);
    const committedPerson = Array.isArray(commitResult?.people)
      ? commitResult.people.find((candidate) => candidate.id === basePerson.id)
      : null;
    for (const controller of personRecordInputControllersRef.current) {
      if (controller.personId === basePerson.id) controller.acknowledge();
    }
    if (Object.keys(patch).length) {
      committedPersonRecordPatchesRef.current.set(basePerson.id, {
        personId: basePerson.id,
        patch: Object.fromEntries(
          Object.keys(patch).map((field) => [
            field,
            committedPerson ? committedPerson[field] : overlaidPerson[field],
          ]),
        ),
      });
    } else {
      committedPersonRecordPatchesRef.current.delete(basePerson.id);
    }
    return true;
  };

  flushPersonRecordDraftsRef.current = (additionalPatch = null, targetPersonId = "") => {
    const basePerson = targetPersonId
      ? people.find((person) => person.id === targetPersonId)
      : selectedPerson;
    if (!basePerson) return false;
    const overlaidPerson = overlayPersonRecordRef.current(basePerson);
    const recordPatch = recordPatchFromOverlay(basePerson, overlaidPerson);
    const hasAdditionalPatch =
      additionalPatch && typeof additionalPatch === "object" && Object.keys(additionalPatch).length;
    if (!Object.keys(recordPatch).length && !hasAdditionalPatch) {
      const identityController = identityDraftControllerRef.current;
      if (
        identityController?.getIdentityOverlayPersonId?.() === basePerson.id &&
        identityController?.hasPending?.()
      ) {
        return identityController.flush();
      }
      for (const controller of personRecordInputControllersRef.current) {
        if (controller.personId === basePerson.id) controller.acknowledge();
      }
      return true;
    }

    let committed;
    try {
      committed = commitPersonPatchWithIdentity(basePerson.id, {
        ...recordPatch,
        ...(hasAdditionalPatch ? additionalPatch : {}),
      });
    } catch {
      return false;
    }
    if (committed === false || committed === null) return false;

    const committedPerson = Array.isArray(committed?.people)
      ? committed.people.find((candidate) => candidate.id === basePerson.id)
      : null;
    for (const controller of personRecordInputControllersRef.current) {
      if (controller.personId === basePerson.id) controller.acknowledge();
    }
    const retainedFields = new Set([
      ...Object.keys(recordPatch),
      ...Object.keys(additionalPatch || {}).filter((field) => bufferedRecordFields.includes(field)),
    ]);
    if (retainedFields.size) {
      committedPersonRecordPatchesRef.current.set(basePerson.id, {
        personId: basePerson.id,
        patch: Object.fromEntries(
          [...retainedFields].map((field) => [
            field,
            committedPerson
              ? committedPerson[field]
              : ((additionalPatch || {})[field] ?? overlaidPerson[field]),
          ]),
        ),
      });
    } else {
      committedPersonRecordPatchesRef.current.delete(basePerson.id);
    }
    return committed;
  };

  const updateSelected = (patch) => {
    if (!selectedPerson) return;
    const recordController = personRecordControllerRef.current;
    if (recordController?.hasRecordOverlay?.() && recordController.flushWithPatch) {
      return recordController.flushWithPatch(patch);
    }
    return commitPersonPatchWithIdentity(selectedPerson.id, patch);
  };

  const selectedPersonWithPendingRecordEdits = () =>
    overlayPersonRecordRef.current(selectedPerson) || selectedPerson;

  const peopleWithIdentityOverlay = (nextPeople) => {
    const identityController = identityDraftControllerRef.current;
    const identityOverlaidPeople = identityController?.overlayPeople
      ? identityController.overlayPeople(nextPeople)
      : nextPeople;
    return personRecordControllerRef.current?.overlayPeople
      ? personRecordControllerRef.current.overlayPeople(identityOverlaidPeople)
      : identityOverlaidPeople;
  };

  const acknowledgeIdentityOverlay = (committed) => {
    if (committed !== false && committed !== null) {
      identityDraftControllerRef.current?.acknowledgeOverlay?.(committed);
      personRecordControllerRef.current?.acknowledgeOverlay?.(committed);
    }
    return committed;
  };

  const commitPeopleChange = (nextPeople) =>
    acknowledgeIdentityOverlay(onChange(peopleWithIdentityOverlay(nextPeople)));

  const acceptParentSuggestion = (suggestion) => {
    const suggestedPeople = applyParentSuggestions(stampUnsignedIntestacyContexts(), [suggestion]);
    if (suggestion.field !== "fatherId") {
      commitPeopleChange(suggestedPeople);
      return;
    }

    const father = suggestedPeople.find((person) => person.id === suggestion.suggestedPersonId);
    commitPeopleChange(
      suggestedPeople.map((person) =>
        person.id === suggestion.personId
          ? { ...person, ...fatherSurnameDefaultPatch(person, father) }
          : person,
      ),
    );
  };

  const dismissParentSuggestion = (suggestion) => {
    const flag =
      suggestion.field === "motherId" ? "motherExplicitlyUnassigned" : "fatherExplicitlyUnassigned";
    commitPeopleChange(
      stampUnsignedIntestacyContexts().map((person) =>
        person.id === suggestion.personId ? { ...person, [flag]: true } : person,
      ),
    );
  };

  const updateSex = (sex) => {
    const identityPerson = peopleWithIdentityOverlay([selectedPerson])[0] || selectedPerson;
    const patch = { sex };
    if (sex === "Male" && !identityPerson.surnameAtBirth) {
      if (identityPerson.gedcomUnmarriedParents !== true) {
        patch.surnameAtBirth = personSurname(identityPerson);
        patch.surnameAtBirthReviewRequired = false;
      }
    }
    if (sex === "Female" && !String(identityPerson.surnameAtBirth || "").trim()) {
      patch.surnameAtBirthReviewRequired = true;
    }
    updateSelected(patch);
  };

  const changeOwnershipDisplay = (mode) => {
    const recordController = personRecordControllerRef.current;
    if (recordController?.hasPending?.()) {
      const committed = recordController.flush();
      if (committed === false || committed === null) return false;
    }
    setOwnershipDisplay(mode);
    onShareDisplayChange?.(mode);
    return true;
  };

  const updateWillHeir = (heirId, patch) => {
    const sourcePerson = selectedPersonWithPendingRecordEdits();
    updateSelected({
      willHeirs: (sourcePerson.willHeirs || []).map((heir) =>
        heir.id === heirId ? { ...heir, ...patch } : heir,
      ),
    });
  };

  const writeWills = (wills) => {
    const updated = personWithWills(selectedPersonWithPendingRecordEdits(), wills);
    updateSelected({
      wills: updated.wills,
      willDate: updated.willDate,
      willNotaryName: updated.willNotaryName,
      willDescription: updated.willDescription,
    });
  };

  const addWill = () => {
    const sourcePerson = selectedPersonWithPendingRecordEdits();
    writeWills([
      ...personWills(sourcePerson),
      {
        id: crypto.randomUUID(),
        date: "",
        notaryName: "",
        description: "",
      },
    ]);
  };

  const updateWill = (willId, patch) => {
    const currentWills = personWills(selectedPersonWithPendingRecordEdits());
    if (!currentWills.length) {
      writeWills([
        { id: crypto.randomUUID(), date: "", notaryName: "", description: "", ...patch },
      ]);
      return;
    }
    writeWills(currentWills.map((will) => (will.id === willId ? { ...will, ...patch } : will)));
  };

  const removeWill = (willId) => {
    writeWills(
      personWills(selectedPersonWithPendingRecordEdits()).filter((will) => will.id !== willId),
    );
  };

  const addWillHeir = () => {
    const sourcePerson = selectedPersonWithPendingRecordEdits();
    const hasHeirs = (sourcePerson.willHeirs || []).length > 0;
    const share = shareFromPercentage(hasHeirs ? 0 : 100);
    updateSelected({
      willHeirs: [
        ...(sourcePerson.willHeirs || []),
        {
          id: crypto.randomUUID(),
          personId: "",
          ...share,
        },
      ],
    });
  };

  const removeWillHeir = (heirId) => {
    const sourcePerson = selectedPersonWithPendingRecordEdits();
    updateSelected({
      willHeirs: (sourcePerson.willHeirs || []).filter((heir) => heir.id !== heirId),
    });
  };

  const addCausaMortisDeclaration = (requestedPropertyId = "") => {
    const requestedCoverage = requestedPropertyId
      ? causaMortisCoverage.find((row) => row.propertyId === requestedPropertyId)
      : null;
    const coverageTarget =
      requestedCoverage ||
      causaMortisCoverage.find((row) => row.status === "under" || row.status === "mixed");
    const propertyId =
      requestedPropertyId ||
      coverageTarget?.propertyId ||
      (properties.length === 1 ? properties[0].id : "");
    const hasExactRemainingCoverage =
      coverageTarget?.remainingFraction?.denominator &&
      compareFractions(coverageTarget.remainingFraction, ZERO_FRACTION) > 0;
    const hasRemainingCoverage =
      Boolean(hasExactRemainingCoverage) ||
      coverageTarget?.status === "under" ||
      coverageTarget?.status === "mixed";
    const remainingShare = hasExactRemainingCoverage
      ? fractionToNumber(coverageTarget.remainingFraction)
      : hasRemainingCoverage
        ? Math.max(
            0,
            Number(coverageTarget?.requiredShare || 0) - Number(coverageTarget?.declaredShare || 0),
          ) || Math.abs(Number(coverageTarget?.difference) || 0)
        : 0;
    const remainingFraction = hasExactRemainingCoverage
      ? coverageTarget.remainingFraction
      : approximateFraction(remainingShare);
    const prefillRemainingShare = Boolean(hasRemainingCoverage);
    const isAdditionalDeclaration = (selectedPerson.causaMortisDeclarations || []).length > 0;
    const defaultDeclarantIds = Array.isArray(coverageTarget?.underDeclaredRecipientIds)
      ? coverageTarget.underDeclaredRecipientIds.filter((personId) =>
          declarationCandidates.some((candidate) => candidate.id === personId),
        )
      : declarationCandidates.map((person) => person.id);
    updateSelected({
      causaMortisDeclarations: [
        ...(selectedPerson.causaMortisDeclarations || []),
        {
          id: crypto.randomUUID(),
          status: "draft",
          propertyId,
          declaredShareNumerator: prefillRemainingShare
            ? remainingFraction.numerator
            : isAdditionalDeclaration
              ? ""
              : 0,
          declaredShareDenominator: prefillRemainingShare
            ? remainingFraction.denominator
            : isAdditionalDeclaration
              ? ""
              : 1,
          date: "",
          notaryName: "",
          immovablePropertyValue: "",
          declarantPersonIds: defaultDeclarantIds,
        },
      ],
    });
  };

  const handleCausaMortisDeclarationAction = () => {
    addCausaMortisDeclaration();
  };

  const handleCausaMortisCoverageAction = (propertyId) => {
    addCausaMortisDeclaration(propertyId);
  };

  const completeCausaMortisDeclaration = (declaration) => {
    const propertyId = declaration.propertyId || (properties.length === 1 ? properties[0].id : "");
    const normalizedDeclaration = { ...declaration, propertyId };
    const error = validateCausaMortisDeclaration(normalizedDeclaration, {
      dateOfDeath: effectiveSelectedDeathDate,
    });

    if (error) {
      setCausaMortisErrors((current) => ({ ...current, [declaration.id]: error }));
      return false;
    }

    setCausaMortisErrors((current) => {
      const next = { ...current };
      delete next[declaration.id];
      return next;
    });
    updateSelected({
      causaMortisDeclarations: (selectedPerson.causaMortisDeclarations || []).map((current) =>
        current.id === declaration.id
          ? {
              ...normalizedDeclaration,
              status: "complete",
            }
          : current,
      ),
    });
    return true;
  };

  const removeCausaMortisDeclaration = (declarationId) => {
    setCausaMortisErrors((current) => {
      const next = { ...current };
      delete next[declarationId];
      return next;
    });
    updateSelected({
      causaMortisDeclarations: (selectedPerson.causaMortisDeclarations || []).filter(
        (declaration) => declaration.id !== declarationId,
      ),
    });
  };

  const setDeceased = (checked) => {
    if (!checked && personRecordControllerRef.current?.hasPending?.()) {
      const committed = personRecordControllerRef.current.flush();
      if (committed === false || committed === null) return false;
    }
    const current = personDesignations(selectedPerson).filter(
      (designation) => String(designation).toLowerCase() !== "deceased",
    );
    if (checked) setIsEditing(true);
    const survivalPatch =
      legalWorkspaceEnabled && selectedPerson.isPotentialIntestateParent
        ? checked
          ? {
              survivalStatusRequired: !isValidIsoDate(selectedPerson.dateOfDeath),
              survivalStatusConfirmed: isValidIsoDate(selectedPerson.dateOfDeath)
                ? "death-date-recorded"
                : "",
            }
          : { survivalStatusRequired: false, survivalStatusConfirmed: "alive" }
        : {};
    const genealogicalPatch = {
      designations: checked ? ["Deceased", ...current] : current,
      isDeceased: checked,
      dateOfDeath: checked ? selectedPerson.dateOfDeath || "" : "",
      dateOfDeathUnknown: checked ? selectedPerson.dateOfDeathUnknown === true : false,
      ...(!legalWorkspaceEnabled && !checked ? { deathDateText: "" } : {}),
    };
    const patch = legalWorkspaceEnabled
      ? {
          ...genealogicalPatch,
          inheritanceBasis:
            checked && fullyTransferredInterVivos
              ? "lifetime-disposal"
              : selectedPerson.inheritanceBasis === "lifetime-disposal"
                ? "intestacy"
                : selectedPerson.inheritanceBasis,
          unmarriedOrWidowedAtDeath: checked
            ? selectedPerson.unmarriedOrWidowedAtDeath === true
            : false,
          ...survivalPatch,
        }
      : genealogicalPatch;

    if (onDeceasedStatusChange) {
      acknowledgeIdentityOverlay(
        onDeceasedStatusChange({
          checked,
          personId: selectedPerson.id,
          people: peopleWithIdentityOverlay(stampUnsignedIntestacyContexts()),
          patch,
        }),
      );
      return;
    }
    updateSelected(patch);
  };

  const updateDateOfDeath = (dateOfDeath) => {
    const survivalPatch =
      legalWorkspaceEnabled && selectedPerson.isPotentialIntestateParent
        ? isValidIsoDate(dateOfDeath)
          ? { survivalStatusRequired: false, survivalStatusConfirmed: "death-date-recorded" }
          : { survivalStatusRequired: true, survivalStatusConfirmed: "" }
        : {};
    updateSelected({
      dateOfDeath,
      dateOfDeathUnknown: false,
      ...(isValidIsoDate(dateOfDeath) ? { deathDateText: isoDateToDisplay(dateOfDeath) } : {}),
      ...survivalPatch,
    });
  };

  const updateDateOfDeathUnknown = (checked) => {
    const survivalPatch =
      legalWorkspaceEnabled && selectedPerson.isPotentialIntestateParent
        ? checked
          ? { survivalStatusRequired: false, survivalStatusConfirmed: "death-date-unknown" }
          : { survivalStatusRequired: true, survivalStatusConfirmed: "" }
        : {};
    updateSelected({
      dateOfDeathUnknown: checked,
      ...(checked ? { dateOfDeath: "", deathDateText: "" } : {}),
      ...survivalPatch,
    });
  };

  const addRelative = (kind, secondParentId = "") => {
    const sourcePeople = peopleWithIdentityOverlay(people);
    const sourceSelected =
      sourcePeople.find((person) => person.id === selectedPerson?.id) || selectedPerson;
    const sourceIdentityIssues = sourceSelected
      ? personIdentityIssues(sourceSelected).filter(
          (issue) => legalWorkspaceEnabled || issue !== "Surname at birth",
        )
      : [];
    if (
      !sourceSelected ||
      sourceIdentityIssues.length ||
      (["child", "marriage", "partnership"].includes(kind) &&
        !["Male", "Female"].includes(sourceSelected.sex))
    ) {
      return;
    }
    const stampedPeople = stampUnsignedIntestacyContexts(sourcePeople);
    const counts = personRelationshipCounts(sourcePeople, sourceSelected);
    if ((kind === "father" && counts.father) || (kind === "mother" && counts.mother)) {
      return;
    }
    const relative = createPerson();
    let selectedPatch = {};

    if (kind === "father") {
      Object.assign(relative, { sex: "Male", designations: ["Parent"] });
      selectedPatch = {
        fatherId: relative.id,
        fatherExplicitlyUnassigned: false,
      };
    }
    if (kind === "mother") {
      Object.assign(relative, { sex: "Female", designations: ["Parent"] });
      selectedPatch = {
        motherId: relative.id,
        motherExplicitlyUnassigned: false,
      };
    }
    if (kind === "marriage" || kind === "partnership") {
      const relationshipType =
        kind === "partnership"
          ? PARTNER_RELATIONSHIP_TYPES.PARTNERSHIP
          : PARTNER_RELATIONSHIP_TYPES.MARRIAGE;
      Object.assign(relative, {
        sex: String(sourceSelected.sex).toLowerCase() === "male" ? "Female" : "Male",
        designations: [
          relationshipType === PARTNER_RELATIONSHIP_TYPES.MARRIAGE
            ? hasDesignation(sourceSelected, "Deceased")
              ? "Surviving Spouse"
              : "Spouse"
            : "Partner",
        ],
      });
    }
    if (kind === "child") {
      Object.assign(relative, { designations: ["Child"] });
      const secondParent = sourcePeople.find((person) => person.id === secondParentId);
      if (
        sourceSelected.sex === "Female" ||
        (sourceSelected.sex !== "Male" && secondParent?.sex === "Male")
      ) {
        relative.motherId = sourceSelected.id;
        relative.fatherId = secondParent?.id || "";
      } else {
        relative.fatherId = sourceSelected.id;
        relative.motherId = secondParent?.id || "";
      }
    }
    if (kind === "sibling") {
      Object.assign(relative, {
        designations: ["Sibling"],
        fatherId: sourceSelected.fatherId || "",
        motherId: sourceSelected.motherId || "",
        siblingIds: [sourceSelected.id],
      });
      selectedPatch = {
        siblingIds: [...new Set([...(sourceSelected.siblingIds || []), relative.id])],
      };
    }

    if ((kind === "child" || kind === "sibling") && relative.fatherId) {
      const father = sourcePeople.find((person) => person.id === relative.fatherId);
      Object.assign(relative, fatherSurnameDefaultPatch(relative, father));
    }

    const updatedPeople = stampedPeople.map((person) =>
      person.id === sourceSelected.id ? { ...person, ...selectedPatch } : person,
    );
    const nextPeople = [...updatedPeople, relative];
    if (kind === "marriage" || kind === "partnership") {
      commitPeopleChange(
        linkPartnerRelationship(nextPeople, sourceSelected.id, relative.id, {
          type:
            kind === "partnership"
              ? PARTNER_RELATIONSHIP_TYPES.PARTNERSHIP
              : PARTNER_RELATIONSHIP_TYPES.MARRIAGE,
        }),
      );
      return;
    }
    commitPeopleChange(nextPeople);
  };

  const activeProperty = properties[0] || null;
  const activePropertySaleValue = activeProperty?.saleValue;
  const workingTransferProperty = useMemo(
    () =>
      activeProperty && editingTransferId
        ? {
            ...activeProperty,
            transfers: (activeProperty.transfers || []).filter(
              (transfer) => transfer.id !== editingTransferId,
            ),
          }
        : activeProperty,
    [activeProperty, editingTransferId],
  );
  const propertyVendorReport = useMemo(
    () =>
      legalWorkspaceEnabled
        ? vendorReport ||
          (activeProperty
            ? buildPropertyVendorTaxReport(activeProperty, people, outsideParties)
            : null)
        : null,
    [activeProperty, legalWorkspaceEnabled, outsideParties, people, vendorReport],
  );
  const resolvedCurrentOwnerPresentationsByPerson = useMemo(() => {
    if (!legalWorkspaceEnabled) return {};
    if (currentOwnerPresentationsByPerson) return currentOwnerPresentationsByPerson;
    const ledgerOwners = propertyVendorReport?.ledger?.owners || [];
    const presentationOwners = ledgerOwners.length
      ? ledgerOwners
      : Object.entries(ownershipByPerson).map(([id, share]) => ({
          id,
          personId: id,
          share,
          shareFraction: ownershipFractionsByPerson[id],
        }));
    return ownerPresentationsById(
      buildCurrentOwnerPresentations(
        presentationOwners,
        activePropertySaleValue,
        resolvedTaxCalculationReport,
      ),
    );
  }, [
    activePropertySaleValue,
    currentOwnerPresentationsByPerson,
    legalWorkspaceEnabled,
    ownershipByPerson,
    ownershipFractionsByPerson,
    propertyVendorReport?.ledger?.owners,
    resolvedTaxCalculationReport,
  ]);
  const workingTransferReport = useMemo(
    () =>
      legalWorkspaceEnabled && editingTransferId && workingTransferProperty
        ? buildPropertyVendorTaxReport(workingTransferProperty, people, outsideParties)
        : legalWorkspaceEnabled
          ? propertyVendorReport
          : null,
    [
      editingTransferId,
      legalWorkspaceEnabled,
      outsideParties,
      people,
      propertyVendorReport,
      workingTransferProperty,
    ],
  );
  const recordedOutgoingInterVivosTransfers = useMemo(
    () =>
      (propertyVendorReport?.ledger?.entries || []).filter(
        (entry) => entry.sellerId === selectedPerson?.id,
      ),
    [propertyVendorReport, selectedPerson?.id],
  );
  const estateTransmissionFractions = useMemo(
    () =>
      (workingTransferReport?.ownership?.transmissions || [])
        .filter((transmission) => transmission.deceasedId === selectedPerson?.id)
        .map((transmission) => transmission.amountFraction)
        .filter((fraction) => fraction && !fraction.error),
    [workingTransferReport, selectedPerson?.id],
  );
  const calculatedEstateShareFraction = useMemo(
    () =>
      estateTransmissionFractions.reduce(
        (total, fraction) => addFractions(total, fraction),
        ZERO_FRACTION,
      ),
    [estateTransmissionFractions],
  );
  const selectedIsDeceased = isPersonDeceased(selectedPerson);
  const isDonation = donationDraft.kind !== "sale";
  const currentLedgerHolding =
    (workingTransferReport?.ledger?.owners || []).find(
      (candidate) => candidate.id === selectedPerson?.id,
    )?.shareFraction || ZERO_FRACTION;
  const interVivosDisclosureOpen =
    donationOpen ||
    Boolean(interVivosStatusSession) ||
    recordedOutgoingInterVivosTransfers.length > 0;
  const baseTransferHolding = selectedIsDeceased
    ? calculatedEstateShareFraction
    : currentLedgerHolding;
  const transferCapacityPreview = useMemo(
    () =>
      legalWorkspaceEnabled && workingTransferProperty && selectedPerson?.id && donationDraft.date
        ? previewPropertyTransferCapacity(workingTransferProperty, people, outsideParties, {
            sellerId: selectedPerson.id,
            date: donationDraft.date,
            kind: donationDraft.kind,
          })
        : null,
    [
      donationDraft.date,
      donationDraft.kind,
      legalWorkspaceEnabled,
      outsideParties,
      people,
      selectedPerson?.id,
      workingTransferProperty,
    ],
  );
  const provenanceTranches = useMemo(() => {
    if (!legalWorkspaceEnabled) return [];
    if (transferCapacityPreview && !transferCapacityPreview.error) {
      return transferCapacityPreview.tranches;
    }
    return workingTransferProperty
      ? ownerProvenanceTranches(
          workingTransferReport || {},
          workingTransferProperty,
          selectedPerson.id,
        )
      : [];
  }, [
    legalWorkspaceEnabled,
    selectedPerson.id,
    transferCapacityPreview,
    workingTransferProperty,
    workingTransferReport,
  ]);
  // Once a date has been entered, the dated preview is authoritative even when it
  // reports an error. Falling back to the balance at death/current balance would
  // misleadingly present that share as available on an impossible transfer date.
  const donorLedgerHolding = transferCapacityPreview
    ? transferCapacityPreview.holdingFraction || ZERO_FRACTION
    : baseTransferHolding;
  const fullyTransferredInterVivos =
    recordedOutgoingInterVivosTransfers.length > 0 &&
    compareFractions(baseTransferHolding, ZERO_FRACTION) === 0;
  const canDonate =
    legalWorkspaceEnabled &&
    Boolean(
      activeProperty &&
      (editingTransferId ? onUpdateInterVivosTransfer : onRecordDonation) &&
      donorLedgerHolding,
    ) &&
    (donationOpen || compareFractions(baseTransferHolding, ZERO_FRACTION) > 0);
  // Store every new transfer as an exact fraction of the whole property. In particular,
  // "all" means the balance displayed now; it must not be recalculated against a different
  // historical holding if another transaction is later inserted before it.
  const draftTransferCalculation = () => {
    if (donationDraft.amountType === "all-share") {
      return {
        amount: donorLedgerHolding,
        fraction: donorLedgerHolding,
        storedAmountType: "whole-property",
      };
    }

    let fraction;
    if (donationDraft.shareInputMode === "percentage") {
      const percentageInput = normalisePercentageInput(donationDraft.percentage).trim();
      const percentage = Number(percentageInput);
      if (!percentageInput || !Number.isFinite(percentage)) {
        return { error: "Enter a valid percentage." };
      }
      if (percentage <= 0) {
        return { error: "The transferred percentage must be greater than zero." };
      }
      if (percentage > 100) {
        return { error: "The transferred percentage cannot exceed 100%." };
      }
      fraction = fractionForShare(shareFromPercentage(percentage));
    } else {
      fraction = normaliseFraction(donationDraft.numerator, donationDraft.denominator);
      if (fraction.error) return fraction;
    }

    if (compareFractions(fraction, ZERO_FRACTION) <= 0) {
      return { error: "The transferred share must be greater than zero." };
    }
    if (compareFractions(fraction, donorLedgerHolding) > 0) {
      return {
        error: "The transferred share cannot be greater than this person's current holding.",
      };
    }
    return {
      amount: fraction,
      fraction,
      storedAmountType: "whole-property",
    };
  };
  const transferCalculation = canDonate ? draftTransferCalculation() : null;
  const previewAmount = transferCalculation?.amount || null;
  const definedTransferHasInput =
    donationDraft.amountType === "defined-share" &&
    (donationDraft.shareInputMode === "percentage"
      ? Boolean(String(donationDraft.percentage ?? "").trim())
      : Boolean(
          String(donationDraft.numerator ?? "").trim() ||
          String(donationDraft.denominator ?? "").trim(),
        ));
  const rawTransferCapacityError =
    transferCapacityPreview?.error ||
    (transferCapacityPreview && compareFractions(donorLedgerHolding, ZERO_FRACTION) <= 0
      ? "This person held no share on the entered transfer date."
      : "");
  const transferCapacityError =
    rawTransferCapacityError ===
      `${isDonation ? "Donation" : "Sale"} date must be on or before the seller's date of death.` &&
    selectedPerson?.dateOfDeath
      ? `${isDonation ? "Donation" : "Sale"} date must be on or before ${displayName(selectedPerson)}'s date of death (${isoDateToDisplay(selectedPerson.dateOfDeath)}).`
      : rawTransferCapacityError;
  const displayedTransferError =
    transferCapacityError || (definedTransferHasInput ? transferCalculation?.error || "" : "");
  // The provenance question is exceptional: it only arises when part of the holding is
  // transferred while the holder acquired on more than one occasion. A whole-holding
  // transfer moves every provenance, and a single provenance answers itself.
  const needsProvenanceDesignation =
    Boolean(canDonate && previewAmount && !previewAmount.error) &&
    provenanceTranches.length > 1 &&
    compareFractions(previewAmount, ZERO_FRACTION) > 0 &&
    compareFractions(previewAmount, donorLedgerHolding) < 0;
  const designationCheckedCount = provenanceTranches.filter(
    (tranche) => donationDraft.designation[tranche.trancheId]?.checked,
  ).length;

  const setDonationField = (patch) =>
    setDonationDraft((current) => ({ ...current, ...patch, error: "" }));

  const openTransferEditor = (transferId) => {
    const transfer = (activeProperty?.transfers || []).find(
      (candidate) => candidate.id === transferId,
    );
    if (!transfer) return;
    const ledgerEntry = recordedOutgoingInterVivosTransfers.find(
      (entry) => entry.id === transferId,
    );
    setEditingTransferId(transfer.id);
    setDonationDraft(transferDraftFromRecord(transfer, ledgerEntry?.amountFraction));
    setDonationOpen(true);
  };

  const closeTransferEditor = () => {
    setEditingTransferId("");
    setDonationDraft(blankDonationDraft());
    setDonationOpen(false);
  };

  const transferProvenance = (amount) => {
    if (!provenanceTranches.length) return { provenance: [] };
    const asRecord = (portion) => ({
      trancheId: portion.tranche.trancheId,
      label: portion.tranche.provenance,
      cause: portion.tranche.cause,
      acquiredOn: portion.tranche.acquiredOn,
      numerator: portion.fraction.numerator,
      denominator: portion.fraction.denominator,
    });
    if (needsProvenanceDesignation) {
      const chosen = provenanceTranches.filter(
        (tranche) => donationDraft.designation[tranche.trancheId]?.checked,
      );
      if (!chosen.length) {
        const legacyTransfer = (activeProperty?.transfers || []).find(
          (transfer) => transfer.id === editingTransferId,
        );
        if (legacyTransfer && !(legacyTransfer.provenance || []).length) {
          const selection = selectTranchePortions(provenanceTranches, amount, {
            strategy: "pro-rata",
          });
          return selection.error
            ? { error: selection.error }
            : { provenance: selection.portions.map(asRecord) };
        }
        return { error: "Choose which provenance is being transferred." };
      }
      const designation = chosen.map((tranche) => {
        if (chosen.length === 1) return { trancheId: tranche.trancheId, fraction: amount };
        const entry = donationDraft.designation[tranche.trancheId] || {};
        return {
          trancheId: tranche.trancheId,
          fraction: normaliseFraction(entry.numerator, entry.denominator),
        };
      });
      const invalid = designation.find((entry) => entry.fraction.error);
      if (invalid) return { error: invalid.fraction.error };
      const selection = selectTranchePortions(provenanceTranches, amount, {
        strategy: "designated",
        designation,
      });
      if (selection.error) return { error: selection.error };
      return { provenance: selection.portions.map(asRecord) };
    }
    // No question needed: attribute automatically, and silently skip when the recorded
    // acquisitions cannot account for the amount (legacy transfers without provenance).
    const selection = selectTranchePortions(provenanceTranches, amount, {
      strategy: "pro-rata",
    });
    return { provenance: selection.error ? [] : selection.portions.map(asRecord) };
  };

  const submitDonation = (event) => {
    event.preventDefault();
    if (!canDonate) {
      return setDonationDraft((draft) => ({
        ...draft,
        error: "This transfer cannot be edited until its property share is available.",
      }));
    }
    const calculation = draftTransferCalculation();
    if (calculation.error) {
      return setDonationDraft((draft) => ({ ...draft, error: calculation.error }));
    }
    const { amount, fraction, storedAmountType } = calculation;
    const provenanceResult = transferProvenance(amount);
    if (provenanceResult.error) {
      return setDonationDraft((d) => ({ ...d, error: provenanceResult.error }));
    }
    const chronologyError = validateTransferDateChronology({
      transferDate: donationDraft.date,
      acquisitionDates: provenanceResult.provenance.map((entry) => entry.acquiredOn),
      sellerDateOfDeath: selectedPerson.dateOfDeath || "",
      eventLabel: isDonation ? "Donation" : "Sale",
    });
    if (chronologyError) {
      return setDonationDraft((draft) => ({ ...draft, error: chronologyError }));
    }

    let acquirer = null;
    let nextPeople = peopleWithIdentityOverlay(people);
    let nextOutsideParties = outsideParties;
    if (donationDraft.doneeMode === "new") {
      const name = donationDraft.doneeName.trim();
      if (!name) {
        return setDonationDraft((d) => ({
          ...d,
          error:
            donationDraft.doneeType === "company"
              ? "Enter the company's name."
              : "Enter the acquirer's full name.",
        }));
      }
      if (donationDraft.doneeType === "company") {
        acquirer = tagStatusCreatedRecord(
          {
            id: crypto.randomUUID(),
            type: "company",
            name,
            registrationNumber: donationDraft.doneeRegistrationNumber.trim(),
          },
          interVivosStatusSession,
          { role: "transfer-acquirer" },
        );
        nextOutsideParties = [...outsideParties, acquirer];
      } else {
        // An unrelated individual joins the tree with no family links. This gives them a
        // person card from which a later onward sale or donation can be recorded.
        acquirer = tagStatusCreatedRecord(
          {
            ...createPerson(isDonation ? "Donee" : "Buyer"),
            givenNames: givenNamesFromFullName(name),
            surname: surnameFromFullName(name),
            fullName: name,
            surnameAtBirth: donationDraft.doneeSex === "Male" ? surnameFromFullName(name) : "",
            surnameAtBirthReviewRequired: donationDraft.doneeSex === "Female",
            sex: donationDraft.doneeSex,
          },
          interVivosStatusSession,
          { role: "transfer-acquirer" },
        );
        nextPeople = [...nextPeople, acquirer];
      }
    } else {
      if (!donationDraft.doneeId) {
        return setDonationDraft((d) => ({ ...d, error: "Select who acquires the share." }));
      }
      if (donationDraft.doneeId === selectedPerson.id) {
        return setDonationDraft((d) => ({
          ...d,
          error: "Transferor and acquirer must be different.",
        }));
      }
    }

    const originalTransfer = editingTransferId
      ? (activeProperty.transfers || []).find((transfer) => transfer.id === editingTransferId)
      : null;
    if (editingTransferId && !originalTransfer) {
      return setDonationDraft((draft) => ({
        ...draft,
        error: "This saved transfer could not be found. Close and reopen the person card.",
      }));
    }

    const transferRecord = {
      ...(originalTransfer || {}),
      id: originalTransfer?.id || crypto.randomUUID(),
      // The contract type travels with the transfer because it governs the acquirer's own
      // tax position on a later resale: a donation triggers the Article 5A(5)(b) rules,
      // while a sale stands on its own date and price.
      kind: isDonation ? "donation" : "sale",
      sellerId: selectedPerson.id,
      buyerId: acquirer ? acquirer.id : donationDraft.doneeId,
      numerator: String(fraction.numerator),
      denominator: String(fraction.denominator),
      amountType: storedAmountType,
      date: donationDraft.date,
      consideration: originalTransfer?.consideration || "",
      ...(acquirer && donationDraft.doneeType !== "company"
        ? { createdBuyerPersonId: acquirer.id }
        : originalTransfer?.createdBuyerPersonId
          ? { createdBuyerPersonId: originalTransfer.createdBuyerPersonId }
          : {}),
      // Which acquisitions the transferred share comes from — designated by the notary
      // when the question arises, attributed automatically when it answers itself.
      provenance: provenanceResult.provenance,
    };
    if (
      originalTransfer?.createdBuyerPersonId &&
      transferRecord.buyerId !== originalTransfer.createdBuyerPersonId
    ) {
      delete transferRecord.createdBuyerPersonId;
    }
    const transfer = originalTransfer
      ? transferRecord
      : tagStatusCreatedRecord(transferRecord, interVivosStatusSession, { role: "transfer" });
    const prospectiveTransfers = originalTransfer
      ? (activeProperty.transfers || []).map((candidate) =>
          candidate.id === originalTransfer.id ? transfer : candidate,
        )
      : [...(activeProperty.transfers || []), transfer];
    const prospectiveReport = buildPropertyVendorTaxReport(
      {
        ...activeProperty,
        transfers: prospectiveTransfers,
      },
      nextPeople,
      nextOutsideParties,
    );
    const prospectiveEntry = prospectiveReport.ledger.entries.find(
      (entry) => entry.id === transfer.id,
    );
    if (!prospectiveEntry || prospectiveEntry.error) {
      return setDonationDraft((draft) => ({
        ...draft,
        error: prospectiveEntry?.error || "The transfer could not be validated.",
      }));
    }
    const existingInvalidIds = new Set(
      (propertyVendorReport?.ledger?.entries || [])
        .filter((entry) => entry.error)
        .map((entry) => entry.id),
    );
    const newlyInvalidTransfer = prospectiveReport.ledger.entries.find(
      (entry) => entry.id !== transfer.id && entry.error && !existingInvalidIds.has(entry.id),
    );
    if (newlyInvalidTransfer) {
      return setDonationDraft((draft) => ({
        ...draft,
        error: `This change would invalidate the later transfer dated ${
          isoDateToDisplay(newlyInvalidTransfer.date) || "an unknown date"
        }. ${newlyInvalidTransfer.error}`,
      }));
    }
    const payload = {
      people: nextPeople,
      outsideParties: nextOutsideParties,
      propertyId: activeProperty.id,
      transferId: transfer.id,
      transfer,
    };
    const committed = originalTransfer
      ? onUpdateInterVivosTransfer(payload)
      : onRecordDonation(payload);
    acknowledgeIdentityOverlay(committed);
    closeTransferEditor();
  };

  const createOutsideParty = (party) => {
    const nextParty = tagStatusCreatedRecord(party, deceasedStatusSession, {
      role: "succession-party",
    });
    onOutsidePartiesChange?.([...outsideParties, nextParty]);
  };

  const addOutsideWillHeir = (party) => {
    createOutsideParty(party);
    const sourcePerson = selectedPersonWithPendingRecordEdits();
    const hasHeirs = (sourcePerson.willHeirs || []).length > 0;
    updateSelected({
      willHeirs: [
        ...(sourcePerson.willHeirs || []),
        {
          id: crypto.randomUUID(),
          personId: party.id,
          ...shareFromPercentage(hasHeirs ? 0 : 100),
        },
      ],
    });
    setWillOutsidePartyOpen(false);
  };

  const linkExistingSpouse = () => {
    if (!selectedPerson || !existingSpouseId || existingSpouseId === selectedPerson.id) {
      return;
    }
    const existingPerson = people.find((person) => person.id === existingSpouseId);
    if (!existingPerson) return;
    const stampedPeople = stampUnsignedIntestacyContexts();
    commitPeopleChange(
      linkPartnerRelationship(stampedPeople, selectedPerson.id, existingPerson.id, {
        type: partnerRelationshipType,
      }),
    );
    setExistingSpouseId("");
    setSpouseChooserOpen(false);
  };

  const removeSelected = () => {
    if (
      !selectedPerson ||
      currentFamilyPersonIds.length <= 1 ||
      deleteBlockers.length ||
      (sharedAcrossFamilies && !onDeletePerson)
    ) {
      return;
    }
    const confirmed = window.confirm(
      sharedAcrossFamilies
        ? `Remove ${displayName(selectedPerson)} from this family tree? The person will remain in the other linked family tree${
            personFamilyGroupCount === 2 ? "" : "s"
          }.`
        : retainedIdentityLabels.length
          ? `Delete ${displayName(selectedPerson)} from the family tree? Their identity and existing succession, legal and tax records will be retained outside the tree.`
          : `Are you sure you want to delete ${displayName(selectedPerson)} from the family tree? This cannot be undone.`,
    );
    if (!confirmed) return;
    const draftController = personDraftControllerRef.current;
    if (draftController?.flush?.() === false || draftController?.hasPending?.()) return;
    if (onDeletePerson) {
      onDeletePerson(selectedPerson.id);
      return;
    }
    commitPeopleChange(
      stampUnsignedIntestacyContexts()
        .filter((person) => person.id !== selectedPerson.id)
        .map((person) => ({
          ...person,
          fatherId: person.fatherId === selectedPerson.id ? "" : person.fatherId,
          motherId: person.motherId === selectedPerson.id ? "" : person.motherId,
          spouseIds: (person.spouseIds || []).filter((id) => id !== selectedPerson.id),
          siblingIds: (person.siblingIds || []).filter((id) => id !== selectedPerson.id),
        })),
    );
    onSelectPerson(currentFamilyPersonIds.find((personId) => personId !== selectedPerson.id) || "");
  };

  const removePartnerLink = (partnerId) => {
    if (!selectedPerson || !partnerId) return;
    const hasSharedChildren = people.some((person) => {
      const parentIds = new Set([person.fatherId, person.motherId].filter(Boolean));
      return parentIds.has(selectedPerson.id) && parentIds.has(partnerId);
    });
    if (hasSharedChildren) return;
    commitPeopleChange(
      removePartnerRelationship(stampUnsignedIntestacyContexts(), selectedPerson.id, partnerId),
    );
  };

  const updatePartnerLink = (partnerId, patch) => {
    if (!selectedPerson || !partnerId) return;
    commitPeopleChange(
      upsertPartnerRelationship(
        stampUnsignedIntestacyContexts(),
        selectedPerson.id,
        partnerId,
        patch,
      ),
    );
  };

  const removeSiblingLink = (siblingId) => {
    if (!selectedPerson || !siblingId) return;
    commitPeopleChange(
      people.map((person) => {
        if (person.id === selectedPerson.id) {
          return {
            ...person,
            siblingIds: (person.siblingIds || []).filter((id) => id !== siblingId),
          };
        }
        if (person.id === siblingId) {
          return {
            ...person,
            siblingIds: (person.siblingIds || []).filter((id) => id !== selectedPerson.id),
          };
        }
        return person;
      }),
    );
  };

  if (!selectedPerson) {
    return (
      <div className="inspector-empty">
        <UsersRound size={30} />
        <h2>Start the family tree</h2>
        <p>Add the first person to begin this family tree.</p>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            const person = createPerson();
            onChange([...people, person]);
            onSelectPerson(person.id);
          }}
        >
          Add first person
        </button>
      </div>
    );
  }

  const hasOwnership = Object.prototype.hasOwnProperty.call(ownershipByPerson, selectedPerson.id);
  const ownership = hasOwnership ? ownershipByPerson[selectedPerson.id] : 0;
  const currentOwnerPresentation = resolvedCurrentOwnerPresentationsByPerson[selectedPerson.id];
  const isDeceased =
    Boolean(selectedPerson.isDeceased) || hasDesignation(selectedPerson, "Deceased");
  const currentInitialTaxRecordIds = new Set(
    (selectedVendorTax?.rows || [])
      .filter((row) => row.sourceKind === "initial")
      .map((row) => row.originalOwnerRecordId)
      .filter(Boolean),
  );
  const unresolvedDownstreamDonationRows = (resolvedTaxCalculationReport?.vendors || []).flatMap(
    (vendor) =>
      (vendor.rows || []).filter(
        (row) =>
          row.sourceKind === "donation" &&
          row.provenancePersonId === selectedPerson.id &&
          row.requiresDonorAcquisitionDate === true,
      ),
  );
  const hasUnresolvedDownstreamDonation = unresolvedDownstreamDonationRows.length > 0;
  const needsOriginalAcquisitionResolution =
    Boolean(selectedVendorTax && selectedVendorTax.tax == null) || hasUnresolvedDownstreamDonation;
  const selectedPersonInitialOwners = (properties[0]?.owners || []).filter(
    (owner) => owner.personId === selectedPerson.id,
  );
  const originalAcquisitionResolutionRows = selectedPersonInitialOwners
    .filter(
      (owner) =>
        needsOriginalAcquisitionResolution &&
        owner.personId === selectedPerson.id &&
        !owner.acquisitionDate &&
        !currentInitialTaxRecordIds.has(owner.id),
    )
    .flatMap((owner) => {
      const matchingDonationRows = unresolvedDownstreamDonationRows.filter(
        (row) =>
          row.originalOwnerRecordId === owner.id ||
          (!row.originalOwnerRecordId && selectedPersonInitialOwners.length === 1),
      );
      const sourceRows = matchingDonationRows.length ? matchingDonationRows : [null];
      return sourceRows.map((sourceRow) => ({
        id: `original-acquisition-${owner.id || selectedPerson.id}${
          sourceRow?.sourceTransferId ? `-${sourceRow.sourceTransferId}` : ""
        }`,
        sourceKind: "initial",
        provenance: "Original ownership",
        originalOwnerId: selectedPerson.id,
        originalOwnerRecordId: owner.id || "",
        sourceTransferId: sourceRow?.sourceTransferId || "",
        requiresOriginalAcquisitionDate: true,
        warning: "Enter this original owner's acquisition date for the later donated share.",
      }));
    });
  const survivalReferencePerson = peopleById.get(selectedPerson.survivalStatusReferencePersonId);
  const identityIssues = selectedPersonIdentityIssues;
  const identityComplete = identityIssues.length === 0;
  const binaryRelationshipRoleAvailable = ["Male", "Female"].includes(selectedPerson.sex);
  const identityMessage = identityComplete
    ? ""
    : `Complete ${identityIssues.join(
        identityIssues.length > 1 ? ", " : "",
      )} before adding relatives.`;
  const selectedDisplayName = displayName(selectedPerson);
  // Older saves used "lifetime-disposal" as though a transfer during life replaced the
  // person's later succession. They are independent events: preserve that legacy value only
  // as the initial state of the inter-vivos disclosure, while the estate defaults to intestacy.
  const inheritanceBasis = selectedPerson.inheritanceBasis === "will" ? "will" : "intestacy";
  const spouseSurvivalNotMaterialToOwnership =
    legalWorkspaceEnabled &&
    isDeceased &&
    spouseDeathDatesAreOptionalForIntestacy(people, selectedPerson.id);
  const testateHistoricalLawWarning =
    legalWorkspaceEnabled && inheritanceBasis === "will"
      ? [
          ...new Set(
            (vendorReport?.ownership?.transmissions || [])
              .filter((transmission) => transmission.deceasedId === selectedPerson.id)
              .flatMap((transmission) => transmission.warnings || [])
              .filter(isLegacyHistoricalLawWarning),
          ),
        ].join(" ")
      : "";
  const recordedWills = legalWorkspaceEnabled ? personWills(selectedPerson) : [];
  const displayedWills = recordedWills.length
    ? recordedWills
    : [{ id: `${selectedPerson.id}:new-will`, date: "", notaryName: "", description: "" }];
  const latestWill = operativeWillFromRecords(recordedWills, selectedPerson.dateOfDeath);
  const willChronologyErrors = new Map(
    recordedWills.map((will) => [
      will.id,
      validateWillDateChronology(will.date, selectedPerson.dateOfDeath),
    ]),
  );
  const willHeirs = legalWorkspaceEnabled ? selectedPerson.willHeirs || [] : [];
  const willPercentageDisplay = legalWorkspaceEnabled
    ? reconcileFractionPercentageDisplay(willHeirs.map(fractionForShare), {
        keys: willHeirs.map((heir) => heir.personId || heir.id),
      })
    : { rows: [], totalDisplayPercentageLabel: "" };
  const willReadiness = legalWorkspaceEnabled
    ? willAllocationReadiness(
        selectedPerson,
        new Set([...people.map((person) => person.id), ...outsideParties.map((party) => party.id)]),
      )
    : { totalPercent: 0, valid: false, totalComplete: false, issues: [] };
  const willTotal = willReadiness.totalPercent;
  const automaticIntestacy =
    legalWorkspaceEnabled && isDeceased ? intestateAllocations(people, selectedPerson.id) : null;
  const editedIntestacy =
    inheritanceBasis === "intestacy" &&
    automaticIntestacy &&
    editedIntestacyAllocations(people, selectedPerson.id, automaticIntestacy, outsideParties);
  const successionHeirIds = legalWorkspaceEnabled
    ? inheritanceBasis === "will"
      ? willHeirs.map((heir) => heir.personId).filter(Boolean)
      : [
          ...((editedIntestacy?.valid
            ? editedIntestacy.shares
            : automaticIntestacy?.shares
          )?.keys() || []),
        ]
    : [];
  const declarationCandidateIds = new Set(successionHeirIds);
  const declarationCandidates = [...people, ...outsideParties]
    .filter((party) => declarationCandidateIds.has(party.id))
    .sort((first, second) =>
      personSelectionLabel(first).localeCompare(personSelectionLabel(second), "en-MT", {
        sensitivity: "base",
        numeric: true,
      }),
    );
  const causaMortisDeclarations = selectedPerson.causaMortisDeclarations || [];
  const taxRequiredCausaMortisDeclarationIds = new Set(
    (resolvedTaxCalculationReport?.vendors || [])
      .flatMap((vendor) => vendor.rows || [])
      .filter(
        (row) =>
          row.requiresCausaMortisAcquisitionValue === true &&
          row.provenancePersonId === selectedPerson.id,
      )
      .flatMap((row) =>
        (row.declarations || [])
          .filter((declaration) => declaration.hasDeclaredValue !== true)
          .map((declaration) => declaration.id),
      )
      .filter(Boolean),
  );
  const taxCausaMortisValueRequiredForPerson = (resolvedTaxCalculationReport?.vendors || [])
    .flatMap((vendor) => vendor.rows || [])
    .some(
      (row) =>
        row.requiresCausaMortisAcquisitionValue === true &&
        row.provenancePersonId === selectedPerson.id,
    );
  const selectedSuggestedWillHeirIds =
    selectedPerson.willHeirsConfirmed === true &&
    selectedPerson.willHeirsConfirmationSource === "suggested"
      ? (selectedPerson.willHeirs || []).map((heir) => heir.personId).filter(Boolean)
      : [];
  const setSelectedSuggestedWillHeirs = (nextPersonIds) => {
    const sourcePerson = selectedPersonWithPendingRecordEdits();
    const suggestedHeirs = [...(automaticIntestacy?.shares || new Map()).entries()];
    const suggestedPersonIds = new Set(suggestedHeirs.map(([personId]) => personId));
    const selectedPersonIds = [
      ...new Set(nextPersonIds.filter((personId) => suggestedPersonIds.has(personId))),
    ];

    if (!selectedPersonIds.length) {
      const snapshot = sourcePerson.willHeirsConfirmationSnapshot;
      updateSelected({
        willHeirs: Array.isArray(snapshot?.willHeirs)
          ? snapshot.willHeirs.map((heir) => ({ ...heir }))
          : [],
        willHeirsConfirmed: snapshot?.willHeirsConfirmed === true,
        willHeirsConfirmationSource: snapshot?.willHeirsConfirmationSource || "",
        willHeirsConfirmationSnapshot: null,
      });
      return;
    }

    const equalShare = shareFromFraction(1, selectedPersonIds.length);
    updateSelected({
      willHeirs: selectedPersonIds.map((personId) => ({
        id: crypto.randomUUID(),
        personId,
        ...equalShare,
      })),
      willHeirsConfirmed: true,
      willHeirsConfirmationSource: "suggested",
      willHeirsConfirmationSnapshot: {
        willHeirs:
          sourcePerson.willHeirsConfirmationSource === "suggested"
            ? (sourcePerson.willHeirsConfirmationSnapshot?.willHeirs || []).map((heir) => ({
                ...heir,
              }))
            : (sourcePerson.willHeirs || []).map((heir) => ({ ...heir })),
        willHeirsConfirmed:
          sourcePerson.willHeirsConfirmationSource === "suggested"
            ? sourcePerson.willHeirsConfirmationSnapshot?.willHeirsConfirmed === true
            : sourcePerson.willHeirsConfirmed === true,
        willHeirsConfirmationSource:
          sourcePerson.willHeirsConfirmationSource === "suggested"
            ? sourcePerson.willHeirsConfirmationSnapshot?.willHeirsConfirmationSource || ""
            : sourcePerson.willHeirsConfirmationSource || "",
      },
    });
  };
  const hasUnknownCausaMortisDeathDate = causaMortisCoverage.some(
    (row) => row.status === "date-unknown",
  );
  const isPreCausaMortisCutoff =
    Boolean(effectiveSelectedDeathDate) &&
    effectiveSelectedDeathDate < INHERITANCE_CAUSA_MORTIS_CUTOFF;
  // The 7% rule only bears on a share somebody is still holding. Where every
  // heir has since died the share has passed again, and sales tax looks only at
  // the last passage of title, so saying anything about this succession's rate
  // would be wrong. One surviving heir is enough for it to hold.
  const inheritedShareStillHeldBySurvivor = people.some(
    (candidate) =>
      (candidate.fatherId === selectedPerson.id || candidate.motherId === selectedPerson.id) &&
      !candidate.isDeceased &&
      !candidate.dateOfDeath &&
      !hasDesignation(candidate, "Deceased"),
  );
  const requiresCausaMortisDetails =
    hasUnknownCausaMortisDeathDate ||
    (Boolean(effectiveSelectedDeathDate) && !isPreCausaMortisCutoff);
  const recordedPropertySaleValue = recordedNonNegativeMoney(properties[0]?.saleValue);
  const estateShareAtDeathFraction = fullyTransferredInterVivos
    ? ZERO_FRACTION
    : calculatedEstateShareFraction;
  const hasEstateShareAtDeath =
    fullyTransferredInterVivos || estateTransmissionFractions.length > 0;
  const estateShareAtDeath = fractionToNumber(estateShareAtDeathFraction);
  const estateShareIsCurrent =
    Boolean(currentOwnerPresentation) &&
    compareFractions(estateShareAtDeathFraction, currentOwnerPresentation.shareFraction) === 0;
  const estateValueAtDeath = estateShareIsCurrent
    ? recordedNonNegativeMoney(currentOwnerPresentation.value)
    : null;
  const relationshipCounts = personRelationshipCounts(people, selectedPerson);
  const linkedPartners = linkedSpousesFor(people, selectedPerson.id);
  const partnerRelationshipsById = new Map(
    linkedPartners.map((partner) => [
      partner.id,
      findPartnerRelationship(people, selectedPerson.id, partner.id),
    ]),
  );
  const activeLinkedSpousesAtDeath = linkedPartners.filter(
    (partner) =>
      !isPotentialParentSurvivalUnresolved(partner) &&
      partnerRelationshipStatusAt(
        partnerRelationshipsById.get(partner.id),
        selectedPerson.dateOfDeath || "",
      ) === "active" &&
      (!isPersonDeceased(partner) ||
        (Boolean(selectedPerson.dateOfDeath) &&
          Boolean(partner.dateOfDeath) &&
          partner.dateOfDeath > selectedPerson.dateOfDeath)),
  );
  const excludedSpouseNames = activeLinkedSpousesAtDeath
    .map((partner) => personDisplayName(partner, people))
    .filter(Boolean)
    .join(", ");
  const relationshipActionCounts = {
    ...relationshipCounts,
    marriage: [...partnerRelationshipsById.values()].filter(
      (relationship) => relationship?.type === PARTNER_RELATIONSHIP_TYPES.MARRIAGE,
    ).length,
    partnership: [...partnerRelationshipsById.values()].filter(
      (relationship) => relationship?.type === PARTNER_RELATIONSHIP_TYPES.PARTNERSHIP,
    ).length,
  };
  const linkedSpouseIds = new Set(linkedPartners.map((person) => person.id));
  const linkedSiblingIds = new Set(selectedPerson.siblingIds || []);
  people.forEach((person) => {
    if ((person.siblingIds || []).includes(selectedPerson.id)) linkedSiblingIds.add(person.id);
  });
  linkedSiblingIds.delete(selectedPerson.id);
  const linkedSiblings = [...linkedSiblingIds]
    .map((personId) => peopleById.get(personId))
    .filter(Boolean);
  const selectedParentIds = new Set(
    [selectedPerson.fatherId, selectedPerson.motherId].filter(Boolean),
  );
  const explicitSiblingOnlyLinks = linkedSiblings.filter(
    (sibling) =>
      ![sibling.fatherId, sibling.motherId].some(
        (parentId) => parentId && selectedParentIds.has(parentId),
      ),
  );
  const mostRecentlyLinkedPartnerId =
    [...(selectedPerson.spouseIds || [])]
      .reverse()
      .find((partnerId) => linkedSpouseIds.has(partnerId)) || "";
  const reciprocalPartners = linkedPartners.filter((partner) =>
    (partner.spouseIds || []).includes(selectedPerson.id),
  );
  const preferredChildPartnerId =
    mostRecentlyLinkedPartnerId ||
    (reciprocalPartners.length === 1 ? reciprocalPartners[0].id : "");
  const sharedChildrenByPartnerId = new Map(
    linkedPartners.map((partner) => [
      partner.id,
      people.filter((person) => {
        const parentIds = new Set([person.fatherId, person.motherId].filter(Boolean));
        return parentIds.has(selectedPerson.id) && parentIds.has(partner.id);
      }),
    ]),
  );
  const closeChildPartnerChooser = () => {
    setChildPartnerChooserOpen(false);
    setChildPartnerId("");
  };
  const togglePartnerChooser = (type) => {
    if (spouseChooserOpen && partnerRelationshipType === type) {
      setSpouseChooserOpen(false);
      return;
    }
    setPartnerRelationshipType(type);
    setExistingSpouseId("");
    setSpouseChooserOpen(true);
  };
  const addChild = () => {
    if (linkedPartners.length > 0) {
      if (childPartnerChooserOpen) {
        closeChildPartnerChooser();
      } else {
        setChildPartnerId(preferredChildPartnerId);
        setChildPartnerChooserOpen(true);
      }
      return;
    }
    addRelative("child", linkedPartners[0]?.id);
  };
  const existingSpouseCandidates = sortPeopleForChoice(
    people.filter(
      (person) =>
        person.id !== selectedPerson.id &&
        !linkedSpouseIds.has(person.id) &&
        partnerLinkEligibility(people, selectedPerson.id, person.id).allowed,
    ),
    people,
  );
  const parentage = parentageDescription(selectedPerson, people);
  // Having descendants is not itself a reason to keep somebody: a person at the
  // top of a tree can go as long as nobody is severed by it. What blocks a
  // removal is being the only thing holding two parts of the family together —
  // the person a spouse reaches the rest of the tree through.
  const familyGraphPeople = Array.isArray(familyPersonIds)
    ? people.filter((entry) => currentFamilyPersonIdSet.has(entry.id))
    : people;
  const selectedPersonInCurrentFamily = currentFamilyPersonIdSet.has(selectedPersonId);
  const seversFamily = removalWouldSeverFamily(familyGraphPeople, selectedPersonId);
  const deleteBlockers = seversFamily
    ? ["a family branch still depends on this person — delete that branch first"]
    : [];
  const deleteDisabled =
    !selectedPersonInCurrentFamily ||
    currentFamilyPersonIds.length <= 1 ||
    deleteBlockers.length > 0 ||
    (sharedAcrossFamilies && !onDeletePerson);
  const deleteMessage = !selectedPersonInCurrentFamily
    ? "This retained identity is already outside the current family tree."
    : currentFamilyPersonIds.length <= 1
      ? "A tree must contain at least one person."
      : sharedAcrossFamilies && !onDeletePerson
        ? "Family-scoped removal is unavailable in this view."
        : deleteBlockers.length
          ? `Cannot delete: ${deleteBlockers.join(" and ")}.`
          : personFamilyGroupCount > 1
            ? "This removes the person from this family only; the shared record remains elsewhere."
            : retainedIdentityLabels.length
              ? "Their identity and existing succession, legal and tax records will be retained outside the family tree."
              : "No family branch depends on this person. Confirmation is required.";

  const displayedPropertyShare = isDeceased
    ? estateShareAtDeath
    : (currentOwnerPresentation?.share ?? ownership);
  const displayedPropertyShareFraction = isDeceased
    ? estateShareAtDeathFraction
    : (currentOwnerPresentation?.shareFraction ?? ownershipFractionsByPerson[selectedPerson.id]);
  const hasDisplayedPropertyShare = isDeceased
    ? hasEstateShareAtDeath
    : Boolean(currentOwnerPresentation) || hasOwnership;
  const displayedPropertyValue = isDeceased
    ? estateValueAtDeath
    : recordedNonNegativeMoney(currentOwnerPresentation?.value);
  const unavailablePropertyValueMessage =
    isDeceased &&
    hasEstateShareAtDeath &&
    recordedPropertySaleValue !== null &&
    !estateShareIsCurrent
      ? "Notional value not shown because this is a historical share."
      : `${isDeceased ? "Notional" : "Current"} value not calculated (selling price is optional).`;
  const propertyShareSummary = (
    <section
      className={`person-share-summary${isDeceased ? " estate-balance-step" : ""}`}
      data-person-section="property"
      aria-label={isDeceased ? "Share remaining at death" : "Estimated property share"}
    >
      <div className="person-share-heading">
        <strong>{isDeceased ? "Share remaining at death" : "Estimated property share"}</strong>
        <span className="person-share-toggle" aria-label="Estimated share display">
          <button
            type="button"
            className={ownershipDisplay === "fraction" ? "active" : ""}
            aria-pressed={ownershipDisplay === "fraction"}
            onClick={() => changeOwnershipDisplay("fraction")}
          >
            Fraction
          </button>
          <button
            type="button"
            className={ownershipDisplay === "percentage" ? "active" : ""}
            aria-pressed={ownershipDisplay === "percentage"}
            onClick={() => changeOwnershipDisplay("percentage")}
          >
            Percentage
          </button>
          <button
            type="button"
            className={ownershipDisplay === "both" ? "active" : ""}
            aria-pressed={ownershipDisplay === "both"}
            onClick={() => changeOwnershipDisplay("both")}
          >
            Both
          </button>
        </span>
      </div>
      <div className="person-share-value">
        <strong>
          {hasDisplayedPropertyShare
            ? ownershipLabel(
                displayedPropertyShare,
                ownershipDisplay,
                displayedPropertyShareFraction,
                !isDeceased || estateShareIsCurrent
                  ? currentOwnerPresentation?.displayPercentageLabel
                  : "",
              )
            : "Not yet calculated"}
        </strong>
        <small>
          {hasDisplayedPropertyShare && displayedPropertyValue !== null
            ? `${isDeceased ? "Notional" : "Current"} value ${money.format(displayedPropertyValue)}`
            : unavailablePropertyValueMessage}
        </small>
      </div>
      {(!isDeceased || originalAcquisitionResolutionRows.length > 0) && (
        <FinalWithholdingTaxSection
          vendorTax={selectedVendorTax}
          additionalResolutionRows={originalAcquisitionResolutionRows}
          isPersonDeceased={isDeceased}
          onOpenSourcePerson={
            onSelectPerson || onSelectOutsideOwner
              ? (sourceId) => {
                  if (outsidePartiesById.has(sourceId)) {
                    onSelectOutsideOwner?.(sourceId);
                    return;
                  }
                  onSelectPerson?.(sourceId);
                }
              : undefined
          }
          onConfirmInitialAcquisition={({ row, acquisitionDate }) =>
            onConfirmInitialAcquisition?.({
              propertyId: properties[0]?.id || "",
              personId: selectedPerson.id,
              row,
              acquisitionDate,
            })
          }
          onConfirmDonationAcquisitionValue={({ row, ...details }) =>
            onConfirmDonationAcquisitionValue?.({
              propertyId: properties[0]?.id || "",
              personId: selectedPerson.id,
              row,
              ...details,
            })
          }
        />
      )}
    </section>
  );

  // A transfer during life is independent of the person's eventual succession. Completed
  // records stay compact; the editor opens only for the first or next transfer.
  const shareTransferSection =
    donationOpen && activeProperty && (editingTransferId || canDonate) ? (
      <div
        id={`lifetime-transfer-editor-${selectedPerson.id}`}
        className="person-donation"
        data-person-section="donation"
      >
        <form className="person-donation-form" noValidate onSubmit={submitDonation}>
          <label>
            Type of contract
            <select
              aria-label="Type of contract"
              value={donationDraft.kind}
              onChange={(event) => setDonationField({ kind: event.target.value })}
            >
              <option value="donation">Donation</option>
              <option value="sale">Sale</option>
            </select>
          </label>
          <label>
            {isDonation ? "Donation date" : "Sale date"}
            <DateInput
              aria-label={isDonation ? "Donation date" : "Sale date"}
              data-tax-readiness-field="donation-date"
              data-tax-readiness-target-id={editingTransferId || undefined}
              value={donationDraft.date}
              onChange={(value) => setDonationField({ date: value })}
            />
          </label>
          <label>
            {isDonation ? "Who receives the donation?" : "Who acquires the share?"}
            <select
              aria-label="Acquirer source"
              value={donationDraft.doneeMode}
              onChange={(event) => setDonationField({ doneeMode: event.target.value })}
            >
              <option value="existing">Choose an existing person or organisation</option>
              {!editingTransferId && (
                <option value="new">Someone not on the tree — add them</option>
              )}
            </select>
          </label>
          {donationDraft.doneeMode === "existing" ? (
            <label>
              {isDonation ? "Donee" : "Buyer"}
              <select
                aria-label="Existing acquirer"
                data-tax-readiness-field="donation-acquirer"
                data-tax-readiness-target-id={editingTransferId || undefined}
                value={donationDraft.doneeId}
                onChange={(event) => setDonationField({ doneeId: event.target.value })}
              >
                <option value="">Select a person or organisation</option>
                {sortPeopleForChoice(
                  people.filter((person) => person.id !== selectedPerson.id),
                  people,
                ).map((person) => (
                  <option key={person.id} value={person.id}>
                    {personChoiceLabel(person, people)}
                  </option>
                ))}
                {outsideParties
                  .filter((party) => party.id !== selectedPerson.id)
                  .slice()
                  .sort((left, right) =>
                    displayParty(left).localeCompare(displayParty(right), "en-MT", {
                      sensitivity: "base",
                      numeric: true,
                    }),
                  )
                  .map((party) => (
                    <option key={party.id} value={party.id}>
                      {displayParty(party)}
                      {party.type === "company" ? " (company)" : ""}
                    </option>
                  ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                Acquirer type
                <select
                  aria-label="New acquirer type"
                  value={donationDraft.doneeType}
                  onChange={(event) =>
                    setDonationField({
                      doneeType: event.target.value,
                      doneeSex: "",
                      doneeRegistrationNumber: "",
                    })
                  }
                >
                  <option value="individual">Individual</option>
                  <option value="company">Company</option>
                </select>
              </label>
              <label>
                {donationDraft.doneeType === "company"
                  ? "Company name"
                  : isDonation
                    ? "Donee's full name"
                    : "Buyer's full name"}
                <input
                  aria-label="New acquirer full name"
                  value={donationDraft.doneeName}
                  onChange={(event) => setDonationField({ doneeName: event.target.value })}
                  placeholder={donationDraft.doneeType === "company" ? "Company name" : "Full name"}
                />
              </label>
              {donationDraft.doneeType === "company" ? (
                <label>
                  Registration number (optional)
                  <input
                    aria-label="New company registration number"
                    value={donationDraft.doneeRegistrationNumber}
                    onChange={(event) =>
                      setDonationField({ doneeRegistrationNumber: event.target.value })
                    }
                  />
                </label>
              ) : (
                <label>
                  Sex (optional)
                  <select
                    aria-label="New acquirer sex"
                    value={donationDraft.doneeSex}
                    onChange={(event) => setDonationField({ doneeSex: event.target.value })}
                  >
                    <option value="">Not recorded</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </label>
              )}
            </>
          )}
          <label>
            Transfer measurement
            <select
              aria-label="Transfer measurement"
              data-tax-readiness-field="donation-share"
              data-tax-readiness-target-id={editingTransferId || undefined}
              value={donationDraft.amountType}
              onChange={(event) =>
                setDonationField({
                  amountType: event.target.value,
                  designation: {},
                })
              }
            >
              <option value="all-share">All of the Share</option>
              <option value="defined-share">Define fraction or percentage</option>
            </select>
          </label>
          {donationDraft.amountType === "defined-share" && (
            <div className="transfer-definition">
              <label>
                Enter share as
                <select
                  aria-label="Transfer share format"
                  data-tax-readiness-field="donation-share"
                  data-tax-readiness-target-id={editingTransferId || undefined}
                  value={donationDraft.shareInputMode}
                  onChange={(event) =>
                    setDonationField({
                      shareInputMode: event.target.value,
                      designation: {},
                    })
                  }
                >
                  <option value="fraction">Fraction</option>
                  <option value="percentage">Percentage</option>
                </select>
              </label>
              {donationDraft.shareInputMode === "percentage" ? (
                <label>
                  Percentage of the whole property
                  <span className="transfer-percentage">
                    <input
                      aria-label="Transfer percentage"
                      data-tax-readiness-field="donation-share"
                      data-tax-readiness-target-id={editingTransferId || undefined}
                      type="number"
                      min="0"
                      max={Math.min(100, fractionToNumber(donorLedgerHolding) * 100)}
                      step="0.01"
                      inputMode="decimal"
                      value={donationDraft.percentage}
                      onChange={(event) =>
                        setDonationField({ percentage: event.target.value, designation: {} })
                      }
                      onBlur={(event) =>
                        setDonationField({
                          percentage: normalisePercentageInput(event.currentTarget.value),
                          designation: {},
                        })
                      }
                    />
                    <span>%</span>
                  </span>
                </label>
              ) : (
                <div className="transfer-fraction">
                  <label>
                    Numerator
                    <input
                      aria-label="Transfer numerator"
                      data-tax-readiness-field="donation-share"
                      data-tax-readiness-target-id={editingTransferId || undefined}
                      type="number"
                      min="0"
                      max={MAX_FRACTION_INTEGER}
                      step="1"
                      inputMode="numeric"
                      value={donationDraft.numerator}
                      onChange={(event) =>
                        setDonationField({ numerator: event.target.value, designation: {} })
                      }
                    />
                  </label>
                  <span>/</span>
                  <label>
                    Denominator
                    <input
                      aria-label="Transfer denominator"
                      data-tax-readiness-field="donation-share"
                      data-tax-readiness-target-id={editingTransferId || undefined}
                      type="number"
                      min="1"
                      max={MAX_FRACTION_INTEGER}
                      step="1"
                      inputMode="numeric"
                      value={donationDraft.denominator}
                      onChange={(event) =>
                        setDonationField({ denominator: event.target.value, designation: {} })
                      }
                    />
                  </label>
                </div>
              )}
            </div>
          )}
          <div className={`transfer-limit${transferCapacityError ? " unavailable" : ""}`}>
            <span>{transferCapacityError ? "Transfer availability" : "Available to transfer"}</span>
            <strong>
              {transferCapacityError
                ? `Unavailable on ${isoDateToDisplay(donationDraft.date) || "this date"}`
                : `${donorLedgerHolding.numerator}/${donorLedgerHolding.denominator}`}
            </strong>
          </div>
          {displayedTransferError && (
            <p className="transfer-error" id="lifetime-transfer-error" role="alert">
              {displayedTransferError}
            </p>
          )}
          {needsProvenanceDesignation && (
            <div
              className="provenance-designation"
              role="group"
              aria-label="Provenance designation"
            >
              <span className="provenance-heading">Which provenance is being transferred?</span>
              {provenanceTranches.map((tranche) => {
                const entry = donationDraft.designation[tranche.trancheId] || {};
                return (
                  <div className="provenance-row" key={tranche.trancheId}>
                    <label className="provenance-pick">
                      <input
                        type="checkbox"
                        data-tax-readiness-field="donation-provenance"
                        data-tax-readiness-target-id={editingTransferId || undefined}
                        checked={Boolean(entry.checked)}
                        onChange={(event) =>
                          setDonationField({
                            designation: {
                              ...donationDraft.designation,
                              [tranche.trancheId]: {
                                ...entry,
                                checked: event.target.checked,
                              },
                            },
                          })
                        }
                      />
                      <span>
                        <strong>{tranche.provenance}</strong>
                        <small>
                          {`${tranche.fraction.numerator}/${tranche.fraction.denominator} of the property`}
                          {tranche.acquiredOn ? ` — ${isoDateToDisplay(tranche.acquiredOn)}` : ""}
                        </small>
                      </span>
                    </label>
                    {entry.checked && designationCheckedCount > 1 && (
                      <span className="provenance-fraction">
                        <input
                          type="number"
                          data-tax-readiness-field="donation-provenance"
                          data-tax-readiness-target-id={editingTransferId || undefined}
                          min="0"
                          max={MAX_FRACTION_INTEGER}
                          step="1"
                          aria-label={`Numerator from ${tranche.provenance}`}
                          value={entry.numerator || ""}
                          onChange={(event) =>
                            setDonationField({
                              designation: {
                                ...donationDraft.designation,
                                [tranche.trancheId]: {
                                  ...entry,
                                  numerator: event.target.value,
                                },
                              },
                            })
                          }
                        />
                        <span>/</span>
                        <input
                          type="number"
                          data-tax-readiness-field="donation-provenance"
                          data-tax-readiness-target-id={editingTransferId || undefined}
                          min="1"
                          max={MAX_FRACTION_INTEGER}
                          step="1"
                          aria-label={`Denominator from ${tranche.provenance}`}
                          value={entry.denominator || ""}
                          onChange={(event) =>
                            setDonationField({
                              designation: {
                                ...donationDraft.designation,
                                [tranche.trancheId]: {
                                  ...entry,
                                  denominator: event.target.value,
                                },
                              },
                            })
                          }
                        />
                      </span>
                    )}
                  </div>
                );
              })}
              {designationCheckedCount > 1 && (
                <small>Selected fractions must equal the transferred share.</small>
              )}
            </div>
          )}
          {donationDraft.error && (
            <p className="transfer-error" role="alert">
              {donationDraft.error}
            </p>
          )}
          <div className="person-donation-actions">
            <button
              type="submit"
              className="primary-button"
              aria-describedby={displayedTransferError ? "lifetime-transfer-error" : undefined}
            >
              {editingTransferId
                ? isDonation
                  ? "Save donation"
                  : "Save sale"
                : isDonation
                  ? "Record donation"
                  : "Record sale"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                closeTransferEditor();
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    ) : null;
  const setInterVivosDisclosure = (checked) => {
    setDonationOpen(checked);
    if (!checked) {
      setEditingTransferId("");
      setDonationDraft(blankDonationDraft());
    }
    onInterVivosStatusChange?.({
      checked,
      personId: selectedPerson.id,
      propertyId: activeProperty?.id || "",
    });
  };
  const lifetimeTransferSection = interVivosDisclosureOpen ? (
    <section
      id={`inter-vivos-transfer-${selectedPerson.id}`}
      className="estate-flow-step lifetime-transfer-step"
      data-person-section="donation"
    >
      <h3 className="estate-flow-heading">Lifetime transfer</h3>
      {recordedOutgoingInterVivosTransfers.length > 0 && (
        <div className="lifetime-transfer-history" aria-label="Recorded lifetime transfers">
          {recordedOutgoingInterVivosTransfers.map((entry) => {
            const recipient =
              peopleById.get(entry.buyerId) || outsidePartiesById.get(entry.buyerId);
            const amountFraction = entry.amountFraction || ZERO_FRACTION;
            const currentValue =
              recordedPropertySaleValue === null
                ? null
                : roundMoney(recordedPropertySaleValue * fractionToNumber(amountFraction));
            return (
              <div
                className={`lifetime-transfer-record${entry.error ? " invalid" : ""}`}
                key={entry.id}
                data-tax-readiness-transfer-id={entry.id}
              >
                <button
                  type="button"
                  className="lifetime-transfer-summary"
                  aria-label={`Edit ${entry.kind === "donation" ? "donation" : "sale"} record`}
                  aria-expanded={editingTransferId === entry.id}
                  aria-controls={`lifetime-transfer-editor-${selectedPerson.id}`}
                  onClick={() => openTransferEditor(entry.id)}
                >
                  <span>
                    <strong>{entry.kind === "donation" ? "Donation" : "Sale"}</strong>
                    <small>
                      {entry.date ? isoDateToDisplay(entry.date) : "Date not entered"} ·{" "}
                      {recipient ? displayParty(recipient) : "Unknown recipient"}
                    </small>
                  </span>
                  <span>
                    {entry.error ? (
                      <b>Invalid</b>
                    ) : (
                      <>
                        <b>
                          {ownershipLabel(
                            fractionToNumber(amountFraction),
                            ownershipDisplay,
                            amountFraction,
                          )}
                        </b>
                        {currentValue !== null && <small>{money.format(currentValue)}</small>}
                      </>
                    )}
                  </span>
                  <Pencil size={14} aria-hidden="true" />
                </button>
                {onDeleteInterVivosTransfer && entry.id && (
                  <button
                    type="button"
                    className="lifetime-transfer-delete"
                    aria-label={`Delete ${entry.kind === "donation" ? "donation" : "sale"} record`}
                    onClick={() =>
                      onDeleteInterVivosTransfer({
                        propertyId: activeProperty?.id || "",
                        transferId: entry.id,
                      })
                    }
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
                {entry.error && (
                  <small className="lifetime-transfer-error" role="alert">
                    {entry.error}
                  </small>
                )}
              </div>
            );
          })}
        </div>
      )}
      {shareTransferSection ||
        (canDonate && (
          <button
            type="button"
            className="secondary-button lifetime-transfer-add"
            onClick={() => {
              setEditingTransferId("");
              setDonationDraft(blankDonationDraft());
              setDonationOpen(true);
            }}
          >
            {recordedOutgoingInterVivosTransfers.length > 0
              ? "Add another transfer"
              : "Add transfer"}
          </button>
        )) ||
        (!fullyTransferredInterVivos && (
          <p className="transfer-unavailable">
            {activeProperty ? "No share is available to transfer." : "Add initial ownership first."}
          </p>
        ))}
    </section>
  ) : null;

  return (
    <div className="person-inspector">
      <section className="inspector-profile">
        <div className={`person-avatar ${selectedPerson.sex?.toLowerCase() || "unknown"}`}>
          {initials(selectedDisplayName)}
        </div>
        <div>
          <h2>{selectedDisplayName}</h2>
        </div>
        {!isEditing && (
          <div className="person-profile-actions">
            <button type="button" className="person-edit-button" onClick={() => setIsEditing(true)}>
              <Pencil size={15} aria-hidden="true" />
              Edit identity
            </button>
          </div>
        )}
      </section>

      {!legalWorkspaceEnabled && (
        <section className="family-tree-only-notice" aria-label="Family tree only">
          <strong>Family tree only</strong>
          <span>
            Add people and relationships now. Dates are optional, legal and tax checks are off, and
            the tree can be printed at any time.
          </span>
        </section>
      )}

      <section className="inspector-section" data-person-section="relationships">
        <div className="inspector-section-heading">
          <div>
            <p className="eyebrow">Relationships</p>
            <h3>Add around this person</h3>
          </div>
        </div>
        <div className="relationship-actions">
          {relationshipActions.map(({ key, label, icon: Icon }) => (
            <button
              type="button"
              key={key}
              disabled={
                !identityComplete ||
                (["child", "marriage", "partnership"].includes(key) &&
                  !binaryRelationshipRoleAvailable) ||
                ((key === "father" || key === "mother") && relationshipCounts[key] > 0)
              }
              title={
                !identityComplete
                  ? identityMessage
                  : ["child", "marriage", "partnership"].includes(key) &&
                      !binaryRelationshipRoleAvailable
                    ? "Choose Male or Female before adding this relationship so its family role is recorded correctly."
                    : (key === "father" || key === "mother") && relationshipCounts[key] > 0
                      ? `${label} already added`
                      : `Add ${label.toLowerCase()}`
              }
              aria-expanded={
                key === "marriage" || key === "partnership"
                  ? spouseChooserOpen &&
                    partnerRelationshipType ===
                      (key === "marriage"
                        ? PARTNER_RELATIONSHIP_TYPES.MARRIAGE
                        : PARTNER_RELATIONSHIP_TYPES.PARTNERSHIP)
                  : undefined
              }
              onClick={() =>
                key === "marriage" || key === "partnership"
                  ? togglePartnerChooser(
                      key === "marriage"
                        ? PARTNER_RELATIONSHIP_TYPES.MARRIAGE
                        : PARTNER_RELATIONSHIP_TYPES.PARTNERSHIP,
                    )
                  : key === "child"
                    ? addChild()
                    : addRelative(key)
              }
            >
              <Icon size={16} />
              {label}
              {relationshipActionCounts[key] > 0 && (
                <span
                  className="relationship-count"
                  aria-label={`${relationshipActionCounts[key]} linked`}
                >
                  {relationshipActionCounts[key]}
                </span>
              )}
            </button>
          ))}
        </div>
        {!identityComplete && (
          <p className="relationship-prerequisite" role="status">
            Identify this person first: {identityIssues.join(", ")}.
          </p>
        )}
        {parentage && <p className="person-parentage">{parentage}</p>}
        {spouseChooserOpen && identityComplete && (
          <div className="spouse-chooser">
            <strong>
              {partnerRelationshipType === PARTNER_RELATIONSHIP_TYPES.MARRIAGE
                ? "Add a wife or husband"
                : "Add an unmarried partner"}
            </strong>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                addRelative(
                  partnerRelationshipType === PARTNER_RELATIONSHIP_TYPES.MARRIAGE
                    ? "marriage"
                    : "partnership",
                );
                setSpouseChooserOpen(false);
              }}
            >
              <UserRound size={15} />
              Create new{" "}
              {partnerRelationshipType === PARTNER_RELATIONSHIP_TYPES.MARRIAGE
                ? "wife / husband"
                : "partner"}
            </button>
            <span>or link an existing person</span>
            <p className="partner-eligibility-note">
              Only an opposite-sex person may be linked as a wife, husband or unmarried partner.{" "}
              Direct relatives, siblings, uncles, aunts, nephews and nieces are excluded; cousins
              and more distant relatives remain available.
            </p>
            <div>
              <select
                aria-label="Existing partner"
                value={existingSpouseId}
                disabled={!existingSpouseCandidates.length}
                onChange={(event) => setExistingSpouseId(event.target.value)}
              >
                <option value="">
                  {existingSpouseCandidates.length
                    ? "Choose from family list"
                    : "No eligible unlinked people available"}
                </option>
                {existingSpouseCandidates.map((person) => (
                  <option key={person.id} value={person.id}>
                    {personChoiceLabel(person, people)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="primary-button"
                disabled={!existingSpouseId}
                onClick={linkExistingSpouse}
              >
                <Heart size={15} />
                Link{" "}
                {partnerRelationshipType === PARTNER_RELATIONSHIP_TYPES.MARRIAGE
                  ? "wife / husband"
                  : "partner"}
              </button>
            </div>
          </div>
        )}
        {childPartnerChooserOpen && identityComplete && (
          <div className="spouse-chooser child-partner-chooser">
            <span>Choose the other parent for this child</span>
            <div>
              <select
                aria-label="Child's other parent"
                value={childPartnerId}
                onChange={(event) => setChildPartnerId(event.target.value)}
              >
                <option value="">No other parent assigned yet</option>
                {sortPeopleForChoice(linkedPartners, people).map((person) => (
                  <option key={person.id} value={person.id}>
                    {personChoiceLabel(person, people)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  addRelative("child", childPartnerId);
                  closeChildPartnerChooser();
                }}
              >
                <Baby size={15} />
                Add child
              </button>
            </div>
          </div>
        )}
        {relevantParentSuggestions.length > 0 && (
          <div className="parent-suggestion-list">
            <strong>Parent links to confirm</strong>
            {relevantParentSuggestions.map((suggestion) => {
              const child = peopleById.get(suggestion.personId);
              const recordedParent = peopleById.get(suggestion.viaParentId);
              const suggestedParent = peopleById.get(suggestion.suggestedPersonId);
              const relationship = suggestion.field === "motherId" ? "mother" : "father";
              return (
                <article
                  className="parent-suggestion"
                  key={`${suggestion.personId}-${suggestion.field}-${suggestion.suggestedPersonId}`}
                >
                  <p>
                    {displayName(child)} has no {relationship} recorded.{" "}
                    {displayName(recordedParent)}&apos;s only recorded partner is{" "}
                    {displayName(suggestedParent)}. Set {displayName(suggestedParent)} as the{" "}
                    {relationship}?
                  </p>
                  <span>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => acceptParentSuggestion(suggestion)}
                    >
                      <Check size={14} /> Accept
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => dismissParentSuggestion(suggestion)}
                    >
                      Dismiss
                    </button>
                  </span>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="inspector-section" data-person-section="identity">
        <p className="eyebrow">Personal details</p>
        <BufferedIdentityFields
          person={selectedPerson}
          disabled={!isEditing}
          legalWorkspaceEnabled={legalWorkspaceEnabled}
          onCommit={updatePersonFromIdentityDraft}
          onRegisterPendingEditFlush={registerIdentityDraftController}
        />
        <div className="person-status-controls">
          <div className="person-status-control" role="group" aria-label="Sex">
            <span>Sex</span>
            <span className="sex-checkbox-options">
              {["Female", "Male", "Other"].map((sex) => (
                <label className="detail-checkbox" key={sex}>
                  <input
                    data-person-field="sex"
                    type="radio"
                    name={`sex-${selectedPerson.id}`}
                    checked={selectedPerson.sex === sex}
                    onChange={() => updateSex(sex)}
                  />
                  {sex}
                </label>
              ))}
            </span>
          </div>
          <label className="person-status-control deceased-status-control">
            <span>Status</span>
            <span className="detail-checkbox">
              <input
                type="checkbox"
                checked={isDeceased}
                onChange={(event) => setDeceased(event.target.checked)}
              />
              This person is deceased.
            </span>
          </label>
          {legalWorkspaceEnabled && (
            <label
              className={`person-status-control inter-vivos-status-control${
                fullyTransferredInterVivos ? " completed" : ""
              }`}
            >
              <span>Transfer</span>
              <span className="detail-checkbox">
                <input
                  type="checkbox"
                  aria-label="Sold/Donated Property Share"
                  aria-controls={`inter-vivos-transfer-${selectedPerson.id}`}
                  aria-expanded={interVivosDisclosureOpen}
                  checked={interVivosDisclosureOpen}
                  onChange={(event) => setInterVivosDisclosure(event.target.checked)}
                />
                Sold/Donated Property Share
              </span>
            </label>
          )}
        </div>

        {legalWorkspaceEnabled && missingIntestateParentRoles.length > 0 && (
          <section className="potential-parent-survival-alert" role="alert">
            <strong>Possible parent inheritance needs confirmation</strong>
            <p>
              The family tree does not identify {missingIntestateParentRoles.join(" or ")} for this
              person. Add the missing parent record only if you want the calculator to provisionally
              treat that parent as a surviving intestate heir.
            </p>
            <button
              type="button"
              className="secondary-button"
              onClick={createMissingIntestateParents}
            >
              Add missing {missingIntestateParentRoles.length > 1 ? "parents" : "parent"}
            </button>
          </section>
        )}

        {legalWorkspaceEnabled && isPotentialParentSurvivalUnresolved(selectedPerson) && (
          <section
            className="potential-parent-survival-alert"
            role="alert"
            data-person-section="survival"
          >
            <strong>Establish whether this parent survived</strong>
            <p>
              Confirm whether {selectedDisplayName} was alive or had already died when{" "}
              {survivalReferencePerson ? displayName(survivalReferencePerson) : "the child"} died
              {survivalReferencePerson?.dateOfDeath
                ? ` on ${isoDateToDisplay(survivalReferencePerson.dateOfDeath)}`
                : ""}
              . The calculator treats this parent as a provisional surviving heir until that fact is
              established.
            </p>
            <div>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  updateSelected({
                    isDeceased: false,
                    designations: personDesignations(selectedPerson).filter(
                      (designation) => String(designation).toLowerCase() !== "deceased",
                    ),
                    dateOfDeath: "",
                    survivalStatusRequired: false,
                    survivalStatusConfirmed: "alive",
                  })
                }
              >
                Confirm alive
              </button>
              {!isDeceased && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setDeceased(true)}
                >
                  Mark as deceased
                </button>
              )}
            </div>
            {isDeceased && <small>Enter the date of death below to establish survivorship.</small>}
          </section>
        )}

        <div className="person-edit-fields person-record-fields">
          {isDeceased && !legalWorkspaceEnabled && (
            <div className="family-tree-life-details">
              <h3>Life details</h3>
              <label className="succession-detail-row succession-death-date">
                <span>
                  Date of death <small>(optional)</small>
                </span>
                <BufferedPersonRecordInput
                  key={`${selectedPerson.id}:death-date-text`}
                  personId={selectedPerson.id}
                  onRegisterController={registerPersonRecordInputController}
                  applyDraft={personWithBufferedDeathDateText}
                  type="text"
                  aria-label="Date of death (optional)"
                  autoComplete="off"
                  maxLength={120}
                  placeholder="e.g. 1858, about 1858, or 11 February 1858"
                  value={genealogyDeathDateText(selectedPerson)}
                  disabled={selectedPerson.dateOfDeathUnknown === true}
                />
              </label>
              <label className="succession-detail-row succession-death-date-unknown">
                <span>Date status</span>
                <span className="detail-checkbox">
                  <input
                    type="checkbox"
                    aria-label="Date of death unknown"
                    checked={selectedPerson.dateOfDeathUnknown === true}
                    onChange={(event) => updateDateOfDeathUnknown(event.target.checked)}
                  />
                  Date of death unknown
                </span>
              </label>
              <p>An exact date, a year, or an approximate date may be recorded here.</p>
            </div>
          )}
          {isDeceased && legalWorkspaceEnabled && (
            <div
              className={`person-succession${fullyTransferredInterVivos ? " fully-transferred" : ""}`}
              data-person-section="succession"
            >
              <h3 className="estate-flow-heading">Death details</h3>
              <label className="succession-detail-row succession-death-date">
                <span>Date of death</span>
                <DateInput
                  data-person-field="date-of-death"
                  value={selectedPerson.dateOfDeath || ""}
                  disabled={selectedPerson.dateOfDeathUnknown === true}
                  onChange={updateDateOfDeath}
                />
              </label>
              <label className="succession-detail-row succession-death-date-unknown">
                <span>Date status</span>
                <span className="detail-checkbox">
                  <input
                    type="checkbox"
                    aria-label="Date of death unknown"
                    checked={selectedPerson.dateOfDeathUnknown === true}
                    onChange={(event) => updateDateOfDeathUnknown(event.target.checked)}
                  />
                  Date of death unknown
                </span>
              </label>
              {selectedPerson.dateOfDeathUnknown === true && (
                <small className="succession-marital-status-note">
                  If a linked spouse has an exact death date, succession and tax calculations use
                  that same date for this person without changing the historical record.
                </small>
              )}
              {!spouseSurvivalNotMaterialToOwnership && (
                <>
                  <label className="succession-detail-row marital-status-at-death">
                    <span>Marital status at death</span>
                    <span className="detail-checkbox">
                      <input
                        type="checkbox"
                        aria-label="No spouse survived the deceased"
                        checked={selectedPerson.unmarriedOrWidowedAtDeath === true}
                        onChange={(event) =>
                          updateSelected({
                            unmarriedOrWidowedAtDeath: event.target.checked,
                            unmarriedOrWidowedAtDeathSource: MARITAL_STATUS_AT_DEATH_SOURCES.MANUAL,
                          })
                        }
                      />
                      No spouse survived the deceased
                    </span>
                  </label>
                  {selectedPerson.unmarriedOrWidowedAtDeath === true && excludedSpouseNames && (
                    <small
                      className="succession-marital-status-note succession-warning"
                      role="alert"
                    >
                      {excludedSpouseNames} is excluded from this succession while this setting is
                      selected. Clear it if the linked spouse survived.
                    </small>
                  )}
                </>
              )}
              {lifetimeTransferSection}
              {propertyShareSummary}
              {!fullyTransferredInterVivos && (
                <div className="estate-succession-step">
                  <h3 className="estate-flow-heading">Succession</h3>
                  <label className="succession-detail-row">
                    <span>Estate</span>
                    <select
                      aria-label="Inheritance basis"
                      value={inheritanceBasis}
                      onChange={(event) => updateSelected({ inheritanceBasis: event.target.value })}
                    >
                      <option value="intestacy">Intestate</option>
                      <option value="will">Testate</option>
                    </select>
                  </label>
                  {testateHistoricalLawWarning && (
                    <p className="succession-warning" role="alert">
                      {testateHistoricalLawWarning}
                    </p>
                  )}

                  {inheritanceBasis === "intestacy" ? (
                    <IntestateHeirConfirmation
                      deceased={selectedPerson}
                      people={people}
                      outsideParties={outsideParties}
                      calculated={automaticIntestacy}
                      shareDisplay={ownershipDisplay}
                      displayName={displayParty}
                      onUpdatePerson={updatePerson}
                      onCreateOutsideParty={onOutsidePartiesChange ? createOutsideParty : undefined}
                      onSelectPerson={onSelectPerson}
                    />
                  ) : (
                    <div className="will-details">
                      <div className="will-records-heading">
                        <div>
                          <strong>Wills</strong>
                          <small>The latest dated will applies.</small>
                        </div>
                        <button
                          type="button"
                          className="secondary-button"
                          data-tax-readiness-field="add-will"
                          onClick={addWill}
                        >
                          <FilePlus2 size={14} /> Add will
                        </button>
                      </div>
                      <div className="will-records">
                        {displayedWills.map((will, index) => {
                          const isLatest = latestWill?.id === will.id;
                          const chronologyError = recordedWills.length
                            ? willChronologyErrors.get(will.id)
                            : "";
                          return (
                            <section
                              className={`will-record ${chronologyError ? "chronology-invalid" : ""}`}
                              key={will.id}
                            >
                              <div className="will-record-heading">
                                <strong>Will {index + 1}</strong>
                                <span>
                                  {isLatest && (
                                    <small className="will-applies">Latest — applies</small>
                                  )}
                                  {recordedWills.length > 0 && (
                                    <button
                                      type="button"
                                      className="icon-button"
                                      aria-label={`Remove will ${index + 1}`}
                                      onClick={() => removeWill(will.id)}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </span>
                              </div>
                              <label>
                                <span>Will date</span>
                                <DateInput
                                  data-tax-readiness-field="will-date"
                                  data-tax-readiness-target-id={will.id}
                                  aria-label={`Will date ${index + 1}`}
                                  value={will.date || ""}
                                  onChange={(value) => updateWill(will.id, { date: value })}
                                />
                              </label>
                              {chronologyError && (
                                <small className="succession-warning" role="alert">
                                  {chronologyError}
                                </small>
                              )}
                              <label>
                                <span>Notary (optional)</span>
                                <BufferedPersonRecordInput
                                  key={`${selectedPerson.id}:${will.id}:notaryName`}
                                  personId={selectedPerson.id}
                                  onRegisterController={registerPersonRecordInputController}
                                  applyDraft={(person, value) =>
                                    personWithBufferedWillField(
                                      person,
                                      will.id,
                                      "notaryName",
                                      value,
                                    )
                                  }
                                  aria-label={`Notary for will ${index + 1}`}
                                  value={will.notaryName || ""}
                                  placeholder="Notary's name"
                                />
                              </label>
                              <label>
                                <span>Description (optional)</span>
                                <BufferedPersonRecordInput
                                  key={`${selectedPerson.id}:${will.id}:description`}
                                  personId={selectedPerson.id}
                                  onRegisterController={registerPersonRecordInputController}
                                  applyDraft={(person, value) =>
                                    personWithBufferedWillField(
                                      person,
                                      will.id,
                                      "description",
                                      value,
                                    )
                                  }
                                  aria-label={`Description for will ${index + 1}`}
                                  value={will.description || ""}
                                  placeholder="e.g. UK will"
                                />
                              </label>
                            </section>
                          );
                        })}
                      </div>
                      <IntestacyProposal
                        calculated={automaticIntestacy}
                        people={people}
                        displayName={displayParty}
                        shareDisplay={ownershipDisplay}
                        title="Suggested Heirs"
                        selectedPersonIds={selectedSuggestedWillHeirIds}
                        onSelectedPersonIdsChange={setSelectedSuggestedWillHeirs}
                      />
                      <div className="will-beneficiaries">
                        <div className="will-beneficiaries-heading">
                          <strong>Beneficiaries under the latest will</strong>
                          <span>
                            <button
                              type="button"
                              className="text-button"
                              data-tax-readiness-field="add-will-beneficiary"
                              onClick={addWillHeir}
                            >
                              Add beneficiary
                            </button>
                            {onOutsidePartiesChange && (
                              <button
                                type="button"
                                className="text-button"
                                aria-expanded={willOutsidePartyOpen}
                                onClick={() => setWillOutsidePartyOpen((open) => !open)}
                              >
                                Add unconnected heir
                              </button>
                            )}
                          </span>
                        </div>
                        {willOutsidePartyOpen && (
                          <OutsidePartyCreator
                            onCreate={addOutsideWillHeir}
                            onCancel={() => setWillOutsidePartyOpen(false)}
                          />
                        )}
                        {willHeirs.map((heir, heirIndex) => {
                          const fraction = fractionForShare(heir);
                          const numerator = heir.shareNumerator ?? fraction.numerator;
                          const denominator = heir.shareDenominator ?? fraction.denominator;
                          return (
                            <div className={`will-heir-row ${ownershipDisplay}`} key={heir.id}>
                              <select
                                data-tax-readiness-field="will-beneficiary"
                                data-tax-readiness-target-id={heir.id}
                                aria-label="Will beneficiary"
                                value={heir.personId || ""}
                                onChange={(event) =>
                                  updateWillHeir(heir.id, { personId: event.target.value })
                                }
                              >
                                <option value="">Choose person or company</option>
                                <optgroup label="People on the family tree">
                                  {sortPeopleForChoice(
                                    people.filter((person) => person.id !== selectedPerson.id),
                                    people,
                                  ).map((person) => (
                                    <option key={person.id} value={person.id}>
                                      {personChoiceLabel(person, people)}
                                    </option>
                                  ))}
                                </optgroup>
                                {outsideParties.length > 0 && (
                                  <optgroup label="Unconnected people and companies">
                                    {[...outsideParties]
                                      .sort((first, second) =>
                                        partyDisplayName(first).localeCompare(
                                          partyDisplayName(second),
                                          "en-MT",
                                          { sensitivity: "base", numeric: true },
                                        ),
                                      )
                                      .map((party) => (
                                        <option key={party.id} value={party.id}>
                                          {partyDisplayName(party)}
                                          {party.type === "company"
                                            ? " (company)"
                                            : " (unconnected)"}
                                        </option>
                                      ))}
                                  </optgroup>
                                )}
                              </select>
                              {ownershipDisplay !== "percentage" && (
                                <span className="will-heir-fraction">
                                  <BufferedPersonRecordInput
                                    key={`${selectedPerson.id}:${heir.id}:numerator`}
                                    personId={selectedPerson.id}
                                    retainTouchedDraft
                                    onRegisterController={registerPersonRecordInputController}
                                    applyDraft={(person, value) =>
                                      personWithBufferedWillHeirFraction(
                                        person,
                                        heir.id,
                                        "numerator",
                                        value,
                                      )
                                    }
                                    data-tax-readiness-field="will-beneficiary-share"
                                    data-tax-readiness-target-id={heir.id}
                                    aria-label="Will share numerator"
                                    type="number"
                                    min="0"
                                    max={MAX_FRACTION_INTEGER}
                                    step="1"
                                    value={numerator}
                                  />
                                  <b>/</b>
                                  <BufferedPersonRecordInput
                                    key={`${selectedPerson.id}:${heir.id}:denominator`}
                                    personId={selectedPerson.id}
                                    retainTouchedDraft
                                    onRegisterController={registerPersonRecordInputController}
                                    applyDraft={(person, value) =>
                                      personWithBufferedWillHeirFraction(
                                        person,
                                        heir.id,
                                        "denominator",
                                        value,
                                      )
                                    }
                                    data-tax-readiness-field="will-beneficiary-share"
                                    data-tax-readiness-target-id={heir.id}
                                    aria-label="Will share denominator"
                                    type="number"
                                    min="1"
                                    max={MAX_FRACTION_INTEGER}
                                    step="1"
                                    value={denominator}
                                  />
                                </span>
                              )}
                              {ownershipDisplay !== "fraction" && (
                                <span className="will-heir-percent">
                                  <BufferedPersonRecordInput
                                    key={`${selectedPerson.id}:${heir.id}:percentage`}
                                    personId={selectedPerson.id}
                                    commitUnchangedOnBlur={heir.sharePercentInput !== undefined}
                                    formatDraftAfterCommit={normalisePercentageInput}
                                    retainTouchedDraft
                                    onRegisterController={registerPersonRecordInputController}
                                    applyDraft={(person, value, options) =>
                                      personWithBufferedWillHeirPercentage(
                                        person,
                                        heir.id,
                                        value,
                                        options,
                                      )
                                    }
                                    data-tax-readiness-field="will-beneficiary-share"
                                    data-tax-readiness-target-id={heir.id}
                                    aria-label="Will share percentage"
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.01"
                                    inputMode="decimal"
                                    value={
                                      willPercentageDisplay.rows[heirIndex]?.displayPercentage ??
                                      heir.sharePercent ??
                                      ""
                                    }
                                  />
                                  <b>%</b>
                                </span>
                              )}
                              <button
                                type="button"
                                className="icon-button"
                                aria-label="Remove will beneficiary"
                                onClick={() => removeWillHeir(heir.id)}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          );
                        })}
                        <small
                          className={
                            willReadiness.valid
                              ? "succession-total valid"
                              : "succession-total invalid"
                          }
                        >
                          Total:{" "}
                          {ownershipLabel(
                            willTotal / 100,
                            ownershipDisplay,
                            null,
                            willPercentageDisplay.totalDisplayPercentageLabel,
                          )}{" "}
                          {willReadiness.valid
                            ? "✓"
                            : willReadiness.totalComplete
                              ? `— ${willReadiness.issues[0]}`
                              : `— must equal ${
                                  ownershipDisplay === "fraction"
                                    ? "1/1"
                                    : ownershipDisplay === "percentage"
                                      ? "100%"
                                      : "1/1 · 100%"
                                }`}
                        </small>
                      </div>
                    </div>
                  )}

                  {isPreCausaMortisCutoff && (
                    <p className="helper-text causa-mortis-not-applicable">
                      No Causa Mortis declaration: death before 25/11/1992.
                      {inheritedShareStillHeldBySurvivor
                        ? " A later sale of this inherited share is taxed at 7% (Article 5A(5)(c)(i))."
                        : ""}
                    </p>
                  )}

                  {requiresCausaMortisDetails && (
                    <CausaMortisSection
                      declarations={causaMortisDeclarations}
                      coverage={causaMortisCoverage}
                      properties={properties}
                      candidates={declarationCandidates}
                      candidateLabel={personSelectionLabel}
                      dateOfDeath={effectiveSelectedDeathDate}
                      hasUnknownDeathDate={hasUnknownCausaMortisDeathDate}
                      errors={causaMortisErrors}
                      taxValuePropertyId={properties[0]?.id || ""}
                      taxValueRequired={taxCausaMortisValueRequiredForPerson}
                      taxRequiredDeclarationIds={taxRequiredCausaMortisDeclarationIds}
                      onAddDeclaration={handleCausaMortisDeclarationAction}
                      onAddDeclarationForProperty={handleCausaMortisCoverageAction}
                      onRemoveDeclaration={removeCausaMortisDeclaration}
                      onCompleteDeclaration={completeCausaMortisDeclaration}
                    />
                  )}
                </div>
              )}
            </div>
          )}
          {!isDeceased && legalWorkspaceEnabled && propertyShareSummary}
          {!isDeceased && legalWorkspaceEnabled && lifetimeTransferSection}
          {linkedPartners.length > 0 && (
            <div className="person-partner-links" data-person-section="partner-details">
              <span>Marriage / partner links</span>
              <div>
                {linkedPartners.map((partner) => {
                  const sharedChildren = sharedChildrenByPartnerId.get(partner.id) || [];
                  const relationship = partnerRelationshipsById.get(partner.id);
                  const relationshipState =
                    relationship?.type === PARTNER_RELATIONSHIP_TYPES.PARTNERSHIP
                      ? "partnership"
                      : relationship?.endDate || relationship?.endReason
                        ? "former-marriage"
                        : "marriage";
                  const relationshipLabel =
                    relationshipState === "partnership" ? "Partnership" : "Marriage";
                  const relationshipErrors = legalWorkspaceEnabled
                    ? validateRelationshipDateChronology({
                        startDate:
                          relationshipState === "partnership" ? relationship?.startDate || "" : "",
                        endDate: relationship?.endDate || "",
                        personDateOfDeath: selectedPerson.dateOfDeath || "",
                        partnerDateOfDeath: partner.dateOfDeath || "",
                        personLabel: displayName(selectedPerson),
                        partnerLabel: displayName(partner),
                        relationshipLabel,
                        endDateRequired: relationshipState === "former-marriage",
                      })
                    : [];
                  return (
                    <div
                      className={`person-partner-link-row ${
                        relationshipErrors.length ? "chronology-invalid" : ""
                      }`}
                      key={partner.id}
                    >
                      <span className="person-partner-link-identity">
                        <strong>{displayName(partner)}</strong>
                        {sharedChildren.length > 0 && (
                          <small>
                            Reassign {sharedChildren.length} shared{" "}
                            {sharedChildren.length === 1 ? "child" : "children"} first.
                          </small>
                        )}
                      </span>
                      <select
                        data-tax-readiness-field="partner-relationship"
                        data-tax-readiness-target-id={partner.id}
                        aria-label={`Relationship type with ${displayName(partner)}`}
                        value={relationshipState}
                        onChange={(event) => {
                          const nextState = event.target.value;
                          if (nextState === "partnership") {
                            updatePartnerLink(partner.id, {
                              type: PARTNER_RELATIONSHIP_TYPES.PARTNERSHIP,
                              endDate: "",
                              endReason: "",
                            });
                            return;
                          }
                          updatePartnerLink(partner.id, {
                            type: PARTNER_RELATIONSHIP_TYPES.MARRIAGE,
                            startDate: "",
                            startYear: "",
                            endDate: nextState === "former-marriage" ? relationship?.endDate : "",
                            endReason: nextState === "former-marriage" ? "divorce" : "",
                          });
                        }}
                      >
                        <option value="marriage">Married</option>
                        <option value="former-marriage">Former marriage / divorced</option>
                        <option value="partnership">Unmarried partners</option>
                      </select>
                      <span className="person-partner-dates">
                        {relationshipState === "partnership" && (
                          <label>
                            <span>Partnership started</span>
                            <DateInput
                              aria-label={`Partnership start date with ${displayName(partner)}`}
                              value={relationship?.startDate || ""}
                              onChange={(value) =>
                                updatePartnerLink(partner.id, {
                                  startDate: value,
                                })
                              }
                            />
                          </label>
                        )}
                        {relationshipState === "former-marriage" && (
                          <label>
                            <span>Marriage ended</span>
                            <DateInput
                              data-tax-readiness-field="partner-marriage-end-date"
                              data-tax-readiness-target-id={partner.id}
                              aria-label={`Marriage end date with ${displayName(partner)}`}
                              value={relationship?.endDate || ""}
                              onChange={(value) =>
                                updatePartnerLink(partner.id, {
                                  endDate: value,
                                  endReason: "divorce",
                                })
                              }
                            />
                          </label>
                        )}
                        {relationshipErrors.map((error) => (
                          <small className="succession-warning" role="alert" key={error}>
                            {error}
                          </small>
                        ))}
                      </span>
                      <button
                        type="button"
                        disabled={sharedChildren.length > 0}
                        title={
                          sharedChildren.length
                            ? "Reassign the shared children's parents before removing this link."
                            : "Remove this partner link"
                        }
                        onClick={() => removePartnerLink(partner.id)}
                        aria-label={`Remove partner link to ${displayName(partner)}`}
                      >
                        Remove link
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {explicitSiblingOnlyLinks.length > 0 && (
            <div className="person-partner-links person-sibling-links">
              <span>Sibling links</span>
              <div>
                {explicitSiblingOnlyLinks.map((sibling) => (
                  <span key={sibling.id}>
                    <span className="person-partner-link-identity">
                      <strong>{displayName(sibling)}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeSiblingLink(sibling.id)}
                      aria-label={`Remove sibling link to ${displayName(sibling)}`}
                    >
                      Remove link
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="person-delete-control">
            <button
              type="button"
              className="danger-button"
              data-person-action="delete"
              disabled={deleteDisabled}
              onClick={removeSelected}
            >
              <Trash2 size={15} aria-hidden="true" />
              {personFamilyGroupCount > 1 ? "Remove from this family" : "Delete person"}
            </button>
            {isEditing && (
              <button
                type="button"
                className="person-edit-button active"
                data-person-action="done-editing"
                onClick={() => {
                  const controller = identityDraftControllerRef.current;
                  if (controller?.flush?.() === false || controller?.hasPending?.()) return;
                  setIsEditing(false);
                }}
              >
                <Check size={15} aria-hidden="true" />
                Done
              </button>
            )}
            <small>{deleteMessage}</small>
          </div>
        </div>
      </section>
    </div>
  );
}
