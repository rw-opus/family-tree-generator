import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Baby, Check, FilePlus2, Heart, Pencil, Trash2, UserRound, UsersRound } from "lucide-react";
import {
  composeFullName,
  createPerson,
  fatherSurnameDefaultPatch,
  hasDesignation,
  personDescendants,
  personDisplayName,
  personAncestors,
  personGivenNames,
  personIdentityIssues,
  parentageDescription,
  personRelationshipCounts,
  personSurname,
  personDesignations,
  removalWouldSeverFamily,
} from "../domain/people.js";
import {
  applyParentSuggestions,
  solePartnerParentSuggestions,
} from "../domain/parentSuggestions.js";
import {
  isCompletedCausaMortisDeclaration,
  validateCausaMortisDeclaration,
} from "../domain/causaMortisCoverage.js";
import { INHERITANCE_CAUSA_MORTIS_CUTOFF } from "../domain/article5A.js";
import {
  editedIntestacyAllocations,
  intestateAllocations,
  isPersonDeceased,
  linkedLegalSpousesFor,
  linkedSpousesFor,
  missingPotentialIntestateParents,
  willAllocationReadiness,
} from "../domain/familyOwnership.js";
import { approximateFraction } from "../domain/ownership.js";
import { MAX_FRACTION_INTEGER } from "../domain/fractions.js";
import { applyLegacyProtectedPortionsToWill } from "../domain/legacyLegitim.js";
import {
  fractionForShare,
  shareFromFractionInput,
  shareFromPercentage,
  shareFromPercentageInput,
} from "../domain/shares.js";
import { isValidIsoDate, isoDateToDisplay } from "../domain/dateFormat.js";
import { operativeWillFromRecords, personWills, personWithWills } from "../domain/wills.js";
import {
  findPartnerRelationship,
  PARTNER_RELATIONSHIP_TYPES,
  removePartnerRelationship,
  upsertPartnerRelationship,
} from "../domain/partnerRelationships.js";
import { DateInput } from "./DateInput.jsx";
import { IntestacyProposal, IntestateHeirConfirmation } from "./IntestateHeirConfirmation.jsx";
import { LegacyLegitimPanel } from "./LegacyLegitimPanel.jsx";
import { OutsidePartyCreator } from "./OutsidePartyCreator.jsx";

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

function initials(name) {
  const value = String(name || "").trim();
  if (!value) return "?";
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function ownershipLabel(share = 0, shareDisplay = "both", exactFraction = null) {
  const fraction = exactFraction?.denominator ? exactFraction : approximateFraction(share);
  const fractionText = `${fraction.numerator}/${fraction.denominator}`;
  const percentageText = `${(share * 100).toLocaleString("en-MT", {
    maximumFractionDigits: 2,
  })}%`;
  if (shareDisplay === "fraction") return fractionText;
  if (shareDisplay === "percentage") return percentageText;
  return `${fractionText} · ${percentageText}`;
}

function fractionLabel(share = 0) {
  const fraction = approximateFraction(Math.max(0, share));
  return `${fraction.numerator}/${fraction.denominator}`;
}

const money = new Intl.NumberFormat("en-MT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

function legacyProtectedWillForPerson(people, deceased) {
  const legalSpouses = linkedLegalSpousesFor(people, deceased.id, deceased.dateOfDeath);
  return applyLegacyProtectedPortionsToWill({
    people,
    deceased,
    hasSurvivingSpouse: legalSpouses.some(
      (spouse) =>
        !isPersonDeceased(spouse) ||
        (spouse.dateOfDeath && spouse.dateOfDeath > deceased.dateOfDeath),
    ),
    spouseSurvivalUnresolved: legalSpouses.some(
      (spouse) => isPersonDeceased(spouse) && !spouse.dateOfDeath,
    ),
  });
}

export function PersonInspector({
  people,
  properties = [],
  ownershipByPerson = {},
  ownershipFractionsByPerson = {},
  hasAnyPropertyOwnership = false,
  causaMortisCoverage = [],
  selectedPersonId,
  shareDisplay = "both",
  onShareDisplayChange,
  caseDependencyLabels = [],
  retainedIdentityLabels = [],
  familyPersonIds = null,
  personFamilyGroupCount = 1,
  outsideParties = [],
  onChange,
  onOutsidePartiesChange,
  onSelectPerson,
  onDeletePerson,
}) {
  const [spouseChooserOpen, setSpouseChooserOpen] = useState(false);
  const [partnerRelationshipType, setPartnerRelationshipType] = useState(
    PARTNER_RELATIONSHIP_TYPES.MARRIAGE,
  );
  const [partnerRelationshipDate, setPartnerRelationshipDate] = useState("");
  const [existingSpouseId, setExistingSpouseId] = useState("");
  const [childPartnerChooserOpen, setChildPartnerChooserOpen] = useState(false);
  const [childPartnerId, setChildPartnerId] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [causaMortisErrors, setCausaMortisErrors] = useState({});
  const [causaMortisDraftOpen, setCausaMortisDraftOpen] = useState(true);
  const [willOutsidePartyOpen, setWillOutsidePartyOpen] = useState(false);
  const [ownershipDisplay, setOwnershipDisplay] = useState(shareDisplayMode(shareDisplay));
  const selectedPerson =
    people.find((person) => person.id === selectedPersonId) ||
    (familyPersonIds === null ? people[0] : undefined);
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
    () => (selectedPerson ? missingPotentialIntestateParents(people, selectedPerson.id) : []),
    [people, selectedPerson],
  );

  useEffect(() => {
    const nextPersonId = selectedPerson?.id || "";
    if (previousSelectedPersonIdRef.current === nextPersonId) return;
    previousSelectedPersonIdRef.current = nextPersonId;
    setSpouseChooserOpen(false);
    setPartnerRelationshipType(PARTNER_RELATIONSHIP_TYPES.MARRIAGE);
    setPartnerRelationshipDate("");
    setExistingSpouseId("");
    setChildPartnerChooserOpen(false);
    setChildPartnerId("");
    setCausaMortisErrors({});
    setWillOutsidePartyOpen(false);
    setCausaMortisDraftOpen(
      Boolean(
        selectedPerson?.causaMortisDeclarations?.some(
          (declaration) => !isCompletedCausaMortisDeclaration(declaration),
        ),
      ),
    );
    setIsEditing(Boolean(selectedPerson && personIdentityIssues(selectedPerson).length));
  }, [selectedPerson]);

  useEffect(() => {
    setOwnershipDisplay(shareDisplayMode(shareDisplay));
  }, [shareDisplay]);

  const createMissingIntestateParents = () => {
    if (!selectedPerson || !missingIntestateParentRoles.length) return;
    const subjectName = personGivenNames(selectedPerson).trim() || displayName(selectedPerson);
    const selectedPatch = {};
    const createdParents = missingIntestateParentRoles.map((role) => {
      const relationship = role === "mother" ? "Mother" : "Father";
      const parent = createPerson("Parent");
      Object.assign(parent, {
        givenNames: `${relationship} of ${subjectName}`,
        fullName: `${relationship} of ${subjectName}`,
        sex: role === "mother" ? "Female" : "Male",
        isPotentialIntestateParent: true,
        survivalStatusRequired: true,
        survivalStatusReferencePersonId: selectedPerson.id,
      });
      selectedPatch[`${role}Id`] = parent.id;
      selectedPatch[`${role}ExplicitlyUnassigned`] = false;
      return parent;
    });
    onChange([
      ...people.map((person) =>
        person.id === selectedPerson.id ? { ...person, ...selectedPatch } : person,
      ),
      ...createdParents,
    ]);
  };

  const updatePerson = (personId, patch) => {
    onChange(people.map((person) => (person.id === personId ? { ...person, ...patch } : person)));
  };

  const updateSelected = (patch) => {
    if (!selectedPerson) return;
    updatePerson(selectedPerson.id, patch);
  };

  const acceptParentSuggestion = (suggestion) => {
    const suggestedPeople = applyParentSuggestions(people, [suggestion]);
    if (suggestion.field !== "fatherId") {
      onChange(suggestedPeople);
      return;
    }

    const father = suggestedPeople.find((person) => person.id === suggestion.suggestedPersonId);
    onChange(
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
    onChange(
      people.map((person) =>
        person.id === suggestion.personId ? { ...person, [flag]: true } : person,
      ),
    );
  };

  const updateGivenNames = (givenNames) => {
    updateSelected({
      givenNames,
      fullName: composeFullName(givenNames, personSurname(selectedPerson)),
    });
  };

  const updateSurname = (surname) => {
    const previousSurname = personSurname(selectedPerson);
    const patch = {
      surname,
      fullName: composeFullName(personGivenNames(selectedPerson), surname),
    };
    if (
      selectedPerson.sex === "Male" &&
      (!selectedPerson.surnameAtBirth || selectedPerson.surnameAtBirth === previousSurname)
    ) {
      patch.surnameAtBirth = surname;
    }
    updateSelected(patch);
  };

  const updateSex = (sex) => {
    const patch = { sex };
    if (sex === "Male" && !selectedPerson.surnameAtBirth) {
      patch.surnameAtBirth = personSurname(selectedPerson);
    }
    updateSelected(patch);
  };

  const changeOwnershipDisplay = (mode) => {
    setOwnershipDisplay(mode);
    onShareDisplayChange?.(mode);
  };

  const updateWillHeir = (heirId, patch) => {
    updateSelected({
      willHeirs: (selectedPerson.willHeirs || []).map((heir) =>
        heir.id === heirId ? { ...heir, ...patch } : heir,
      ),
    });
  };

  const updateWillHeirPercentage = (heirId, percentage) => {
    updateWillHeir(heirId, shareFromPercentageInput(percentage));
  };

  const updateWillHeirFraction = (heir, patch) => {
    updateWillHeir(heir.id, shareFromFractionInput(heir, patch));
  };

  const writeWills = (wills) => {
    const updated = personWithWills(selectedPerson, wills);
    updateSelected({
      wills: updated.wills,
      willDate: updated.willDate,
      willNotaryName: updated.willNotaryName,
      willDescription: updated.willDescription,
    });
  };

  const addWill = () => {
    writeWills([
      ...personWills(selectedPerson),
      {
        id: crypto.randomUUID(),
        date: "",
        notaryName: "",
        description: "",
      },
    ]);
  };

  const updateWill = (willId, patch) => {
    const currentWills = personWills(selectedPerson);
    if (!currentWills.length) {
      writeWills([
        { id: crypto.randomUUID(), date: "", notaryName: "", description: "", ...patch },
      ]);
      return;
    }
    writeWills(currentWills.map((will) => (will.id === willId ? { ...will, ...patch } : will)));
  };

  const removeWill = (willId) => {
    writeWills(personWills(selectedPerson).filter((will) => will.id !== willId));
  };

  const addWillHeir = () => {
    const hasHeirs = (selectedPerson.willHeirs || []).length > 0;
    const share = shareFromPercentage(hasHeirs ? 0 : 100);
    updateSelected({
      willHeirs: [
        ...(selectedPerson.willHeirs || []),
        {
          id: crypto.randomUUID(),
          personId: "",
          ...share,
        },
      ],
    });
  };

  const removeWillHeir = (heirId) => {
    updateSelected({
      willHeirs: (selectedPerson.willHeirs || []).filter((heir) => heir.id !== heirId),
    });
  };

  const updateCausaMortisDeclaration = (declarationId, patch) => {
    setCausaMortisDraftOpen(true);
    setCausaMortisErrors((current) => {
      if (!current[declarationId]) return current;
      const next = { ...current };
      delete next[declarationId];
      return next;
    });
    updateSelected({
      causaMortisDeclarations: (selectedPerson.causaMortisDeclarations || []).map((declaration) =>
        declaration.id === declarationId
          ? { ...declaration, ...patch, status: "draft" }
          : declaration,
      ),
    });
  };

  const addCausaMortisDeclaration = () => {
    if (!canAddCausaMortisDeclaration) return;
    const coverageTarget = causaMortisCoverage.find((row) => row.status === "under");
    const propertyId =
      coverageTarget?.propertyId || (properties.length === 1 ? properties[0].id : "");
    const remainingShare = coverageTarget
      ? Math.max(0, coverageTarget.requiredShare - coverageTarget.declaredShare)
      : 0;
    const remainingFraction = coverageTarget?.remainingFraction?.denominator
      ? coverageTarget.remainingFraction
      : approximateFraction(remainingShare);
    setCausaMortisDraftOpen(true);
    updateSelected({
      causaMortisDeclarations: [
        ...(selectedPerson.causaMortisDeclarations || []),
        {
          id: crypto.randomUUID(),
          status: "draft",
          propertyId,
          declaredShareNumerator: remainingFraction.numerator,
          declaredShareDenominator: remainingFraction.denominator,
          date: "",
          notaryName: "",
          immovablePropertyValue: "",
          declarantPersonIds: declarationCandidates.map((person) => person.id),
        },
      ],
    });
  };

  const handleCausaMortisDeclarationAction = () => {
    if (hasDraftCausaMortisDeclaration) {
      setCausaMortisDraftOpen((open) => !open);
      return;
    }
    addCausaMortisDeclaration();
  };

  const completeCausaMortisDeclaration = (declaration) => {
    const propertyId = declaration.propertyId || (properties.length === 1 ? properties[0].id : "");
    const normalizedDeclaration = { ...declaration, propertyId };
    const coverage = causaMortisCoverage.find((row) => row.propertyId === propertyId);
    const availableShare = coverage
      ? Math.max(0, coverage.requiredShare - coverage.declaredShare)
      : 0;
    const error = coverage
      ? validateCausaMortisDeclaration(normalizedDeclaration, {
          valueRequired: !allSuccessionHeirsDeceased,
          availableShare,
          availableShareFraction: coverage?.remainingFraction,
        })
      : "Assign the deceased's property share before completing this declaration.";

    if (error) {
      setCausaMortisErrors((current) => ({ ...current, [declaration.id]: error }));
      return;
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

  const toggleCausaMortisDeclarant = (declaration, personId) => {
    const current = new Set(declaration.declarantPersonIds || []);
    if (current.has(personId)) current.delete(personId);
    else current.add(personId);
    updateCausaMortisDeclaration(declaration.id, {
      declarantPersonIds: [...current],
    });
  };

  const setDeceased = (checked) => {
    const current = personDesignations(selectedPerson).filter(
      (designation) => designation !== "Deceased",
    );
    if (checked) setIsEditing(true);
    const survivalPatch = selectedPerson.isPotentialIntestateParent
      ? checked
        ? {
            survivalStatusRequired: !isValidIsoDate(selectedPerson.dateOfDeath),
            survivalStatusConfirmed: isValidIsoDate(selectedPerson.dateOfDeath)
              ? "death-date-recorded"
              : "",
          }
        : { survivalStatusRequired: false, survivalStatusConfirmed: "alive" }
      : {};
    updateSelected({
      designations: checked ? ["Deceased", ...current] : current,
      isDeceased: checked,
      dateOfDeath: checked ? selectedPerson.dateOfDeath || "" : "",
      unmarriedOrWidowedAtDeath: checked
        ? selectedPerson.unmarriedOrWidowedAtDeath === true
        : false,
      ...survivalPatch,
    });
  };

  const updateDateOfDeath = (dateOfDeath) => {
    const survivalPatch = selectedPerson.isPotentialIntestateParent
      ? isValidIsoDate(dateOfDeath)
        ? { survivalStatusRequired: false, survivalStatusConfirmed: "death-date-recorded" }
        : { survivalStatusRequired: true, survivalStatusConfirmed: "" }
      : {};
    updateSelected({ dateOfDeath, ...survivalPatch });
  };

  const addRelative = (kind, secondParentId = "") => {
    if (!selectedPerson || personIdentityIssues(selectedPerson).length) return;
    const counts = personRelationshipCounts(people, selectedPerson);
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
        designations: [
          relationshipType === PARTNER_RELATIONSHIP_TYPES.MARRIAGE
            ? hasDesignation(selectedPerson, "Deceased")
              ? "Surviving Spouse"
              : "Spouse"
            : "Partner",
        ],
      });
    }
    if (kind === "child") {
      Object.assign(relative, { designations: ["Child"] });
      const secondParent = people.find((person) => person.id === secondParentId);
      if (
        selectedPerson.sex === "Female" ||
        (selectedPerson.sex !== "Male" && secondParent?.sex === "Male")
      ) {
        relative.motherId = selectedPerson.id;
        relative.fatherId = secondParent?.id || "";
      } else {
        relative.fatherId = selectedPerson.id;
        relative.motherId = secondParent?.id || "";
      }
    }
    if (kind === "sibling") {
      Object.assign(relative, {
        designations: ["Sibling"],
        fatherId: selectedPerson.fatherId || "",
        motherId: selectedPerson.motherId || "",
        siblingIds: [selectedPerson.id],
      });
      selectedPatch = {
        siblingIds: [...new Set([...(selectedPerson.siblingIds || []), relative.id])],
      };
    }

    if ((kind === "child" || kind === "sibling") && relative.fatherId) {
      const father = people.find((person) => person.id === relative.fatherId);
      Object.assign(relative, fatherSurnameDefaultPatch(relative, father));
    }

    const updatedPeople = people.map((person) =>
      person.id === selectedPerson.id ? { ...person, ...selectedPatch } : person,
    );
    const nextPeople = [...updatedPeople, relative];
    if (kind === "marriage" || kind === "partnership") {
      onChange(
        upsertPartnerRelationship(nextPeople, selectedPerson.id, relative.id, {
          type:
            kind === "partnership"
              ? PARTNER_RELATIONSHIP_TYPES.PARTNERSHIP
              : PARTNER_RELATIONSHIP_TYPES.MARRIAGE,
          startDate: partnerRelationshipDate,
        }),
      );
      return;
    }
    onChange(nextPeople);
  };

  const createOutsideParty = (party) => {
    onOutsidePartiesChange?.([...outsideParties, party]);
  };

  const addOutsideWillHeir = (party) => {
    createOutsideParty(party);
    const hasHeirs = (selectedPerson.willHeirs || []).length > 0;
    updateSelected({
      willHeirs: [
        ...(selectedPerson.willHeirs || []),
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
    onChange(
      upsertPartnerRelationship(people, selectedPerson.id, existingPerson.id, {
        type: partnerRelationshipType,
        startDate: partnerRelationshipDate,
      }),
    );
    setExistingSpouseId("");
    setPartnerRelationshipDate("");
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
          ? `Remove ${displayName(selectedPerson)} from this family tree? The person will remain as an unconnected person because a Declaration Causa Mortis names them as a declarant.`
          : `Are you sure you want to delete ${displayName(selectedPerson)} from the family tree? This cannot be undone.`,
    );
    if (!confirmed) return;
    if (onDeletePerson) {
      onDeletePerson(selectedPerson.id);
      return;
    }
    onChange(
      people
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
    onChange(removePartnerRelationship(people, selectedPerson.id, partnerId));
  };

  const updatePartnerLink = (partnerId, patch) => {
    if (!selectedPerson || !partnerId) return;
    onChange(upsertPartnerRelationship(people, selectedPerson.id, partnerId, patch));
  };

  const removeSiblingLink = (siblingId) => {
    if (!selectedPerson || !siblingId) return;
    onChange(
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
  const isDeceased =
    Boolean(selectedPerson.isDeceased) || hasDesignation(selectedPerson, "Deceased");
  const survivalReferencePerson = peopleById.get(selectedPerson.survivalStatusReferencePersonId);
  const identityIssues = personIdentityIssues(selectedPerson);
  const identityComplete = identityIssues.length === 0;
  const identityMessage = identityComplete
    ? ""
    : `Complete ${identityIssues.join(
        identityIssues.length > 1 ? ", " : "",
      )} before adding relatives.`;
  const selectedDisplayName = displayName(selectedPerson);
  const inheritanceBasis = selectedPerson.inheritanceBasis || "intestacy";
  const recordedWills = personWills(selectedPerson);
  const displayedWills = recordedWills.length
    ? recordedWills
    : [{ id: `${selectedPerson.id}:new-will`, date: "", notaryName: "", description: "" }];
  const latestWill = operativeWillFromRecords(recordedWills);
  const willHeirs = selectedPerson.willHeirs || [];
  const willReadiness = willAllocationReadiness(
    selectedPerson,
    new Set([...people.map((person) => person.id), ...outsideParties.map((party) => party.id)]),
  );
  const willTotal = willReadiness.totalPercent;
  const automaticIntestacy = isDeceased ? intestateAllocations(people, selectedPerson.id) : null;
  const protectedWill =
    isDeceased && inheritanceBasis === "will"
      ? legacyProtectedWillForPerson(people, selectedPerson)
      : null;
  const editedIntestacy =
    inheritanceBasis === "intestacy" &&
    automaticIntestacy &&
    editedIntestacyAllocations(people, selectedPerson.id, automaticIntestacy, outsideParties);
  const successionHeirIds =
    inheritanceBasis === "will"
      ? protectedWill?.resolved
        ? [...protectedWill.shares.keys()]
        : willHeirs.map((heir) => heir.personId).filter(Boolean)
      : [
          ...((editedIntestacy?.valid
            ? editedIntestacy.shares
            : automaticIntestacy?.shares
          )?.keys() || []),
        ];
  const successionHeirs = successionHeirIds
    .map((personId) => peopleById.get(personId) || outsidePartiesById.get(personId))
    .filter(Boolean);
  const allSuccessionHeirsDeceased =
    successionHeirs.length > 0 &&
    successionHeirs.every((person) => peopleById.has(person.id) && isPersonDeceased(person));
  const descendants = personDescendants(people, selectedPerson.id);
  const descendantIds = new Set(descendants.map((person) => person.id));
  const ancestorIds = new Set(
    personAncestors(people, selectedPerson.id).map((person) => person.id),
  );
  const declarationCandidateIds = new Set(successionHeirIds);
  const declarationCandidates = [...people, ...outsideParties].filter((party) =>
    declarationCandidateIds.has(party.id),
  );
  const causaMortisDeclarations = selectedPerson.causaMortisDeclarations || [];
  const hasDraftCausaMortisDeclaration = causaMortisDeclarations.some(
    (declaration) => !isCompletedCausaMortisDeclaration(declaration),
  );
  const hasRemainingCausaMortisShare = causaMortisCoverage.some((row) => row.status === "under");
  const canStartFirstCausaMortisDeclaration = causaMortisDeclarations.length === 0;
  const canAddCausaMortisDeclaration =
    !hasDraftCausaMortisDeclaration &&
    (canStartFirstCausaMortisDeclaration || hasRemainingCausaMortisShare);
  const visibleCausaMortisDeclarations = causaMortisDeclarations.filter(
    (declaration) => isCompletedCausaMortisDeclaration(declaration) || causaMortisDraftOpen,
  );
  const applyIntestacySuggestionToWill = () => {
    const suggestedHeirs = [...(automaticIntestacy?.shares || new Map()).entries()];
    if (!suggestedHeirs.length) return;
    updateSelected({
      willHeirs: suggestedHeirs.map(([personId, share]) => ({
        id: crypto.randomUUID(),
        personId,
        ...shareFromPercentage(share * 100),
      })),
    });
  };
  const hasUnknownCausaMortisDeathDate = causaMortisCoverage.some(
    (row) => row.status === "date-unknown",
  );
  const isPreCausaMortisCutoff =
    Boolean(selectedPerson.dateOfDeath) &&
    selectedPerson.dateOfDeath < INHERITANCE_CAUSA_MORTIS_CUTOFF;
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
    (Boolean(selectedPerson.dateOfDeath) && !isPreCausaMortisCutoff);
  const displayedSurnameAtBirth =
    selectedPerson.surnameAtBirth ||
    (selectedPerson.sex === "Male" ? personSurname(selectedPerson) : "");
  const displayedGivenNames = personGivenNames(selectedPerson);
  const displayedSurname = personSurname(selectedPerson);
  const propertySaleValue = Number(properties[0]?.saleValue) || 0;
  const estimatedPropertyValue = propertySaleValue * ownership;
  const relationshipCounts = personRelationshipCounts(people, selectedPerson);
  const linkedPartners = linkedSpousesFor(people, selectedPerson.id);
  const partnerRelationshipsById = new Map(
    linkedPartners.map((partner) => [
      partner.id,
      findPartnerRelationship(people, selectedPerson.id, partner.id),
    ]),
  );
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
      setPartnerRelationshipDate("");
      return;
    }
    setPartnerRelationshipType(type);
    setPartnerRelationshipDate("");
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
  const existingSpouseCandidates = people.filter(
    (person) =>
      person.id !== selectedPerson.id &&
      !linkedSpouseIds.has(person.id) &&
      !descendantIds.has(person.id) &&
      !ancestorIds.has(person.id),
  );
  const parentage = parentageDescription(selectedPerson, people);
  // Having descendants is not itself a reason to keep somebody: a person at the
  // top of a tree can go as long as nobody is severed by it. What blocks a
  // removal is being the only thing holding two parts of the family together —
  // the person a spouse reaches the rest of the tree through.
  const seversFamily = removalWouldSeverFamily(
    sharedAcrossFamilies
      ? people.filter((entry) => currentFamilyPersonIdSet.has(entry.id))
      : people,
    selectedPersonId,
  );
  const deleteBlockers = [
    ...(seversFamily
      ? ["the only link holding this family together — remove the people either side"]
      : []),
    ...(!sharedAcrossFamilies && (hasAnyPropertyOwnership || (hasOwnership && ownership > 0))
      ? ["the person's property ownership"]
      : []),
    ...(!sharedAcrossFamilies ? caseDependencyLabels : []),
  ];
  const deleteDisabled =
    currentFamilyPersonIds.length <= 1 ||
    deleteBlockers.length > 0 ||
    (sharedAcrossFamilies && !onDeletePerson);
  const deleteMessage =
    currentFamilyPersonIds.length <= 1
      ? "A tree must contain at least one person."
      : sharedAcrossFamilies && !onDeletePerson
        ? "Family-scoped removal is unavailable in this view."
        : deleteBlockers.length
          ? `Remove ${deleteBlockers.join(" and ")} first.`
          : retainedIdentityLabels.length
            ? "This removes the person from the family tree but retains their identity as an unconnected person because a Declaration Causa Mortis names them as a declarant."
            : personFamilyGroupCount > 1
              ? "This removes the person from this family only; the shared record remains elsewhere."
              : "No partner or descendant dependencies. Confirmation is required.";

  return (
    <div className="person-inspector">
      <section className="inspector-profile">
        <div className={`person-avatar ${selectedPerson.sex?.toLowerCase() || "unknown"}`}>
          {initials(selectedDisplayName)}
        </div>
        <div>
          <h2>{selectedDisplayName}</h2>
        </div>
        <div className="person-profile-actions">
          <button
            type="button"
            className={`person-edit-button ${isEditing ? "active" : ""}`}
            aria-pressed={isEditing}
            onClick={() => setIsEditing((editing) => !editing)}
          >
            {isEditing ? <Check size={15} /> : <Pencil size={15} />}
            {isEditing ? "Done" : "Edit identity"}
          </button>
        </div>
      </section>

      <section className="inspector-section">
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
                ((key === "father" || key === "mother") && relationshipCounts[key] > 0)
              }
              title={
                !identityComplete
                  ? identityMessage
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
            <label className="partner-date-field">
              <span>
                {partnerRelationshipType === PARTNER_RELATIONSHIP_TYPES.MARRIAGE
                  ? "Marriage date (optional)"
                  : "Partnership date (optional)"}
              </span>
              <DateInput value={partnerRelationshipDate} onChange={setPartnerRelationshipDate} />
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                addRelative(
                  partnerRelationshipType === PARTNER_RELATIONSHIP_TYPES.MARRIAGE
                    ? "marriage"
                    : "partnership",
                );
                setPartnerRelationshipDate("");
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
                    : "No unlinked people available"}
                </option>
                {existingSpouseCandidates.map((person) => (
                  <option key={person.id} value={person.id}>
                    {displayName(person)}
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
                {linkedPartners.map((person) => (
                  <option key={person.id} value={person.id}>
                    {displayName(person)}
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

      <section className="inspector-section">
        <p className="eyebrow">Personal details</p>
        <fieldset className="person-edit-fields" disabled={!isEditing}>
          <div className="inspector-fields">
            <label>
              <span>Name</span>
              <input
                autoFocus={!displayedGivenNames}
                value={displayedGivenNames}
                onChange={(event) => updateGivenNames(event.target.value)}
                placeholder="Given name or names"
              />
            </label>
            <label>
              <span>Surname</span>
              <input
                value={displayedSurname}
                onChange={(event) => updateSurname(event.target.value)}
                placeholder="Current surname"
              />
            </label>
            <label>
              <span>Surname at birth</span>
              <input
                value={displayedSurnameAtBirth}
                onChange={(event) => updateSelected({ surnameAtBirth: event.target.value })}
                placeholder={selectedPerson.sex === "Male" ? "Same as current surname" : ""}
              />
            </label>
          </div>
        </fieldset>
        <div className="person-status-controls">
          <div className="person-status-control" role="group" aria-label="Sex">
            <span>Sex</span>
            <span className="sex-checkbox-options">
              {["Female", "Male", "Other"].map((sex) => (
                <label className="detail-checkbox" key={sex}>
                  <input
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
        </div>

        {missingIntestateParentRoles.length > 0 && (
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

        {selectedPerson.survivalStatusRequired === true && (
          <section className="potential-parent-survival-alert" role="alert">
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
                      (designation) => designation !== "Deceased",
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

        <fieldset className="person-edit-fields" disabled={!isEditing && !isDeceased}>
          {isDeceased && (
            <div className="person-succession">
              <label className="succession-detail-row">
                <span>Date of death</span>
                <DateInput value={selectedPerson.dateOfDeath || ""} onChange={updateDateOfDeath} />
              </label>
              <label className="succession-detail-row marital-status-at-death">
                <span>Marital status at death</span>
                <span className="detail-checkbox">
                  <input
                    type="checkbox"
                    aria-label="Unmarried or widowed at the time of death"
                    checked={selectedPerson.unmarriedOrWidowedAtDeath === true}
                    onChange={(event) =>
                      updateSelected({ unmarriedOrWidowedAtDeath: event.target.checked })
                    }
                  />
                  Unmarried or widowed at the time of death.
                </span>
              </label>
              {selectedPerson.unmarriedOrWidowedAtDeath === true && (
                <small className="succession-marital-status-note">
                  Recorded marriage and partner links remain on the tree but no spouse is included
                  in this succession.
                </small>
              )}
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
                      <small>
                        The most recent dated will applies. Enter its notary or a description such
                        as UK will.
                      </small>
                    </div>
                    <button type="button" className="secondary-button" onClick={addWill}>
                      <FilePlus2 size={14} /> Add will
                    </button>
                  </div>
                  <div className="will-records">
                    {displayedWills.map((will, index) => {
                      const isLatest = latestWill?.id === will.id;
                      return (
                        <section className="will-record" key={will.id}>
                          <div className="will-record-heading">
                            <strong>Will {index + 1}</strong>
                            <span>
                              {isLatest && <small className="will-applies">Latest — applies</small>}
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
                              aria-label={`Will date ${index + 1}`}
                              value={will.date || ""}
                              onChange={(value) => updateWill(will.id, { date: value })}
                            />
                          </label>
                          <label>
                            <span>Notary (optional)</span>
                            <input
                              aria-label={`Notary for will ${index + 1}`}
                              value={will.notaryName || ""}
                              onChange={(event) =>
                                updateWill(will.id, { notaryName: event.target.value })
                              }
                              placeholder="Notary's name"
                            />
                          </label>
                          <label>
                            <span>Description (optional)</span>
                            <input
                              aria-label={`Description for will ${index + 1}`}
                              value={will.description || ""}
                              onChange={(event) =>
                                updateWill(will.id, { description: event.target.value })
                              }
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
                    title="Suggested heirs if intestate"
                    actionLabel="Edit Beneficiaries"
                    onApply={applyIntestacySuggestionToWill}
                  />
                  <div className="will-beneficiaries">
                    <div className="will-beneficiaries-heading">
                      <strong>Beneficiaries under the latest will</strong>
                      <span>
                        <button type="button" className="text-button" onClick={addWillHeir}>
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
                    {willHeirs.map((heir) => {
                      const fraction = fractionForShare(heir);
                      const numerator = heir.shareNumerator ?? fraction.numerator;
                      const denominator = heir.shareDenominator ?? fraction.denominator;
                      return (
                        <div className={`will-heir-row ${ownershipDisplay}`} key={heir.id}>
                          <select
                            aria-label="Will beneficiary"
                            value={heir.personId || ""}
                            onChange={(event) =>
                              updateWillHeir(heir.id, { personId: event.target.value })
                            }
                          >
                            <option value="">Choose person or company</option>
                            <optgroup label="People on the family tree">
                              {people
                                .filter((person) => person.id !== selectedPerson.id)
                                .map((person) => (
                                  <option key={person.id} value={person.id}>
                                    {displayName(person)}
                                  </option>
                                ))}
                            </optgroup>
                            {outsideParties.length > 0 && (
                              <optgroup label="Unconnected people and companies">
                                {outsideParties.map((party) => (
                                  <option key={party.id} value={party.id}>
                                    {partyDisplayName(party)}
                                    {party.type === "company" ? " (company)" : " (unconnected)"}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                          {ownershipDisplay !== "percentage" && (
                            <span className="will-heir-fraction">
                              <input
                                aria-label="Will share numerator"
                                type="number"
                                min="0"
                                max={MAX_FRACTION_INTEGER}
                                step="1"
                                value={numerator}
                                onChange={(event) =>
                                  updateWillHeirFraction(heir, {
                                    numerator: event.target.value,
                                  })
                                }
                              />
                              <b>/</b>
                              <input
                                aria-label="Will share denominator"
                                type="number"
                                min="1"
                                max={MAX_FRACTION_INTEGER}
                                step="1"
                                value={denominator}
                                onChange={(event) =>
                                  updateWillHeirFraction(heir, {
                                    denominator: event.target.value,
                                  })
                                }
                              />
                            </span>
                          )}
                          {ownershipDisplay !== "fraction" && (
                            <span className="will-heir-percent">
                              <input
                                aria-label="Will share percentage"
                                type="number"
                                min="0"
                                max="100"
                                step="any"
                                value={heir.sharePercentInput ?? heir.sharePercent ?? ""}
                                onChange={(event) =>
                                  updateWillHeirPercentage(heir.id, event.target.value)
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
                        willReadiness.valid ? "succession-total valid" : "succession-total invalid"
                      }
                    >
                      Total: {ownershipLabel(willTotal / 100, ownershipDisplay)}{" "}
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

              <LegacyLegitimPanel
                deceased={selectedPerson}
                people={people}
                shareDisplay={ownershipDisplay}
                displayName={displayName}
                onUpdatePerson={updatePerson}
              />

              {isPreCausaMortisCutoff && (
                <p className="helper-text causa-mortis-not-applicable">
                  No Declaration Causa Mortis applies because the succession opened before 25
                  November 1992.
                  {inheritedShareStillHeldBySurvivor
                    ? " A later sale of that inherited share is taxed at 7% of its transfer value under Article 5A(5)(c)(i)."
                    : ""}
                </p>
              )}

              {requiresCausaMortisDetails && (
                <div className="causa-mortis-records">
                  <div className="causa-mortis-heading">
                    <div>
                      <strong>Declarations Causa Mortis (CM)</strong>
                      <small>
                        {hasUnknownCausaMortisDeathDate
                          ? "The exact death date is needed to decide whether a Declaration Causa Mortis is required."
                          : "Required for a death on or after 25 November 1992. Complete this form with OK before starting another declaration."}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!hasDraftCausaMortisDeclaration && !canAddCausaMortisDeclaration}
                      onClick={handleCausaMortisDeclarationAction}
                      title={
                        hasDraftCausaMortisDeclaration
                          ? causaMortisDraftOpen
                            ? "Close the unfinished Declaration Causa Mortis form."
                            : "Reopen the unfinished Declaration Causa Mortis form."
                          : canStartFirstCausaMortisDeclaration
                            ? "Record the first Declaration Causa Mortis."
                            : hasRemainingCausaMortisShare
                              ? "Insert another Declaration Causa Mortis."
                              : "No undeclared share remains."
                      }
                    >
                      <FilePlus2 size={14} />
                      {hasDraftCausaMortisDeclaration
                        ? causaMortisDraftOpen
                          ? "Close CM Declaration"
                          : "Open CM Declaration"
                        : "Insert CM Declaration"}
                    </button>
                  </div>

                  {causaMortisCoverage.length > 0 && (
                    <div className="causa-mortis-coverage" aria-label="Causa mortis share coverage">
                      {causaMortisCoverage.map((row) => {
                        const difference = Math.abs(row.difference);
                        const property = properties.find(
                          (candidate) => candidate.id === row.propertyId,
                        );
                        const sellingPrice = Number(property?.saleValue);
                        const hasSellingPrice = Number.isFinite(sellingPrice) && sellingPrice > 0;
                        const requiredShareSaleValue = sellingPrice * row.requiredShare;
                        const differenceLabel =
                          row.status === "date-unknown"
                            ? row.deathDateText
                              ? `Resolve date (${
                                  isoDateToDisplay(row.deathDateText) || row.deathDateText
                                })`
                              : "Enter exact death date"
                            : row.status === "under"
                              ? `Missing ${fractionLabel(difference)}`
                              : row.status === "over"
                                ? `Excess ${fractionLabel(difference)}`
                                : "Complete";
                        return (
                          <div
                            className={`causa-mortis-coverage-row ${row.status}`}
                            key={row.propertyId}
                          >
                            <span>
                              <strong>{row.propertyAddress}</strong>
                              <small>
                                {row.status === "date-unknown"
                                  ? "Coverage cannot be decided from an unknown or approximate death date."
                                  : `Required ${fractionLabel(
                                      row.requiredShare,
                                    )} · Declared ${fractionLabel(row.declaredShare)}`}
                              </small>
                              {row.status !== "date-unknown" && hasSellingPrice && (
                                <small>
                                  Required share of selling price{" "}
                                  {money.format(requiredShareSaleValue)}
                                </small>
                              )}
                            </span>
                            <b>{differenceLabel}</b>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!causaMortisDeclarations.length && (
                    <small className="causa-mortis-empty">
                      No causa mortis declaration recorded yet. Insert a declaration to open the
                      form.
                    </small>
                  )}

                  {hasDraftCausaMortisDeclaration && !causaMortisDraftOpen && (
                    <small className="causa-mortis-empty">
                      Unfinished CM declaration closed. Use Open CM Declaration to continue.
                    </small>
                  )}

                  {visibleCausaMortisDeclarations.map((declaration, index) => (
                    <div
                      className={`causa-mortis-card ${
                        isCompletedCausaMortisDeclaration(declaration) ? "complete" : "draft"
                      }`}
                      key={declaration.id}
                    >
                      <div className="causa-mortis-card-heading">
                        <strong>Declaration Causa Mortis {index + 1}</strong>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Remove causa mortis declaration ${index + 1}`}
                          onClick={() => removeCausaMortisDeclaration(declaration.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <label>
                        <span>Property</span>
                        <select
                          aria-label={`Property declared causa mortis ${index + 1}`}
                          required
                          value={
                            declaration.propertyId ||
                            (properties.length === 1 ? properties[0].id : "")
                          }
                          onChange={(event) =>
                            updateCausaMortisDeclaration(declaration.id, {
                              propertyId: event.target.value,
                            })
                          }
                        >
                          <option value="">Select property</option>
                          {properties.map((property) => (
                            <option key={property.id} value={property.id}>
                              {property.address || property.description || "Unnamed property"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>
                          Share declared <abbr title="Declaration Causa Mortis">CM</abbr>
                        </span>
                        <span className="causa-mortis-fraction">
                          <input
                            aria-label={`Causa mortis share numerator ${index + 1}`}
                            type="number"
                            min="0"
                            max={MAX_FRACTION_INTEGER}
                            step="1"
                            required
                            value={declaration.declaredShareNumerator ?? ""}
                            onChange={(event) =>
                              updateCausaMortisDeclaration(declaration.id, {
                                declaredShareNumerator: event.target.value,
                              })
                            }
                          />
                          <b>/</b>
                          <input
                            aria-label={`Causa mortis share denominator ${index + 1}`}
                            type="number"
                            min="1"
                            max={MAX_FRACTION_INTEGER}
                            step="1"
                            required
                            value={declaration.declaredShareDenominator ?? ""}
                            onChange={(event) =>
                              updateCausaMortisDeclaration(declaration.id, {
                                declaredShareDenominator: event.target.value,
                              })
                            }
                          />
                        </span>
                      </label>
                      <label>
                        <span>Date of Declaration Causa Mortis</span>
                        <DateInput
                          aria-label={`Date of Declaration Causa Mortis ${index + 1}`}
                          required
                          value={declaration.date || ""}
                          onChange={(value) =>
                            updateCausaMortisDeclaration(declaration.id, {
                              date: value,
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>Notary</span>
                        <input
                          aria-label={`Notary for Declaration Causa Mortis ${index + 1}`}
                          required
                          value={declaration.notaryName || ""}
                          onChange={(event) =>
                            updateCausaMortisDeclaration(declaration.id, {
                              notaryName: event.target.value,
                            })
                          }
                          placeholder="Notary's full name"
                        />
                      </label>
                      <label>
                        <span>
                          Value declared
                          {allSuccessionHeirsDeceased ? " (optional)" : ""}
                        </span>
                        <span className="currency-input">
                          <b>€</b>
                          <input
                            aria-label={`Immovable property value declared causa mortis ${index + 1}`}
                            type="number"
                            min="0"
                            step="any"
                            required={!allSuccessionHeirsDeceased}
                            value={declaration.immovablePropertyValue || ""}
                            onChange={(event) =>
                              updateCausaMortisDeclaration(declaration.id, {
                                immovablePropertyValue: event.target.value,
                              })
                            }
                          />
                        </span>
                      </label>
                      <div className="causa-mortis-declarants">
                        <strong>Declarants / heirs</strong>
                        <small>
                          Identified heirs are selected by default. Untick anyone who did not make
                          this declaration.
                        </small>
                        {declarationCandidates.length ? (
                          <div>
                            {declarationCandidates.map((party) => (
                              <label key={party.id}>
                                <input
                                  type="checkbox"
                                  checked={(declaration.declarantPersonIds || []).includes(
                                    party.id,
                                  )}
                                  onChange={() => toggleCausaMortisDeclarant(declaration, party.id)}
                                />
                                {displayParty(party)}
                              </label>
                            ))}
                          </div>
                        ) : (
                          <small>
                            Add or identify the heirs in this case before selecting declarants.
                          </small>
                        )}
                      </div>
                      <small
                        className={
                          allSuccessionHeirsDeceased
                            ? "causa-mortis-value-note optional"
                            : "causa-mortis-value-note required"
                        }
                      >
                        {allSuccessionHeirsDeceased
                          ? "Declared immovable-property value is optional because every identified heir is now deceased."
                          : successionHeirs.length
                            ? "Declared immovable-property value is required because at least one identified heir is living."
                            : "Declared immovable-property value is required until the heirs are identified."}
                      </small>
                      <div className="causa-mortis-card-actions">
                        {causaMortisErrors[declaration.id] && (
                          <small role="alert">{causaMortisErrors[declaration.id]}</small>
                        )}
                        <button
                          type="button"
                          className="primary-button"
                          disabled={isCompletedCausaMortisDeclaration(declaration)}
                          onClick={() => completeCausaMortisDeclaration(declaration)}
                        >
                          <Check size={14} />
                          OK
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="person-share-summary">
            <div className="person-share-heading">
              <span>
                Estimated property share
                {properties.length > 1 && <small> (primary property only)</small>}
              </span>
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
                {hasOwnership
                  ? ownershipLabel(
                      ownership,
                      ownershipDisplay,
                      ownershipFractionsByPerson[selectedPerson.id],
                    )
                  : "Not yet calculated"}
              </strong>
              <small>
                {hasOwnership && propertySaleValue > 0
                  ? `Estimated value ${money.format(estimatedPropertyValue)}`
                  : "Enter the initial owner and property selling price to calculate a value."}
              </small>
            </div>
          </div>
          {linkedPartners.length > 0 && (
            <div className="person-partner-links">
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
                  return (
                    <div className="person-partner-link-row" key={partner.id}>
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
                        <label>
                          <span>
                            {relationshipState === "partnership"
                              ? "Partnership date"
                              : "Marriage date"}
                          </span>
                          <DateInput
                            aria-label={`Relationship start date with ${displayName(partner)}`}
                            value={relationship?.startDate || ""}
                            onChange={(value) =>
                              updatePartnerLink(partner.id, { startDate: value })
                            }
                          />
                        </label>
                        {relationshipState === "former-marriage" && (
                          <label>
                            <span>Marriage ended</span>
                            <DateInput
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
              disabled={deleteDisabled}
              onClick={removeSelected}
            >
              <Trash2 size={15} />
              {personFamilyGroupCount > 1 || retainedIdentityLabels.length
                ? "Remove from this family"
                : "Delete person"}
            </button>
            <small>{deleteMessage}</small>
          </div>
        </fieldset>
      </section>
    </div>
  );
}
