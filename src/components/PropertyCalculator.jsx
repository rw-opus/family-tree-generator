import { Calculator, Plus, Scale, Trash2 } from "lucide-react";
import { allocateCurrentIntestacy, inheritanceDuty, percentageTotal, saleTaxLot, successionRuleset, suggestedIntestacyShares } from "../domain/propertyTax.js";
import { fractionForShare, shareFromFraction, shareFromPercentage } from "../domain/shares.js";
import { OwnershipTransfers } from "./OwnershipTransfers.jsx";
import { SuccessionDeclarations } from "./SuccessionDeclarations.jsx";

const money = new Intl.NumberFormat("en-MT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const makeHeir = () => ({ id: crypto.randomUUID(), personId: "", name: "", relationship: "Child", status: "undecided", degree: 1, branchId: "", sharePercent: 0, shareNumerator: 0, shareDenominator: 1, soleResidence: false, exemption: "none" });
const makeLot = () => ({ id: crypto.randomUUID(), ownerName: "", inheritanceDate: "", acquisitionValue: "", transferValue: "", brokerageFees: "", qualifiesFivePercent: false, ownResidenceExempt: false });

export function PropertyCalculator({ caseData, onChange }) {
  const { property, succession } = caseData;
  const heirs = succession.heirs || [];
  const familyPeople = caseData.people || [];
  const lots = caseData.saleLots || [];
  const shareDisplay = caseData.settings?.shareDisplay || "both";
  const setProperty = (patch) => onChange({ ...caseData, property: { ...property, ...patch } });
  const setSuccession = (patch) => onChange({ ...caseData, succession: { ...succession, ...patch } });
  const updateHeir = (id, patch) => setSuccession({ heirs: heirs.map((heir) => heir.id === id ? { ...heir, ...patch } : heir) });
  const updateHeirPercentage = (id, percentage) => updateHeir(id, shareFromPercentage(percentage));
  const updateHeirFraction = (heir, patch) => {
    const current = fractionForShare(heir);
    updateHeir(heir.id, shareFromFraction(
      patch.shareNumerator ?? current.numerator,
      patch.shareDenominator ?? current.denominator,
    ));
  };
  const updateLot = (id, patch) => onChange({ ...caseData, saleLots: lots.map((lot) => lot.id === id ? { ...lot, ...patch } : lot) });
  const addToBranch = (person) => setSuccession({ heirs: [...heirs, { ...makeHeir(), relationship: ["Sibling", "Sibling descendant"].includes(person.relationship) ? "Sibling descendant" : "Descendant", branchId: person.id }] });
  const total = percentageTotal(heirs);
  const saleRows = lots.map((lot) => ({ lot, result: saleTaxLot(lot) }));
  const ruleset = successionRuleset(succession.dateOfDeath);
  const allocation = ruleset.supported && succession.basis === "intestacy" ? allocateCurrentIntestacy(heirs) : null;
  return <div className="calculator-stack">
    <section className="editor-panel">
      <header><p className="eyebrow">Property and transmission</p><h2>Succession case</h2><p className="helper-text">Model the deceased owner's share and the right transmitted at the date of death.</p></header>
      <div className="form-grid">
        <label className="full-width">Property address<input value={property.address || ""} onChange={(e) => setProperty({ address: e.target.value })} placeholder="Full address of the inherited property" /></label>
        <label className="full-width">Property reference / description<input value={property.description} onChange={(e) => setProperty({ description: e.target.value })} placeholder="Optional registry, title or internal reference" /></label>
        <label>Market value at death (€)<input type="number" min="0" value={property.marketValueAtDeath} onChange={(e) => setProperty({ marketValueAtDeath: e.target.value })} /></label>
        <label>Whole-property sale value, if any (€)<input type="number" min="0" value={property.saleValue || ""} onChange={(e) => setProperty({ saleValue: e.target.value })} /></label>
        <label>Deceased's ownership (%)<input type="number" min="0" max="100" value={property.deceasedOwnershipPercent} onChange={(e) => setProperty({ deceasedOwnershipPercent: e.target.value })} /></label>
        <label>Value of right inherited (%)<input type="number" min="0" max="100" value={property.rightPercent} onChange={(e) => setProperty({ rightPercent: e.target.value })} /></label>
        <label>Date of death<input type="date" value={succession.dateOfDeath} onChange={(e) => setSuccession({ dateOfDeath: e.target.value })} /></label>
        <label>Basis<select value={succession.basis} onChange={(e) => setSuccession({ basis: e.target.value })}><option value="intestacy">Intestacy</option><option value="will">Will</option><option value="mixed">Will and partial intestacy</option></select></label>
        {succession.basis !== "intestacy" && <><label>Will date<input type="date" value={succession.willDate} onChange={(e) => setSuccession({ willDate: e.target.value })} /></label><label>Notary's name (Malta)<input value={succession.notaryName} onChange={(e) => setSuccession({ notaryName: e.target.value })} /></label></>}
        <label className="check-label"><input type="checkbox" checked={succession.deedWithinSixMonths} onChange={(e) => setSuccession({ deedWithinSixMonths: e.target.checked })} /> Causa mortis deed within six months</label>
      </div>
      <div className={`ruleset-banner ${ruleset.supported ? "supported" : "attention"}`}><strong>{ruleset.label}</strong><span>{ruleset.key === "pre2005" ? "Automatic historical allocation is locked until the pre-2005 provisions are added." : ruleset.key === "undated" ? "The applicable succession law cannot be selected without this date." : "Automatic allocation uses Articles 801–816 supplied for present-day Maltese law."}</span></div>
    </section>
    <section className="editor-panel">
      <div className="section-heading"><div><p className="eyebrow">Ownership today</p><h2>Persons called to the succession</h2></div>{succession.basis === "intestacy" && <button type="button" className="secondary-button" disabled={!ruleset.supported} onClick={() => setSuccession({ heirs: suggestedIntestacyShares(heirs, succession.dateOfDeath).map((heir) => ({ ...heir, ...shareFromPercentage(heir.sharePercent) })) })}><Scale size={16} /> Apply current intestacy</button>}</div>
      <p className={`share-status ${Math.abs(total - 100) < .001 ? "valid" : "invalid"}`}>Allocated: {total.toFixed(2)}% {Math.abs(total - 100) < .001 ? "— valid" : "— must equal 100%"}</p>
      <div className="people-list">{heirs.map((heir, heirIndex) => { const result = inheritanceDuty(property, heir, succession); const heirFraction = fractionForShare(heir); const possibleParents = heirs.slice(0, heirIndex).filter((person) => heir.relationship === "Descendant" ? ["Child", "Descendant"].includes(person.relationship) : heir.relationship === "Sibling descendant" ? ["Sibling", "Sibling descendant"].includes(person.relationship) : false); return <article className="person-card" key={heir.id}>
        <div className="person-card-heading"><strong>{heir.name || "Unnamed heir"}</strong><button type="button" className="icon-button" title="Remove heir" onClick={() => setSuccession({ heirs: heirs.filter((item) => item.id !== heir.id) })}><Trash2 size={16} /></button></div>
        <div className="form-grid"><label>Family-tree person<select value={heir.personId || ""} onChange={(e) => { const person = familyPeople.find((item) => item.id === e.target.value); updateHeir(heir.id, { personId: e.target.value, name: person?.fullName || heir.name }); }}><option value="">Not linked</option>{familyPeople.filter((person) => person.id === heir.personId || !heirs.some((item) => item.id !== heir.id && item.personId === person.id)).map((person) => <option key={person.id} value={person.id}>{person.fullName || "Unnamed person"}</option>)}</select></label><label>Name<input value={heir.name} onChange={(e) => updateHeir(heir.id, { name: e.target.value })} /></label><label>Relationship<select value={heir.relationship} onChange={(e) => updateHeir(heir.id, { relationship: e.target.value, branchId: "" })}><option>Surviving spouse</option><option>Child</option><option>Descendant</option><option>Parent</option><option>Ascendant</option><option>Sibling</option><option>Sibling descendant</option><option>Other collateral</option></select></label><label>Succession status<select value={heir.status || "undecided"} onChange={(e) => updateHeir(heir.id, { status: e.target.value })}><option value="undecided">Undecided</option><option value="accepted">Accepted</option><option value="inventory">Accepted — benefit of inventory</option><option value="renounced">Renounced</option><option value="predeceased">Predeceased</option><option value="incapable">Incapable / unworthy</option></select></label>
        {["Descendant", "Sibling descendant"].includes(heir.relationship) && <label>Parent in this family line<select value={heir.branchId || ""} onChange={(e) => updateHeir(heir.id, { branchId: e.target.value })}><option value="">No parent selected</option>{possibleParents.map((parent) => <option key={parent.id} value={parent.id}>{parent.name || `Unnamed ${parent.relationship.toLowerCase()}`}</option>)}</select></label>}
        {["Ascendant", "Other collateral"].includes(heir.relationship) && <label>Degree of relationship<input type="number" min="1" max="12" value={heir.degree || ""} onChange={(e) => updateHeir(heir.id, { degree: e.target.value })} /></label>}
        {shareDisplay !== "percentage" && <label className={shareDisplay === "both" ? "" : "full-width"}>Inheritance share (fraction)<span className="fraction-share-input"><input aria-label="Share numerator" type="number" min="0" step="1" value={heirFraction.numerator} onChange={(e) => updateHeirFraction(heir, { shareNumerator: e.target.value })} /><strong>/</strong><input aria-label="Share denominator" type="number" min="1" step="1" value={heirFraction.denominator} onChange={(e) => updateHeirFraction(heir, { shareDenominator: e.target.value })} /></span></label>}
        {shareDisplay !== "fraction" && <label className={shareDisplay === "both" ? "" : "full-width"}>Inheritance share (%)<span className="percentage-share-input"><input type="number" min="0" max="100" step="any" value={heir.sharePercent} onChange={(e) => updateHeirPercentage(heir.id, e.target.value)} /><strong>%</strong></span></label>}
        <label>Duty treatment<select value={heir.exemption} onChange={(e) => updateHeir(heir.id, { exemption: e.target.value })}><option value="none">Standard</option><option value="full">Full exemption (confirmed)</option></select></label><label className="check-label"><input type="checkbox" checked={heir.soleResidence} onChange={(e) => updateHeir(heir.id, { soleResidence: e.target.checked })} /> Qualifying sole residence</label></div>
        <div className="inline-result"><span>Inherited value <strong>{money.format(result.inheritedValue)}</strong></span><span>Estimated duty <strong>{money.format(result.duty)}</strong></span></div>
        {["Child", "Descendant", "Sibling", "Sibling descendant"].includes(heir.relationship) && <button type="button" className="branch-add" onClick={() => addToBranch(heir)}><Plus size={14} /> Add child to this branch</button>}
      </article>; })}</div>
      <button type="button" className="add-button" onClick={() => setSuccession({ heirs: [...heirs, makeHeir()] })}><Plus size={16} /> Add heir</button>
      {allocation?.destination === "government" && <p className="allocation-warning">No eligible relative was found in the supported classes. The succession may devolve on the Government of Malta.</p>}
      <p className="helper-text">For representation, add each generation in order and select the preceding person as the parent in that family line. Distribution continues per stirpes through every recorded generation. A renounced person's descendants do not represent that person in the same succession.</p>
    </section>
    <SuccessionDeclarations heirs={heirs} property={property} declarations={caseData.declarations || []} onChange={(declarations) => onChange({ ...caseData, declarations })} />
    <OwnershipTransfers heirs={heirs} familyPeople={familyPeople} outsideParties={caseData.outsideParties || []} transfers={caseData.transfers || []} onChange={(patch) => onChange({ ...caseData, ...patch })} />
    <section className="editor-panel">
      <header><p className="eyebrow">Later disposal</p><h2>Seller tax lots</h2><p className="helper-text">Use a separate lot for every owner, inheritance date or acquisition route.</p></header>
      <div className="people-list">{saleRows.map(({ lot, result }) => <article className="person-card" key={lot.id}><div className="person-card-heading"><strong>{lot.ownerName || "Tax lot"}</strong><button type="button" className="icon-button" title="Remove tax lot" onClick={() => onChange({ ...caseData, saleLots: lots.filter((item) => item.id !== lot.id) })}><Trash2 size={16} /></button></div><div className="form-grid"><label>Owner<input value={lot.ownerName} onChange={(e) => updateLot(lot.id, { ownerName: e.target.value })} /></label><label>Inheritance date<input type="date" value={lot.inheritanceDate} onChange={(e) => updateLot(lot.id, { inheritanceDate: e.target.value })} /></label><label>Acquisition / causa mortis value (€)<input type="number" min="0" value={lot.acquisitionValue} onChange={(e) => updateLot(lot.id, { acquisitionValue: e.target.value })} /></label><label>Share of sale value (€)<input type="number" min="0" value={lot.transferValue} onChange={(e) => updateLot(lot.id, { transferValue: e.target.value })} /></label><label>Verified brokerage fees (€)<input type="number" min="0" value={lot.brokerageFees} onChange={(e) => updateLot(lot.id, { brokerageFees: e.target.value })} /></label><label className="check-label"><input type="checkbox" checked={lot.qualifiesFivePercent} onChange={(e) => updateLot(lot.id, { qualifiesFivePercent: e.target.checked })} /> Qualifies for 5% method</label><label className="check-label"><input type="checkbox" checked={lot.ownResidenceExempt} onChange={(e) => updateLot(lot.id, { ownResidenceExempt: e.target.checked })} /> Own-residence exemption confirmed</label></div><div className="method-list">{result.methods.map((method) => <div className={method.key === result.recommended ? "method best" : "method"} key={method.key}><span>{method.label}</span><strong>{money.format(method.tax)}</strong>{method.key === result.recommended && <small>Lowest estimate</small>}</div>)}</div></article>)}</div>
      <button type="button" className="add-button" onClick={() => onChange({ ...caseData, saleLots: [...lots, makeLot()] })}><Plus size={16} /> Add tax lot</button>
      <div className="grand-total"><Calculator size={18} /><span>Estimated seller tax total</span><strong>{money.format(saleRows.reduce((sum, row) => sum + row.result.methods.find((method) => method.key === row.result.recommended).tax, 0))}</strong></div>
    </section>
    <aside className="legal-note"><strong>Working estimate only.</strong> The current-law engine covers the supplied spouse, recursively represented descendant, ascendant, sibling-branch and collateral rules. Historical law, usufruct valuation, reserved portions, foreign-law issues and exemptions require a Maltese notary or tax adviser.</aside>
  </div>;
}
