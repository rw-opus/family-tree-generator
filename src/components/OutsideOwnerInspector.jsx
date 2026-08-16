import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Building2, Pencil, Trash2, UserRound, X } from "lucide-react";
import { previewPropertyTransferCapacity } from "../domain/familyOwnership.js";
import {
  compareFractions,
  fractionToNumber,
  MAX_FRACTION_INTEGER,
  normaliseFraction,
  ZERO_FRACTION,
} from "../domain/fractions.js";
import { isoDateToDisplay } from "../domain/dateFormat.js";
import { personChoiceLabel, sortPeopleForChoice } from "../domain/people.js";
import {
  buildTaxCalculationReport,
  buildPropertyVendorTaxReport,
  ownerProvenanceTranches,
  setDonationAcquisitionValue,
  setLivingInitialOwnerAcquisitionDate,
} from "../domain/propertyVendorTax.js";
import { normalisePercentageInput, shareFromPercentage } from "../domain/shares.js";
import { selectTranchePortions } from "../domain/trancheOwnership.js";
import { validateTransferDateChronology } from "../domain/chronology.js";
import { DateInput } from "./DateInput.jsx";
import { FinalWithholdingTaxSection } from "./personInspector/FinalWithholdingTaxSection.jsx";

const blankDraft = () => ({
  kind: "sale",
  acquirerMode: "existing",
  acquirerId: "",
  acquirerType: "individual",
  acquirerName: "",
  registrationNumber: "",
  amountType: "all-share",
  shareInputMode: "fraction",
  numerator: "",
  denominator: "",
  percentage: "",
  date: "",
  designation: {},
  error: "",
});

const draftFromTransfer = (transfer = {}, amountFraction = null) => ({
  ...blankDraft(),
  kind: transfer.kind === "donation" ? "donation" : "sale",
  acquirerId: transfer.buyerId || "",
  amountType: "defined-share",
  numerator: String(amountFraction?.numerator ?? transfer.numerator ?? ""),
  denominator: String(amountFraction?.denominator ?? transfer.denominator ?? ""),
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

const percentage = (fraction) =>
  `${(fractionToNumber(fraction) * 100).toLocaleString("en-MT", {
    maximumFractionDigits: 2,
  })}%`;

const exactLabel = (fraction) => `${fraction.numerator}/${fraction.denominator}`;

function partyName(party = {}) {
  return party.name || (party.type === "company" ? "Unnamed company" : "Unnamed individual");
}

function transferLabel(kind) {
  return kind === "donation" ? "donation" : "sale";
}

/**
 * A transaction card for a current owner that deliberately remains outside the family tree.
 * The transferor is fixed: this is not a second generic property-transfer screen.
 */
export function OutsideOwnerInspector({
  owner,
  property,
  people = [],
  outsideParties = [],
  onChange,
  onClose,
  onOpenSourcePerson,
}) {
  const backButtonRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const [editingTransferId, setEditingTransferId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState(blankDraft);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    document.body.classList.add("outside-owner-inspector-open");
    backButtonRef.current?.focus();
    const handleDialogKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = backButtonRef.current?.closest('[role="dialog"]');
      const focusable = [
        ...(dialog?.querySelectorAll(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
        ) || []),
      ].filter(
        (element) =>
          element instanceof HTMLElement &&
          !element.hidden &&
          element.getAttribute("aria-hidden") !== "true",
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleDialogKeydown);
    return () => {
      document.body.classList.remove("outside-owner-inspector-open");
      document.removeEventListener("keydown", handleDialogKeydown);
      if (previousFocusRef.current instanceof HTMLElement && previousFocusRef.current.isConnected) {
        previousFocusRef.current.focus();
      }
    };
  }, []);

  const transfers = useMemo(() => property?.transfers || [], [property?.transfers]);
  const workingProperty = useMemo(
    () => ({
      ...property,
      transfers: editingTransferId
        ? transfers.filter((transfer) => transfer.id !== editingTransferId)
        : transfers,
    }),
    [editingTransferId, property, transfers],
  );
  const report = useMemo(
    () => buildPropertyVendorTaxReport(property, people, outsideParties),
    [outsideParties, people, property],
  );
  const taxReport = useMemo(
    () => buildTaxCalculationReport(property, people, outsideParties, report),
    [outsideParties, people, property, report],
  );
  const vendorTax = useMemo(
    () => taxReport.vendors.find((vendor) => vendor.id === owner.id) || null,
    [owner.id, taxReport.vendors],
  );
  const workingReport = useMemo(
    () => buildPropertyVendorTaxReport(workingProperty, people, outsideParties),
    [outsideParties, people, workingProperty],
  );
  const outgoingTransfers = useMemo(
    () => (report.ledger?.entries || []).filter((entry) => entry.sellerId === owner.id),
    [owner.id, report.ledger?.entries],
  );
  const capacity = useMemo(
    () =>
      draft.date
        ? previewPropertyTransferCapacity(workingProperty, people, outsideParties, {
            sellerId: owner.id,
            date: draft.date,
            kind: draft.kind,
          })
        : null,
    [draft.date, draft.kind, outsideParties, owner.id, people, workingProperty],
  );
  const currentHolding =
    capacity?.holdingFraction ||
    workingReport.ownership?.ownershipFractionsByPerson?.[owner.id] ||
    ZERO_FRACTION;
  const provenanceTranches = useMemo(() => {
    if (capacity && !capacity.error) return capacity.tranches;
    return ownerProvenanceTranches(workingReport, workingProperty, owner.id);
  }, [capacity, owner.id, workingProperty, workingReport]);
  const currentInitialTaxRecordIds = new Set(
    (vendorTax?.rows || [])
      .filter((row) => row.sourceKind === "initial")
      .map((row) => row.originalOwnerRecordId)
      .filter(Boolean),
  );
  const hasUnresolvedDownstreamDonation = taxReport.vendors.some((vendor) =>
    (vendor.rows || []).some(
      (row) =>
        row.sourceKind === "donation" &&
        row.provenancePersonId === owner.id &&
        !row.donorAcquisitionDate,
    ),
  );
  const needsOriginalAcquisitionResolution =
    Boolean(vendorTax && vendorTax.tax == null) || hasUnresolvedDownstreamDonation;
  const originalAcquisitionResolutionRows = (property.owners || [])
    .filter(
      (record) =>
        needsOriginalAcquisitionResolution &&
        record.personId === owner.id &&
        !record.acquisitionDate &&
        !currentInitialTaxRecordIds.has(record.id),
    )
    .map((record) => ({
      id: `original-acquisition-${record.id || owner.id}`,
      sourceKind: "initial",
      provenance: "Original ownership",
      originalOwnerId: owner.id,
      originalOwnerRecordId: record.id || "",
      requiresOriginalAcquisitionDate: true,
      warning: "Enter this original owner's acquisition date for the tax calculation.",
    }));

  const setField = (patch) => setDraft((current) => ({ ...current, ...patch, error: "" }));
  const closeEditor = () => {
    setEditingTransferId("");
    setDraft(blankDraft());
    setFormOpen(false);
  };
  const openNew = () => {
    setNotice("");
    setEditingTransferId("");
    setDraft(blankDraft());
    setFormOpen(true);
  };
  const openEdit = (transferId) => {
    const transfer = transfers.find((candidate) => candidate.id === transferId);
    if (!transfer) return;
    const ledgerEntry = outgoingTransfers.find((entry) => entry.id === transferId);
    setNotice("");
    setEditingTransferId(transferId);
    setDraft(draftFromTransfer(transfer, ledgerEntry?.amountFraction));
    setFormOpen(true);
  };

  const calculateAmount = () => {
    if (draft.amountType === "all-share") return currentHolding;
    if (draft.shareInputMode === "percentage") {
      const input = normalisePercentageInput(draft.percentage).trim();
      const value = Number(input);
      if (!input || !Number.isFinite(value)) return { error: "Enter a valid percentage." };
      if (value <= 0) return { error: "The transferred percentage must be greater than zero." };
      if (value > 100) return { error: "The transferred percentage cannot exceed 100%." };
      const share = shareFromPercentage(value);
      return normaliseFraction(share.shareNumerator, share.shareDenominator);
    }
    return normaliseFraction(draft.numerator, draft.denominator);
  };
  const calculatedAmount = calculateAmount();
  const amountError = calculatedAmount.error
    ? calculatedAmount.error
    : compareFractions(calculatedAmount, ZERO_FRACTION) <= 0
      ? "The transferred share must be greater than zero."
      : compareFractions(calculatedAmount, currentHolding) > 0
        ? `${partyName(owner)} is marked as having attempted to sell or donate a larger share than the calculator shows it owned on that date.`
        : "";
  const needsDesignation =
    !amountError &&
    provenanceTranches.length > 1 &&
    compareFractions(calculatedAmount, currentHolding) < 0;
  const designationCheckedCount = provenanceTranches.filter(
    (tranche) => draft.designation[tranche.trancheId]?.checked,
  ).length;

  const provenanceFor = (amount) => {
    if (!provenanceTranches.length) return { provenance: [] };
    const record = ({ tranche, fraction }) => ({
      trancheId: tranche.trancheId,
      label: tranche.provenance,
      cause: tranche.cause,
      acquiredOn: tranche.acquiredOn,
      numerator: fraction.numerator,
      denominator: fraction.denominator,
    });
    if (!needsDesignation) {
      const result = selectTranchePortions(provenanceTranches, amount, { strategy: "pro-rata" });
      return result.error ? { error: result.error } : { provenance: result.portions.map(record) };
    }
    const selected = provenanceTranches.filter(
      (tranche) => draft.designation[tranche.trancheId]?.checked,
    );
    if (!selected.length) {
      const legacyTransfer = transfers.find((transfer) => transfer.id === editingTransferId);
      if (legacyTransfer && !(legacyTransfer.provenance || []).length) {
        const result = selectTranchePortions(provenanceTranches, amount, {
          strategy: "pro-rata",
        });
        return result.error ? { error: result.error } : { provenance: result.portions.map(record) };
      }
      return { error: "Choose which provenance is being transferred." };
    }
    const designation = selected.map((tranche) => {
      const entry = draft.designation[tranche.trancheId] || {};
      return {
        trancheId: tranche.trancheId,
        fraction:
          selected.length === 1 ? amount : normaliseFraction(entry.numerator, entry.denominator),
      };
    });
    const invalid = designation.find((entry) => entry.fraction.error);
    if (invalid) return { error: invalid.fraction.error };
    const result = selectTranchePortions(provenanceTranches, amount, {
      strategy: "designated",
      designation,
    });
    return result.error ? { error: result.error } : { provenance: result.portions.map(record) };
  };

  const submit = (event) => {
    event.preventDefault();
    setNotice("");
    if (capacity?.error) return setField({ error: capacity.error });
    if (amountError) return setField({ error: amountError });
    if (draft.acquirerMode === "existing" && !draft.acquirerId) {
      return setField({ error: "Choose who acquires the share." });
    }
    if (draft.acquirerId === owner.id) {
      return setField({ error: "Transferor and acquirer must be different." });
    }
    const provenance = provenanceFor(calculatedAmount);
    if (provenance.error) return setField({ error: provenance.error });
    const chronologyError = validateTransferDateChronology({
      transferDate: draft.date,
      acquisitionDates: provenance.provenance.map((entry) => entry.acquiredOn),
      eventLabel: draft.kind === "donation" ? "Donation" : "Sale",
    });
    if (chronologyError) return setField({ error: chronologyError });

    let nextOutsideParties = outsideParties;
    let buyerId = draft.acquirerId;
    if (draft.acquirerMode === "new") {
      const name = draft.acquirerName.trim();
      if (!name) {
        return setField({
          error:
            draft.acquirerType === "company"
              ? "Enter the company's name."
              : "Enter the acquirer's full name.",
        });
      }
      const acquirer = {
        id: crypto.randomUUID(),
        type: draft.acquirerType === "company" ? "company" : "individual",
        name,
        ...(draft.acquirerType === "company" && draft.registrationNumber.trim()
          ? { registrationNumber: draft.registrationNumber.trim() }
          : {}),
      };
      nextOutsideParties = [...outsideParties, acquirer];
      buyerId = acquirer.id;
    }

    const original = editingTransferId
      ? transfers.find((transfer) => transfer.id === editingTransferId)
      : null;
    if (editingTransferId && !original) {
      return setField({ error: "This transfer can no longer be found. Reopen the owner card." });
    }
    const transfer = {
      ...(original || {}),
      id: original?.id || crypto.randomUUID(),
      kind: draft.kind === "donation" ? "donation" : "sale",
      sellerId: owner.id,
      buyerId,
      numerator: String(calculatedAmount.numerator),
      denominator: String(calculatedAmount.denominator),
      amountType: "whole-property",
      date: draft.date,
      provenance: provenance.provenance,
    };
    const nextTransfers = original
      ? transfers.map((candidate) => (candidate.id === original.id ? transfer : candidate))
      : [...transfers, transfer];
    const prospective = buildPropertyVendorTaxReport(
      { ...property, transfers: nextTransfers },
      people,
      nextOutsideParties,
    );
    const savedEntry = prospective.ledger.entries.find((entry) => entry.id === transfer.id);
    if (!savedEntry || savedEntry.error) {
      return setField({ error: savedEntry?.error || "The transfer could not be validated." });
    }
    const existingInvalid = new Set(
      (report.ledger?.entries || []).filter((entry) => entry.error).map((entry) => entry.id),
    );
    const newlyInvalid = prospective.ledger.entries.find(
      (entry) => entry.id !== transfer.id && entry.error && !existingInvalid.has(entry.id),
    );
    if (newlyInvalid) {
      return setField({
        error: `This change would invalidate the later transfer dated ${
          isoDateToDisplay(newlyInvalid.date) || "an unknown date"
        }. ${newlyInvalid.error}`,
      });
    }
    onChange?.({ transfers: nextTransfers, outsideParties: nextOutsideParties });
    setNotice(`${draft.kind === "donation" ? "Donation" : "Sale"} recorded.`);
    closeEditor();
  };

  const removeTransfer = (transferId) => {
    setNotice("");
    const nextTransfers = transfers.filter((transfer) => transfer.id !== transferId);
    const prospective = buildPropertyVendorTaxReport(
      { ...property, transfers: nextTransfers },
      people,
      outsideParties,
    );
    const existingInvalid = new Set(
      (report.ledger?.entries || []).filter((entry) => entry.error).map((entry) => entry.id),
    );
    const newlyInvalid = prospective.ledger.entries.find(
      (entry) => entry.error && !existingInvalid.has(entry.id),
    );
    if (newlyInvalid) {
      setNotice(
        `Delete the dependent transfer dated ${isoDateToDisplay(newlyInvalid.date) || "an unknown date"} first. ${newlyInvalid.error}`,
      );
      return;
    }
    onChange?.({ transfers: nextTransfers, outsideParties });
    if (editingTransferId === transferId) closeEditor();
    setNotice("Transfer deleted.");
  };

  const confirmInitialAcquisition = ({ row, acquisitionDate }) => {
    const result = setLivingInitialOwnerAcquisitionDate(
      property,
      people,
      owner.id,
      acquisitionDate,
      outsideParties,
      row?.originalOwnerRecordId || "",
    );
    if (result.error) {
      setNotice(result.error);
      return;
    }
    onChange?.({
      property: result.property,
      transfers: result.property.transfers || [],
      outsideParties,
    });
    setNotice("Original acquisition date saved.");
  };

  const confirmDonationValue = ({ row, acquisitionValue, acquisitionValueBasis }) => {
    const result = setDonationAcquisitionValue(
      property,
      owner.id,
      row?.sourceTransferId || "",
      acquisitionValue,
      acquisitionValueBasis,
    );
    if (result.error) {
      setNotice(result.error);
      return;
    }
    onChange?.({
      property: result.property,
      transfers: result.property.transfers || [],
      outsideParties,
    });
    setNotice("Donation Value saved.");
  };

  const partyById = new Map([
    ...people.map((person) => [person.id, { ...person, name: personChoiceLabel(person, people) }]),
    ...outsideParties.map((party) => [party.id, party]),
  ]);

  return (
    <div
      className="outside-owner-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="outside-owner-title"
    >
      <section className="outside-owner-sheet">
        <header className="outside-owner-header">
          <button ref={backButtonRef} type="button" className="secondary-button" onClick={onClose}>
            <ArrowLeft size={16} /> Back to ownership
          </button>
          <div>
            <p className="eyebrow">Outside owner</p>
            <h2 id="outside-owner-title">{partyName(owner)}</h2>
            {owner.registrationNumber && <small>{owner.registrationNumber}</small>}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close outside owner"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>

        <div className="outside-owner-current-share">
          {owner.type === "company" ? <Building2 size={18} /> : <UserRound size={18} />}
          <span>Available now</span>
          <strong>
            {exactLabel(report.ownership?.ownershipFractionsByPerson?.[owner.id] || ZERO_FRACTION)}
          </strong>
        </div>

        <FinalWithholdingTaxSection
          vendorTax={vendorTax}
          additionalResolutionRows={originalAcquisitionResolutionRows}
          onOpenSourcePerson={
            onOpenSourcePerson
              ? (personId) => {
                  onClose?.();
                  onOpenSourcePerson(personId);
                }
              : undefined
          }
          onConfirmInitialAcquisition={confirmInitialAcquisition}
          onConfirmDonationAcquisitionValue={confirmDonationValue}
        />

        {outgoingTransfers.length > 0 && (
          <div className="outside-owner-transfer-list" aria-label="Recorded owner transfers">
            {outgoingTransfers.map((entry) => {
              const buyer = partyById.get(entry.buyerId);
              return (
                <div
                  className={`outside-owner-transfer-row${entry.error ? " invalid" : ""}`}
                  key={entry.id}
                >
                  <button
                    type="button"
                    className="outside-owner-transfer-summary"
                    aria-label={`Edit ${transferLabel(entry.kind)} record`}
                    onClick={() => openEdit(entry.id)}
                  >
                    <span>
                      <strong>{entry.kind === "donation" ? "Donation" : "Sale"}</strong>
                      <small>
                        {isoDateToDisplay(entry.date) || "Undated"} · {partyName(buyer)}
                      </small>
                    </span>
                    <span>
                      <b>{entry.amountFraction ? exactLabel(entry.amountFraction) : "Invalid"}</b>
                      {entry.amountFraction && <small>{percentage(entry.amountFraction)}</small>}
                    </span>
                    <Pencil size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Delete ${transferLabel(entry.kind)} record`}
                    onClick={() => removeTransfer(entry.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                  {entry.error && <small className="transfer-error">{entry.error}</small>}
                </div>
              );
            })}
          </div>
        )}

        {notice && (
          <p className="outside-owner-notice" role="status">
            {notice}
          </p>
        )}

        {!formOpen &&
        compareFractions(
          report.ownership?.ownershipFractionsByPerson?.[owner.id] || ZERO_FRACTION,
          ZERO_FRACTION,
        ) > 0 ? (
          <button type="button" className="primary-button outside-owner-add" onClick={openNew}>
            {outgoingTransfers.length ? "Add another sale or donation" : "Add sale or donation"}
          </button>
        ) : formOpen ? (
          <form className="outside-owner-transfer-form" noValidate onSubmit={submit}>
            <h3>{editingTransferId ? "Edit transfer" : "New transfer"}</h3>
            <label>
              Contract
              <select
                aria-label="Outside owner contract"
                value={draft.kind}
                onChange={(event) => setField({ kind: event.target.value })}
              >
                <option value="sale">Sale</option>
                <option value="donation">Donation</option>
              </select>
            </label>
            <label>
              {draft.kind === "donation" ? "Donation date" : "Sale date"}
              <DateInput
                aria-label="Outside owner transfer date"
                value={draft.date}
                onChange={(date) => setField({ date })}
              />
            </label>
            <label>
              Acquirer
              <select
                aria-label="Outside owner acquirer source"
                value={draft.acquirerMode}
                onChange={(event) => setField({ acquirerMode: event.target.value })}
              >
                <option value="existing">Existing person or organisation</option>
                {!editingTransferId && <option value="new">Add someone new</option>}
              </select>
            </label>
            {draft.acquirerMode === "existing" ? (
              <label>
                Person or organisation
                <select
                  aria-label="Outside owner acquirer"
                  value={draft.acquirerId}
                  onChange={(event) => setField({ acquirerId: event.target.value })}
                >
                  <option value="">Choose acquirer</option>
                  {sortPeopleForChoice(people, people)
                    .filter((person) => person.id !== owner.id)
                    .map((person) => (
                      <option value={person.id} key={person.id}>
                        {personChoiceLabel(person, people)}
                      </option>
                    ))}
                  {outsideParties
                    .filter((party) => party.id !== owner.id)
                    .slice()
                    .sort((left, right) =>
                      partyName(left).localeCompare(partyName(right), "en-MT", {
                        sensitivity: "base",
                      }),
                    )
                    .map((party) => (
                      <option value={party.id} key={party.id}>
                        {partyName(party)}
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
                    aria-label="New outside acquirer type"
                    value={draft.acquirerType}
                    onChange={(event) => setField({ acquirerType: event.target.value })}
                  >
                    <option value="individual">Individual</option>
                    <option value="company">Company</option>
                  </select>
                </label>
                <label>
                  {draft.acquirerType === "company" ? "Company name" : "Full name"}
                  <input
                    aria-label="New outside acquirer name"
                    value={draft.acquirerName}
                    onChange={(event) => setField({ acquirerName: event.target.value })}
                  />
                </label>
                {draft.acquirerType === "company" && (
                  <label>
                    Registration number (optional)
                    <input
                      aria-label="New outside company registration"
                      value={draft.registrationNumber}
                      onChange={(event) => setField({ registrationNumber: event.target.value })}
                    />
                  </label>
                )}
              </>
            )}
            <label>
              Transfer measurement
              <select
                aria-label="Outside owner transfer measurement"
                value={draft.amountType}
                onChange={(event) => setField({ amountType: event.target.value, designation: {} })}
              >
                <option value="all-share">All of the Share</option>
                <option value="defined-share">Define fraction or percentage</option>
              </select>
            </label>
            {draft.amountType === "defined-share" && (
              <div className="transfer-definition">
                <label>
                  Enter share as
                  <select
                    aria-label="Outside owner share format"
                    value={draft.shareInputMode}
                    onChange={(event) =>
                      setField({ shareInputMode: event.target.value, designation: {} })
                    }
                  >
                    <option value="fraction">Fraction</option>
                    <option value="percentage">Percentage</option>
                  </select>
                </label>
                {draft.shareInputMode === "percentage" ? (
                  <label>
                    Percentage of whole property
                    <span className="transfer-percentage">
                      <input
                        aria-label="Outside owner transfer percentage"
                        type="number"
                        min="0"
                        max={fractionToNumber(currentHolding) * 100}
                        step="0.01"
                        inputMode="decimal"
                        value={draft.percentage}
                        onChange={(event) =>
                          setField({ percentage: event.target.value, designation: {} })
                        }
                        onBlur={(event) =>
                          setField({
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
                        aria-label="Outside owner transfer numerator"
                        type="number"
                        min="0"
                        max={MAX_FRACTION_INTEGER}
                        step="1"
                        value={draft.numerator}
                        onChange={(event) =>
                          setField({ numerator: event.target.value, designation: {} })
                        }
                      />
                    </label>
                    <span>/</span>
                    <label>
                      Denominator
                      <input
                        aria-label="Outside owner transfer denominator"
                        type="number"
                        min="1"
                        max={MAX_FRACTION_INTEGER}
                        step="1"
                        value={draft.denominator}
                        onChange={(event) =>
                          setField({ denominator: event.target.value, designation: {} })
                        }
                      />
                    </label>
                  </div>
                )}
              </div>
            )}
            <div className={`transfer-limit${capacity?.error ? " unavailable" : ""}`}>
              <span>Available to transfer</span>
              <strong>
                {capacity?.error ? "Unavailable on this date" : exactLabel(currentHolding)}
              </strong>
            </div>
            {needsDesignation && (
              <div
                className="provenance-designation"
                role="group"
                aria-label="Outside owner provenance designation"
              >
                <span className="provenance-heading">Which provenance is being transferred?</span>
                {provenanceTranches.map((tranche) => {
                  const entry = draft.designation[tranche.trancheId] || {};
                  return (
                    <div className="provenance-row" key={tranche.trancheId}>
                      <label className="provenance-pick">
                        <input
                          type="checkbox"
                          checked={Boolean(entry.checked)}
                          onChange={(event) =>
                            setField({
                              designation: {
                                ...draft.designation,
                                [tranche.trancheId]: { ...entry, checked: event.target.checked },
                              },
                            })
                          }
                        />
                        <span>
                          <strong>{tranche.provenance}</strong>
                          <small>
                            {exactLabel(tranche.fraction)}
                            {tranche.acquiredOn ? ` · ${isoDateToDisplay(tranche.acquiredOn)}` : ""}
                          </small>
                        </span>
                      </label>
                      {entry.checked && designationCheckedCount > 1 && (
                        <span className="provenance-fraction">
                          <input
                            aria-label={`Outside owner numerator from ${tranche.provenance}`}
                            type="number"
                            min="0"
                            max={MAX_FRACTION_INTEGER}
                            value={entry.numerator}
                            onChange={(event) =>
                              setField({
                                designation: {
                                  ...draft.designation,
                                  [tranche.trancheId]: { ...entry, numerator: event.target.value },
                                },
                              })
                            }
                          />
                          <span>/</span>
                          <input
                            aria-label={`Outside owner denominator from ${tranche.provenance}`}
                            type="number"
                            min="1"
                            max={MAX_FRACTION_INTEGER}
                            value={entry.denominator}
                            onChange={(event) =>
                              setField({
                                designation: {
                                  ...draft.designation,
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
              </div>
            )}
            {(draft.error || capacity?.error || amountError) && (
              <p className="transfer-error" role="alert">
                {draft.error || capacity?.error || amountError}
              </p>
            )}
            <div className="outside-owner-form-actions">
              <button type="submit" className="primary-button">
                {editingTransferId ? "Save transfer" : "Record transfer"}
              </button>
              <button type="button" className="secondary-button" onClick={closeEditor}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}
