import { isCausaMortisCoverageActionRequired } from "./causaMortisPresentation.js";
import { isValidIsoDate } from "./dateFormat.js";
import { effectiveDateOfDeath, isMarkedDeceased } from "./deceasedStatus.js";
import { requiredSpouseDeathDatePersonIds, willAllocationReadiness } from "./familyOwnership.js";
import { normalizePartnerRelationships } from "./partnerRelationships.js";
import { personIdentityIssues } from "./people.js";
import { fractionForShare } from "./shares.js";
import { operativeWill, personWills } from "./wills.js";

export const TAX_READINESS_GUIDE_VERSION = 1;

const text = (value) => String(value || "").trim();

const positiveOwner = (owner = {}) => {
  const fraction = fractionForShare(owner);
  return Number(fraction.denominator) > 0 && Number(fraction.numerator) > 0;
};

const personIndex = (people = []) =>
  new Map(people.map((person, index) => [person.id, { person, index }]));

const childrenIndex = (people = []) => {
  const children = new Map();
  people.forEach((person, index) => {
    [person.fatherId, person.motherId].filter(Boolean).forEach((parentId) => {
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push({ person, index });
    });
  });
  return children;
};

const chronologicalPeople = (entries = []) =>
  [...entries].sort((first, second) => {
    const firstDeath = isValidIsoDate(first.person.dateOfDeath) ? first.person.dateOfDeath : "";
    const secondDeath = isValidIsoDate(second.person.dateOfDeath) ? second.person.dateOfDeath : "";
    // Exact deaths form one chronological group, followed by branches whose
    // death chronology is still unknown. This is a total ordering; mixing
    // death and birth comparisons pair-by-pair is non-transitive.
    if (firstDeath !== secondDeath) {
      if (!firstDeath) return 1;
      if (!secondDeath) return -1;
      return firstDeath.localeCompare(secondDeath);
    }
    const firstBirth = isValidIsoDate(first.person.dateOfBirth) ? first.person.dateOfBirth : "";
    const secondBirth = isValidIsoDate(second.person.dateOfBirth) ? second.person.dateOfBirth : "";
    if (firstBirth && secondBirth && firstBirth !== secondBirth) {
      return firstBirth.localeCompare(secondBirth);
    }
    if (firstBirth !== secondBirth) return firstBirth ? -1 : 1;
    return first.index - second.index || first.person.id.localeCompare(second.person.id);
  });

/**
 * Family-structured review order for a property's person cards.
 *
 * Initial-owner row order is stable. When both spouses are initial owners the
 * male spouse is visited first; a sole female owner is never moved behind an
 * unrecorded owner. Each branch is then walked person, partner(s), children.
 */
export function buildTaxReadinessPersonOrder(property = {}, people = [], propertyReport = null) {
  const normalizedPeople = normalizePartnerRelationships(people);
  const byId = personIndex(normalizedPeople);
  const childrenByParent = childrenIndex(normalizedPeople);
  const partnersById = new Map(
    normalizedPeople.map((person) => [
      person.id,
      [...new Set(person.spouseIds || [])].filter((partnerId) => byId.has(partnerId)),
    ]),
  );
  const ownerIds = (property.owners || [])
    .filter(positiveOwner)
    .map((owner) => text(owner.personId))
    .filter((personId, index, values) => byId.has(personId) && values.indexOf(personId) === index);
  const ownerSet = new Set(ownerIds);

  const ownerPosition = new Map(ownerIds.map((personId, index) => [personId, index]));
  const groupedOwnerIds = [];
  const groupedOwners = new Set();
  ownerIds.forEach((ownerId) => {
    if (groupedOwners.has(ownerId)) return;
    const component = [];
    const queue = [ownerId];
    while (queue.length) {
      const personId = queue.shift();
      if (groupedOwners.has(personId) || !ownerSet.has(personId)) continue;
      groupedOwners.add(personId);
      component.push(personId);
      (partnersById.get(personId) || []).forEach((partnerId) => {
        if (ownerSet.has(partnerId) && !groupedOwners.has(partnerId)) queue.push(partnerId);
      });
    }
    component.sort((firstId, secondId) => {
      const sexRank = (personId) => {
        const sex = text(byId.get(personId)?.person.sex).toLowerCase();
        return sex === "male" ? 0 : sex === "female" ? 1 : 2;
      };
      return (
        sexRank(firstId) - sexRank(secondId) ||
        ownerPosition.get(firstId) - ownerPosition.get(secondId)
      );
    });
    groupedOwnerIds.push(...component);
  });

  const ordered = [];
  const visited = new Set();
  const visitBranches = (personId) => {
    const partnerIds = (partnersById.get(personId) || []).filter(
      (partnerId) => byId.has(partnerId) && !visited.has(partnerId),
    );
    const handledChildIds = new Set();
    partnerIds.forEach((partnerId) => {
      visited.add(partnerId);
      ordered.push(partnerId);
      const sharedChildren = (childrenByParent.get(personId) || []).filter(({ person }) => {
        const parentIds = new Set([person.fatherId, person.motherId].filter(Boolean));
        return parentIds.has(partnerId);
      });
      chronologicalPeople(sharedChildren).forEach(({ person }) => {
        handledChildIds.add(person.id);
        visit(person.id);
      });
      // The spouse may have another recorded union. Walk that spouse's own
      // remaining family block after this couple's children, rather than
      // treating the spouse as fully visited and silently dropping it.
      visitBranches(partnerId);
    });
    chronologicalPeople(
      (childrenByParent.get(personId) || []).filter(
        ({ person }) => !handledChildIds.has(person.id),
      ),
    ).forEach(({ person }) => visit(person.id));
  };
  function visit(personId) {
    if (!byId.has(personId) || visited.has(personId)) return;
    visited.add(personId);
    ordered.push(personId);
    visitBranches(personId);
  }

  groupedOwnerIds.forEach(visit);

  // Resolved and unresolved transmissions can introduce ascendants, collateral
  // heirs or beneficiaries outside a simple descendant walk. Append those
  // people deterministically so the guide never strands a title dependency.
  const transmissionPeople = [];
  (propertyReport?.ownership?.transmissions || []).forEach((transmission) => {
    transmissionPeople.push(transmission.deceasedId);
    const allocations = transmission.exactAllocations || transmission.allocations || {};
    const recipientIds =
      allocations instanceof Map ? [...allocations.keys()] : Object.keys(allocations);
    recipientIds.forEach((id) => transmissionPeople.push(id));
  });
  (propertyReport?.ownership?.unresolved || []).forEach((entry) =>
    transmissionPeople.push(entry.personId),
  );
  [...(property.transfers || [])]
    .sort(
      (first, second) =>
        text(first.date).localeCompare(text(second.date)) ||
        text(first.id).localeCompare(text(second.id)),
    )
    .forEach((transfer) => {
      transmissionPeople.push(transfer.sellerId, transfer.buyerId);
    });
  transmissionPeople.filter(Boolean).forEach(visit);
  return ordered;
}

const addIssue = (issuesByPerson, personId, issue) => {
  if (!personId) return;
  const existing = issuesByPerson[personId] || [];
  if (existing.some((candidate) => candidate.key === issue.key)) return;
  issuesByPerson[personId] = [...existing, issue];
};

const basicIdentityIssues = (person = {}) => {
  const promptByIssue = {
    Names: "Enter the person's name.",
    Surname: "Enter the person's surname.",
    Sex: "Record the person's sex.",
    "Surname at birth": "Enter this woman's surname at birth.",
  };
  const issues = personIdentityIssues(person).map((label) => ({
    code: label.toLowerCase().replaceAll(" ", "-"),
    prompt: promptByIssue[label] || `Complete ${label.toLowerCase()}.`,
  }));
  if (person.surnameAtBirthReviewRequired === true && text(person.surnameAtBirth)) {
    issues.push({
      code: "surname-at-birth-review",
      prompt: "Review and confirm this woman's surname at birth.",
    });
  }
  return issues;
};

/** Build live, structured issues. Computed results are deliberately not persisted. */
export function buildTaxReadinessIssues({
  people = [],
  outsideParties = [],
  propertyReport = null,
  taxCalculationReport = null,
  causaMortisCoverage = { rows: [] },
  requiredSpouseDateIds: suppliedRequiredSpouseDateIds,
  successionSourceIds: suppliedSuccessionSourceIds,
} = {}) {
  const issuesByPerson = {};
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const validBeneficiaryIds = new Set([
    ...people.map((person) => text(person.id)).filter(Boolean),
    ...outsideParties.map((party) => text(party.id)).filter(Boolean),
  ]);
  const successionSourceIds =
    suppliedSuccessionSourceIds ||
    new Set([
      ...(propertyReport?.ownership?.transmissions || []).map(
        (transmission) => transmission.deceasedId,
      ),
      ...(propertyReport?.ownership?.unresolved || []).map((entry) => entry.personId),
      ...(causaMortisCoverage?.rows || []).map((row) => row.personId),
    ]);
  const requiredSpouseDateIds =
    suppliedRequiredSpouseDateIds || requiredSpouseDeathDatePersonIds(people, successionSourceIds);
  const relevantDeathDateIds = new Set(successionSourceIds);
  (propertyReport?.ownership?.transmissions || []).forEach((transmission) =>
    relevantDeathDateIds.add(transmission.deceasedId),
  );
  (propertyReport?.ownership?.unresolved || []).forEach((entry) =>
    relevantDeathDateIds.add(entry.personId),
  );
  (propertyReport?.ownership?.transmissions || []).forEach((transmission) =>
    (transmission.missingDeathDatePersonIds || []).forEach((personId) =>
      relevantDeathDateIds.add(personId),
    ),
  );
  (propertyReport?.ownership?.unresolved || []).forEach((entry) =>
    (entry.missingDeathDatePersonIds || []).forEach((personId) =>
      relevantDeathDateIds.add(personId),
    ),
  );
  (causaMortisCoverage?.rows || []).forEach((row) => relevantDeathDateIds.add(row.personId));
  requiredSpouseDateIds.forEach((personId) => relevantDeathDateIds.add(personId));

  people.forEach((person) => {
    basicIdentityIssues(person).forEach((issue) =>
      addIssue(issuesByPerson, person.id, {
        key: `identity:${issue.code}`,
        code: `identity-${issue.code}`,
        section: "identity",
        prompt: issue.prompt,
      }),
    );
    if (
      relevantDeathDateIds.has(person.id) &&
      !requiredSpouseDateIds.has(person.id) &&
      isMarkedDeceased(person) &&
      !isValidIsoDate(effectiveDateOfDeath(people, person.id)) &&
      person.dateOfDeathUnknown !== true
    ) {
      addIssue(issuesByPerson, person.id, {
        key: "death-date",
        code: "death-date",
        section: "succession",
        prompt: "Enter the exact date of death needed for legal and tax chronology.",
      });
    }
    if (
      successionSourceIds.has(person.survivalStatusReferencePersonId) &&
      person.survivalStatusRequired === true &&
      !person.survivalStatusConfirmed &&
      !isValidIsoDate(person.dateOfDeath) &&
      !(
        isMarkedDeceased(person) &&
        (issuesByPerson[person.id] || []).some((issue) => issue.code === "death-date")
      )
    ) {
      addIssue(issuesByPerson, person.id, {
        key: "survival-status",
        code: "survival-status",
        section: "survival",
        prompt: "Confirm whether this person survived the relevant deceased person.",
      });
    }
    if (
      successionSourceIds.has(person.id) &&
      isMarkedDeceased(person) &&
      person.inheritanceBasis === "will" &&
      !operativeWill(person)
    ) {
      const recordedWills = personWills(person);
      const targetWill =
        recordedWills.find((will) => !isValidIsoDate(will.date)) || recordedWills[0];
      const targetWillId = targetWill?.id || "";
      addIssue(issuesByPerson, person.id, {
        key: `operative-will:${targetWillId || "add-will"}`,
        code: "operative-will",
        section: "succession",
        targetId: targetWillId,
        prompt: "Complete a valid will and its beneficiaries.",
      });
    }
    if (
      successionSourceIds.has(person.id) &&
      isMarkedDeceased(person) &&
      person.inheritanceBasis === "will" &&
      operativeWill(person)
    ) {
      const readiness = willAllocationReadiness(person, validBeneficiaryIds);
      if (!readiness.valid) {
        const heirs = Array.isArray(person.willHeirs) ? person.willHeirs : [];
        const missingBeneficiary = heirs.find((heir) => !text(heir.personId));
        const missingReference = heirs.find(
          (heir) => text(heir.personId) && !validBeneficiaryIds.has(text(heir.personId)),
        );
        const selfBeneficiary = heirs.find((heir) => text(heir.personId) === text(person.id));
        const invalidShare = heirs.find((heir) => {
          const fraction = fractionForShare(heir);
          return Number(fraction.numerator) <= 0 || Number(fraction.denominator) <= 0;
        });
        let targetHeir = heirs[0];
        let targetField = "will-beneficiary-share";
        if (!heirs.length) {
          targetHeir = null;
          targetField = "add-will-beneficiary";
        } else if (missingBeneficiary) {
          targetHeir = missingBeneficiary;
          targetField = "will-beneficiary";
        } else if (invalidShare) {
          targetHeir = invalidShare;
        } else if (selfBeneficiary) {
          targetHeir = selfBeneficiary;
          targetField = "will-beneficiary";
        } else if (missingReference) {
          targetHeir = missingReference;
          targetField = "will-beneficiary";
        }
        const targetHeirId = targetHeir?.id || "";
        addIssue(issuesByPerson, person.id, {
          key: `will-allocation:${targetHeirId || "new-beneficiary"}:${targetField}`,
          code: "will-allocation",
          section: "succession",
          targetId: targetHeirId,
          targetField,
          prompt: readiness.issues[0] || "Complete the will beneficiaries and their shares.",
        });
      }
    }
  });

  requiredSpouseDateIds.forEach((personId) =>
    addIssue(issuesByPerson, personId, {
      key: "required-spouse-death-date",
      code: "required-spouse-death-date",
      section: "succession",
      prompt: "Enter this person's date of death because it affects a linked succession.",
    }),
  );

  (propertyReport?.ownership?.unresolved || []).forEach((entry) => {
    if (!peopleById.has(entry.personId)) return;
    if ((entry.missingDeathDatePersonIds || []).length) return;
    const recordedWillIssue = (issuesByPerson[entry.personId] || []).some((issue) =>
      ["operative-will", "will-allocation"].includes(issue.code),
    );
    if (
      recordedWillIssue &&
      (entry.destination === "will-unresolved" ||
        (entry.warnings || []).some((warning) => /\bwill\b|beneficiar/i.test(warning)))
    ) {
      return;
    }
    const warnings = (entry.warnings || []).filter(Boolean);
    const section = entry.transferId
      ? "donation"
      : ["spouse-status-unresolved", "spouse-survival-unresolved"].includes(entry.destination)
        ? "partner-details"
        : "succession";
    const targetIds = (entry.relationshipPersonIds || []).length
      ? entry.relationshipPersonIds
      : [entry.transferId || ""];
    targetIds.forEach((targetId) =>
      addIssue(issuesByPerson, entry.personId, {
        key: `ownership-unresolved:${section}:${targetId}:${warnings.join("|")}`,
        code: "ownership-unresolved",
        section,
        targetId,
        targetField: entry.targetField || entry.relationshipIssueField || "",
        prompt: warnings[0] || "Complete the succession details needed to distribute this share.",
      }),
    );
  });

  (causaMortisCoverage?.rows || []).forEach((coverage) => {
    if (!peopleById.has(coverage.personId) || !isCausaMortisCoverageActionRequired(coverage)) {
      return;
    }
    if (
      coverage.status === "date-unknown" &&
      (issuesByPerson[coverage.personId] || []).some((issue) =>
        ["death-date", "required-spouse-death-date"].includes(issue.code),
      )
    ) {
      return;
    }
    const prompt =
      coverage.status === "date-unknown"
        ? "Enter the date of death before recording the causa mortis declaration."
        : coverage.status === "allocation-unresolved"
          ? "Resolve the declarant allocation for the causa mortis declaration."
          : "Complete the outstanding causa mortis declaration for this property.";
    const targetDeclarationIds =
      coverage.status === "allocation-unresolved" ? coverage.unresolvedDeclarationIds || [] : [];
    const targets = targetDeclarationIds.length ? targetDeclarationIds : [""];
    targets.forEach((targetId) =>
      addIssue(issuesByPerson, coverage.personId, {
        key: `causa-mortis:${coverage.propertyId}:${coverage.status}:${targetId}`,
        code: `causa-mortis-${coverage.status}`,
        section: "causa-mortis",
        targetId,
        targetField:
          coverage.status === "allocation-unresolved"
            ? "causa-mortis-declarants"
            : ["under", "mixed", "missing"].includes(coverage.status)
              ? "add-causa-mortis"
              : "",
        prompt,
      }),
    );
  });

  (taxCalculationReport?.vendors || []).forEach((vendor) => {
    (vendor.rows || []).forEach((row, index) => {
      if (row.requiresOriginalAcquisitionDate) {
        const targetId = row.originalOwnerId || vendor.id;
        if (peopleById.has(targetId)) {
          addIssue(issuesByPerson, targetId, {
            key: `tax-original-acquisition:${row.originalOwnerRecordId || row.id || index}`,
            code: "initial-acquisition-date",
            section: "property",
            targetId: row.originalOwnerRecordId || row.id || "",
            prompt: "Enter the original acquisition date needed for this vendor's tax source.",
          });
        }
      }
      if (row.requiresDonationAcquisitionValue && peopleById.has(vendor.id)) {
        addIssue(issuesByPerson, vendor.id, {
          key: `tax-donation-value:${row.sourceTransferId || row.id || index}`,
          code: "donation-acquisition-value",
          section: "property",
          targetId: row.sourceTransferId || row.id || "",
          prompt: "Enter the donation acquisition value needed for this tax source.",
        });
      }
      if (
        row.requiresDonationDateCorrection &&
        row.provenancePersonId &&
        peopleById.has(row.provenancePersonId)
      ) {
        addIssue(issuesByPerson, row.provenancePersonId, {
          key: `tax-donation-date:${row.sourceTransferId || row.id || index}`,
          code: "donation-date-correction",
          section: "donation",
          targetId: row.sourceTransferId || row.id || "",
          prompt: "Correct the donation date because it falls after the intended sale date.",
        });
      }
      if (
        row.requiresDonorAcquisitionDate &&
        row.provenancePersonId &&
        peopleById.has(row.provenancePersonId)
      ) {
        addIssue(issuesByPerson, row.provenancePersonId, {
          key: `tax-donor-acquisition:${
            row.originalOwnerRecordId || row.sourceTransferId || row.id || index
          }`,
          code: "donor-original-acquisition-date",
          section: "property",
          targetId: row.originalOwnerRecordId || row.sourceTransferId || row.id || "",
          prompt: "Enter the donor's preceding acquisition date needed for this donated share.",
        });
      }
      if (
        row.requiresCausaMortisAcquisitionValue &&
        row.provenancePersonId &&
        peopleById.has(row.provenancePersonId)
      ) {
        const missingDeclarations = (row.declarations || []).filter(
          (declaration) => declaration.id && declaration.hasDeclaredValue !== true,
        );
        const targets = missingDeclarations.length ? missingDeclarations : [{ id: "" }];
        targets.forEach((declaration) =>
          addIssue(issuesByPerson, row.provenancePersonId, {
            key: `tax-causa-mortis-value:${declaration.id || row.provenancePersonId}`,
            code: "causa-mortis-acquisition-value",
            section: "causa-mortis",
            targetId: declaration.id || "",
            prompt: "Enter the causa mortis property value needed for this inherited tax source.",
          }),
        );
      }
    });
  });

  return issuesByPerson;
}

export function buildTaxReadinessPlan(input = {}) {
  const successionSourceIds = new Set([
    ...(input.propertyReport?.ownership?.transmissions || []).map(
      (transmission) => transmission.deceasedId,
    ),
    ...(input.propertyReport?.ownership?.unresolved || []).map((entry) => entry.personId),
    ...(input.causaMortisCoverage?.rows || []).map((row) => row.personId),
  ]);
  const requiredSpouseDateIds = requiredSpouseDeathDatePersonIds(
    input.people || [],
    successionSourceIds,
  );
  const issuesByPerson = buildTaxReadinessIssues({
    ...input,
    requiredSpouseDateIds,
    successionSourceIds,
  });
  const order = buildTaxReadinessPersonOrder(input.property, input.people, input.propertyReport);
  const dependencyIds = new Set(order);
  requiredSpouseDateIds.forEach((personId) => dependencyIds.add(personId));
  (input.propertyReport?.ownership?.unresolved || []).forEach((entry) =>
    dependencyIds.add(entry.personId),
  );
  (input.propertyReport?.ownership?.transmissions || []).forEach((transmission) =>
    (transmission.missingDeathDatePersonIds || []).forEach((personId) =>
      dependencyIds.add(personId),
    ),
  );
  (input.propertyReport?.ownership?.unresolved || []).forEach((entry) =>
    (entry.missingDeathDatePersonIds || []).forEach((personId) => dependencyIds.add(personId)),
  );
  (input.causaMortisCoverage?.rows || []).forEach((row) => dependencyIds.add(row.personId));
  (input.taxCalculationReport?.vendors || []).forEach((vendor) => dependencyIds.add(vendor.id));
  (input.property?.transfers || []).forEach((transfer) => {
    dependencyIds.add(transfer.sellerId);
    dependencyIds.add(transfer.buyerId);
  });
  // Legal dependencies outside the initial-owner family walk are appended in
  // stable people-array order. Unrelated family groups are not swept in merely
  // because they have an incomplete identity record.
  input.people?.forEach((person) => {
    if (
      dependencyIds.has(person.id) &&
      issuesByPerson[person.id]?.length &&
      !order.includes(person.id)
    ) {
      order.push(person.id);
    }
  });
  const relevantIssuesByPerson = Object.fromEntries(
    order
      .filter((personId) => issuesByPerson[personId]?.length)
      .map((personId) => [personId, issuesByPerson[personId]]),
  );
  const pendingPersonIds = order.filter((personId) => relevantIssuesByPerson[personId]?.length);
  return { order, issuesByPerson: relevantIssuesByPerson, pendingPersonIds };
}

export function normaliseTaxReadinessSession(session, plan, propertyId = "") {
  const source = session && typeof session === "object" ? session : {};
  const validIds = new Set(plan.order);
  const uniqueValidIds = (values) =>
    [...new Set(Array.isArray(values) ? values : [])].filter((personId) => validIds.has(personId));
  const currentIssueKeys = (personId) =>
    (plan.issuesByPerson[personId] || []).map((issue) => issue.key).sort();
  const sourceSkippedIssueKeys =
    source.skippedIssueKeys && typeof source.skippedIssueKeys === "object"
      ? source.skippedIssueKeys
      : {};
  const skippedPersonIds = uniqueValidIds(source.skippedPersonIds).filter((personId) => {
    const currentKeys = currentIssueKeys(personId);
    const storedKeys = Array.isArray(sourceSkippedIssueKeys[personId])
      ? [...sourceSkippedIssueKeys[personId]].sort()
      : currentKeys;
    return currentKeys.length && JSON.stringify(currentKeys) === JSON.stringify(storedKeys);
  });
  const skippedIssueKeys = Object.fromEntries(
    skippedPersonIds.map((personId) => [personId, currentIssueKeys(personId)]),
  );
  // A reviewed card had no remaining issue when the user continued. If new
  // facts later make it incomplete, remove that stale review automatically.
  const reviewedPersonIds = uniqueValidIds(source.reviewedPersonIds).filter(
    (personId) => !plan.issuesByPerson[personId]?.length,
  );
  const historyPersonIds = uniqueValidIds(source.historyPersonIds);
  const currentPersonId = validIds.has(source.currentPersonId) ? source.currentPersonId : "";
  return {
    version: TAX_READINESS_GUIDE_VERSION,
    propertyId,
    status: ["active", "paused", "complete"].includes(source.status) ? source.status : "paused",
    currentPersonId,
    historyPersonIds,
    reviewedPersonIds,
    skippedPersonIds,
    skippedIssueKeys,
    reviewingSkipped: source.reviewingSkipped === true && skippedPersonIds.length > 0,
    skippedReviewVisitedPersonIds: uniqueValidIds(source.skippedReviewVisitedPersonIds),
    startedAt: text(source.startedAt),
    updatedAt: text(source.updatedAt),
  };
}

export function nextTaxReadinessPerson(plan, session, { includeSkipped = false } = {}) {
  const reviewed = new Set(session.reviewedPersonIds || []);
  const skipped = new Set(session.skippedPersonIds || []);
  return (
    plan.pendingPersonIds.find(
      (personId) => !reviewed.has(personId) && (includeSkipped || !skipped.has(personId)),
    ) || ""
  );
}
