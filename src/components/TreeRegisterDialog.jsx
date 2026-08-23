import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, Plus, Trash2, UserRoundPen, X } from "lucide-react";
import { DateInput } from "./DateInput.jsx";
import {
  composeFullName,
  personDisplayName,
  personGivenNames,
  personSurname,
} from "../domain/people.js";
import { buildTreeRegisterRows, treeRegisterDisplayName } from "../domain/treeRegister.js";
import { personWills, personWithWills } from "../domain/wills.js";
import { TREE_DATA_LIMITS } from "../domain/treeData.js";

export const TREE_REGISTER_DRAFT_COMMIT_DELAY_MS = 700;

const money = new Intl.NumberFormat("en-MT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const canBeParentOf = (candidate, personId, peopleById) => {
  if (!candidate?.id || candidate.id === personId) return false;
  const pending = [candidate.id];
  const visited = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (!id || visited.has(id)) continue;
    if (id === personId) return false;
    visited.add(id);
    const person = peopleById.get(id);
    if (person) pending.push(person.fatherId, person.motherId);
  }
  return true;
};

function BufferedRegisterInput({ value = "", onCommit, onRegisterController, ...inputProps }) {
  const initial = String(value ?? "");
  const [draft, setDraft] = useState(initial);
  const draftRef = useRef(initial);
  const baseRef = useRef(initial);
  const dirtyRef = useRef(false);
  const timerRef = useRef(null);
  const onCommitRef = useRef(onCommit);
  const controllerRef = useRef(null);

  onCommitRef.current = onCommit;

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    globalThis.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const commitRef = useRef(() => true);
  commitRef.current = () => {
    clearTimer();
    if (!dirtyRef.current) return true;
    let committed;
    try {
      committed = onCommitRef.current?.(draftRef.current);
    } catch {
      return false;
    }
    if (committed === false || committed === null) return false;
    dirtyRef.current = false;
    baseRef.current = draftRef.current;
    return true;
  };

  if (!controllerRef.current) {
    controllerRef.current = {
      flush: () => commitRef.current(),
      hasPending: () => dirtyRef.current,
    };
  }

  useEffect(() => {
    if (dirtyRef.current) return;
    const next = String(value ?? "");
    if (next === draftRef.current) return;
    draftRef.current = next;
    baseRef.current = next;
    setDraft(next);
  }, [value]);

  useEffect(() => {
    const unregister = onRegisterController(controllerRef.current);
    return () => {
      if (dirtyRef.current) commitRef.current();
      unregister?.();
      clearTimer();
    };
  }, [clearTimer, onRegisterController]);

  const updateDraft = (next) => {
    draftRef.current = next;
    dirtyRef.current = next !== baseRef.current;
    setDraft(next);
    clearTimer();
    if (dirtyRef.current) {
      timerRef.current = globalThis.setTimeout(() => {
        timerRef.current = null;
        commitRef.current();
      }, TREE_REGISTER_DRAFT_COMMIT_DELAY_MS);
    }
  };

  return (
    <input
      {...inputProps}
      value={draft}
      onChange={(event) => updateDraft(event.target.value)}
      onBlur={() => commitRef.current()}
    />
  );
}

function RepeatableWillCell({ person, row, onUpdatePerson, registerController }) {
  const updateWill = (willId, patch) =>
    onUpdatePerson(person.id, (latest) =>
      personWithWills(
        latest,
        personWills(latest).map((will) => (will.id === willId ? { ...will, ...patch } : will)),
      ),
    );
  const removeWill = (willId) =>
    onUpdatePerson(person.id, (latest) =>
      personWithWills(
        latest,
        personWills(latest).filter((will) => will.id !== willId),
      ),
    );
  const addWill = () =>
    onUpdatePerson(person.id, (latest) =>
      personWithWills(latest, [
        ...personWills(latest),
        { id: crypto.randomUUID(), date: "", notaryName: "", description: "" },
      ]),
    );

  return (
    <div className="tree-register-repeat-list">
      {row.wills.map((will, index) => (
        <div className="tree-register-repeat" key={will.id}>
          <span className="tree-register-repeat-number">Will {index + 1}</span>
          <DateInput
            aria-label={`Will ${index + 1} date for ${treeRegisterDisplayName(row)}`}
            value={will.date}
            onChange={(date) => updateWill(will.id, { date })}
          />
          <BufferedRegisterInput
            aria-label={`Will ${index + 1} notary for ${treeRegisterDisplayName(row)}`}
            value={will.notaryName}
            placeholder="Notary"
            onCommit={(notaryName) => updateWill(will.id, { notaryName })}
            onRegisterController={registerController}
          />
          <BufferedRegisterInput
            aria-label={`Will ${index + 1} comment for ${treeRegisterDisplayName(row)}`}
            value={will.description}
            placeholder="Will comment"
            onCommit={(description) => updateWill(will.id, { description })}
            onRegisterController={registerController}
          />
          <button
            type="button"
            className="tree-register-remove"
            aria-label={`Remove will ${index + 1} for ${treeRegisterDisplayName(row)}`}
            onClick={() => removeWill(will.id)}
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button type="button" className="tree-register-add" onClick={addWill}>
        <Plus size={13} aria-hidden="true" /> Add will
      </button>
    </div>
  );
}

function ParentageCell({ person, row, people, peopleById, onUpdatePerson }) {
  const [editing, setEditing] = useState(false);
  const availableParents = editing
    ? people.filter((candidate) => canBeParentOf(candidate, person.id, peopleById))
    : [];

  return (
    <div className="tree-register-parentage-cell">
      <span className="tree-register-parentage">{row.parentage}</span>
      {editing ? (
        <>
          <label>
            <span>Father</span>
            <select
              value={row.fatherId}
              onChange={(event) => onUpdatePerson(person.id, { fatherId: event.target.value })}
            >
              <option value="">Not selected</option>
              {availableParents.map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {personDisplayName(parent, people)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Mother</span>
            <select
              value={row.motherId}
              onChange={(event) => onUpdatePerson(person.id, { motherId: event.target.value })}
            >
              <option value="">Not selected</option>
              {availableParents.map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {personDisplayName(parent, people)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="tree-register-add" onClick={() => setEditing(false)}>
            Done
          </button>
        </>
      ) : (
        <button type="button" className="tree-register-add" onClick={() => setEditing(true)}>
          Edit parents
        </button>
      )}
    </div>
  );
}

function RepeatableCausaMortisCell({
  person,
  propertyId,
  row,
  onUpdatePerson,
  registerController,
}) {
  const updateDeclaration = (declarationId, patch) =>
    onUpdatePerson(person.id, (latest) => ({
      ...latest,
      causaMortisDeclarations: (latest.causaMortisDeclarations || []).map((declaration) =>
        declaration.id === declarationId ? { ...declaration, ...patch } : declaration,
      ),
    }));
  const removeDeclaration = (declarationId) =>
    onUpdatePerson(person.id, (latest) => ({
      ...latest,
      causaMortisDeclarations: (latest.causaMortisDeclarations || []).filter(
        (declaration) => declaration.id !== declarationId,
      ),
    }));
  const addDeclaration = () =>
    onUpdatePerson(person.id, (latest) => ({
      ...latest,
      causaMortisDeclarations: [
        ...(latest.causaMortisDeclarations || []),
        {
          id: crypto.randomUUID(),
          propertyId,
          status: "draft",
          date: "",
          notaryName: "",
          declarantPersonIds: [],
          declaredShareNumerator: "",
          declaredShareDenominator: "",
          immovablePropertyValue: "",
        },
      ],
    }));

  return (
    <div className="tree-register-repeat-list">
      {row.causaMortisDeclarations.map((declaration, index) => (
        <div className="tree-register-repeat tree-register-cm-repeat" key={declaration.id}>
          <span className="tree-register-repeat-number">DCM {index + 1}</span>
          <DateInput
            aria-label={`DCM ${index + 1} date for ${treeRegisterDisplayName(row)}`}
            value={declaration.date}
            onChange={(date) => updateDeclaration(declaration.id, { date })}
          />
          <BufferedRegisterInput
            aria-label={`DCM ${index + 1} notary for ${treeRegisterDisplayName(row)}`}
            value={declaration.notaryName}
            placeholder="Notary"
            onCommit={(notaryName) => updateDeclaration(declaration.id, { notaryName })}
            onRegisterController={registerController}
          />
          <button
            type="button"
            className="tree-register-remove"
            aria-label={`Remove DCM ${index + 1} for ${treeRegisterDisplayName(row)}`}
            onClick={() => removeDeclaration(declaration.id)}
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
          {declaration.status !== "complete" && <small>Draft - complete on the person card</small>}
        </div>
      ))}
      <button type="button" className="tree-register-add" onClick={addDeclaration}>
        <Plus size={13} aria-hidden="true" /> Add DCM
      </button>
    </div>
  );
}

export function TreeRegisterDialog({
  open,
  treeTitle,
  property,
  people = [],
  ownershipByPerson,
  ownershipFractionsByPerson,
  currentOwnerPresentationsByPerson,
  shareDisplay = "both",
  onShareDisplayChange,
  onUpdateTreeTitle,
  onUpdateProperty,
  onUpdatePerson,
  onSetDeceased,
  onOpenPerson,
  onDownload,
  onRegisterPendingEditFlush,
  onClose,
}) {
  const controllersRef = useRef(new Set());
  const dialogRef = useRef(null);
  const registerController = useCallback((controller) => {
    controllersRef.current.add(controller);
    return () => controllersRef.current.delete(controller);
  }, []);
  const flushAll = useCallback(() => {
    for (const controller of controllersRef.current) {
      if (controller.hasPending?.() && controller.flush?.() === false) return false;
    }
    return true;
  }, []);

  useEffect(() => {
    if (!onRegisterPendingEditFlush) return undefined;
    return onRegisterPendingEditFlush({
      flush: flushAll,
      hasPending: () => [...controllersRef.current].some((controller) => controller.hasPending?.()),
    });
  }, [flushAll, onRegisterPendingEditFlush]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (flushAll()) onClose?.();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [flushAll, onClose, open]);

  const rows = useMemo(
    () =>
      buildTreeRegisterRows({
        people,
        property,
        ownershipByPerson,
        ownershipFractionsByPerson,
        currentOwnerPresentationsByPerson,
      }),
    [
      currentOwnerPresentationsByPerson,
      ownershipByPerson,
      ownershipFractionsByPerson,
      people,
      property,
    ],
  );
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const close = () => {
    if (flushAll()) onClose?.();
  };

  if (!open) return null;

  return (
    <div className="tree-register-backdrop" role="presentation">
      <section
        className="tree-register-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tree-register-title"
        ref={dialogRef}
      >
        <header className="tree-register-heading">
          <div>
            <p className="eyebrow">Tree Tools</p>
            <h2 id="tree-register-title">Tree Register</h2>
            <p>Edits save back to the family tree. Ownership and holding values are calculated.</p>
          </div>
          <div className="tree-register-heading-actions">
            <button type="button" className="secondary-button" onClick={onDownload}>
              <FileSpreadsheet size={16} aria-hidden="true" /> Download Excel
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Close Tree Register"
              onClick={close}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="tree-register-case-fields">
          <label>
            <span>Tree name</span>
            <BufferedRegisterInput
              value={treeTitle}
              maxLength={TREE_DATA_LIMITS.maxTitleCharacters}
              onCommit={onUpdateTreeTitle}
              onRegisterController={registerController}
            />
          </label>
          <label>
            <span>Value of property being sold</span>
            <span className="currency-input">
              <b>€</b>
              <BufferedRegisterInput
                type="number"
                min="0"
                step="any"
                value={property.saleValue ?? ""}
                onCommit={(saleValue) => onUpdateProperty({ saleValue })}
                onRegisterController={registerController}
              />
            </span>
          </label>
          <fieldset className="tree-register-share-toggle">
            <legend>Ownership display</legend>
            {["fraction", "percentage", "both"].map((mode) => (
              <label key={mode}>
                <input
                  type="radio"
                  name="tree-register-share-display"
                  value={mode}
                  checked={shareDisplay === mode}
                  onChange={() => onShareDisplayChange(mode)}
                />
                <span>{mode === "both" ? "Both" : `${mode[0].toUpperCase()}${mode.slice(1)}`}</span>
              </label>
            ))}
          </fieldset>
        </div>

        <div
          className="tree-register-scroll"
          tabIndex={0}
          aria-label="Scrollable Tree Register grid"
        >
          <table className="tree-register-table">
            <thead>
              <tr>
                <th>Surname</th>
                <th>Name</th>
                <th>Son / daughter of</th>
                <th>Alive or date of death</th>
                <th>Intestate / wills</th>
                <th>Declaration Causa Mortis</th>
                <th>Ownership</th>
                <th>Value of holding at death / current if alive</th>
                <th>Person card</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const person = peopleById.get(row.personId);
                if (!person) return null;
                return (
                  <tr key={row.personId} data-person-id={row.personId}>
                    <td>
                      <BufferedRegisterInput
                        aria-label={`Surname for ${treeRegisterDisplayName(row)}`}
                        value={row.surname}
                        onCommit={(surname) =>
                          onUpdatePerson(person.id, (latest) => ({
                            ...latest,
                            surname,
                            fullName: composeFullName(personGivenNames(latest), surname),
                          }))
                        }
                        onRegisterController={registerController}
                      />
                    </td>
                    <td>
                      <BufferedRegisterInput
                        aria-label={`Name for ${treeRegisterDisplayName(row)}`}
                        value={row.name}
                        onCommit={(givenNames) =>
                          onUpdatePerson(person.id, (latest) => ({
                            ...latest,
                            givenNames,
                            fullName: composeFullName(givenNames, personSurname(latest)),
                          }))
                        }
                        onRegisterController={registerController}
                      />
                    </td>
                    <td>
                      <ParentageCell
                        person={person}
                        row={row}
                        people={people}
                        peopleById={peopleById}
                        onUpdatePerson={onUpdatePerson}
                      />
                    </td>
                    <td>
                      <select
                        aria-label={`Life status for ${treeRegisterDisplayName(row)}`}
                        value={row.deceased ? "deceased" : "alive"}
                        onChange={(event) =>
                          onSetDeceased(person.id, event.target.value === "deceased")
                        }
                      >
                        <option value="alive">Alive</option>
                        <option value="deceased">Deceased</option>
                      </select>
                      {row.deceased && (
                        <>
                          <DateInput
                            aria-label={`Date of death for ${treeRegisterDisplayName(row)}`}
                            value={row.dateOfDeath}
                            disabled={row.dateOfDeathUnknown}
                            onChange={(dateOfDeath) =>
                              onUpdatePerson(person.id, {
                                dateOfDeath,
                                dateOfDeathUnknown: false,
                                olderGenerationDeathAssumed: false,
                                olderGenerationDeathAssumptionDismissed: false,
                              })
                            }
                          />
                          <label className="tree-register-check">
                            <input
                              type="checkbox"
                              checked={row.dateOfDeathUnknown}
                              onChange={(event) =>
                                onUpdatePerson(person.id, {
                                  dateOfDeathUnknown: event.target.checked,
                                  dateOfDeath: event.target.checked ? "" : row.dateOfDeath,
                                  olderGenerationDeathAssumed: false,
                                  olderGenerationDeathAssumptionDismissed: false,
                                })
                              }
                            />
                            Date unknown
                          </label>
                        </>
                      )}
                    </td>
                    <td>
                      {row.deceased ? (
                        <>
                          <select
                            aria-label={`Succession basis for ${treeRegisterDisplayName(row)}`}
                            value={row.successionBasis}
                            onChange={(event) =>
                              onUpdatePerson(person.id, { inheritanceBasis: event.target.value })
                            }
                          >
                            <option value="intestacy">Intestate</option>
                            <option value="will">By will</option>
                          </select>
                          {row.successionBasis === "will" && (
                            <RepeatableWillCell
                              person={person}
                              row={row}
                              onUpdatePerson={onUpdatePerson}
                              registerController={registerController}
                            />
                          )}
                        </>
                      ) : (
                        <span className="tree-register-muted">
                          Living - succession not applicable
                        </span>
                      )}
                    </td>
                    <td>
                      {row.deceased ? (
                        <RepeatableCausaMortisCell
                          person={person}
                          propertyId={property.id}
                          row={row}
                          onUpdatePerson={onUpdatePerson}
                          registerController={registerController}
                        />
                      ) : (
                        <span className="tree-register-muted">Not applicable while alive</span>
                      )}
                    </td>
                    <td className="tree-register-calculated">
                      {row.hasHolding ? (
                        <>
                          {shareDisplay !== "percentage" && <strong>{row.fractionLabel}</strong>}
                          {shareDisplay !== "fraction" && <span>{row.percentageLabel}</span>}
                        </>
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                    <td className="tree-register-calculated">
                      <small>{row.holdingValueKind}</small>
                      <strong>
                        {row.holdingValue === null ? "—" : money.format(row.holdingValue)}
                      </strong>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="tree-register-open-card"
                        onClick={() => {
                          if (flushAll()) onOpenPerson(person.id);
                        }}
                      >
                        <UserRoundPen size={15} aria-hidden="true" /> Open card
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <footer className="tree-register-footer">
          <small>
            DCM drafts can be completed with fractions, values and declarants on the person card.
          </small>
          <button type="button" className="primary-button" onClick={close}>
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}
