import { Building2, FolderTree, Plus, ReceiptText } from "lucide-react";

export const ownerViewKey = "owners";
export const vendorTaxViewKey = "vendor-tax";
export const familyViewKey = (groupId) => `family:${groupId}`;

export function CaseViewTabs({ familyGroups, activeView, onSelectView, onAddFamilyTree }) {
  return (
    <nav className="case-view-tabs" aria-label="Property case views">
      <div className="family-view-tabs">
        {familyGroups.map((group) => {
          const viewKey = familyViewKey(group.id);
          return (
            <button
              type="button"
              className={activeView === viewKey ? "active" : ""}
              aria-pressed={activeView === viewKey}
              key={group.id}
              onClick={() => onSelectView(viewKey)}
            >
              <FolderTree size={15} />
              {group.title || "Family tree"}
            </button>
          );
        })}
        <button type="button" className="add-family-view" onClick={onAddFamilyTree}>
          <Plus size={15} /> Family tree
        </button>
      </div>
      <div className="property-view-tabs">
        <button
          type="button"
          className={activeView === ownerViewKey ? "active" : ""}
          aria-pressed={activeView === ownerViewKey}
          onClick={() => onSelectView(ownerViewKey)}
        >
          <Building2 size={15} /> Owners & transfers
        </button>
        <button
          type="button"
          className={activeView === vendorTaxViewKey ? "active" : ""}
          aria-pressed={activeView === vendorTaxViewKey}
          onClick={() => onSelectView(vendorTaxViewKey)}
        >
          <ReceiptText size={15} /> Tax Calculation
        </button>
      </div>
    </nav>
  );
}
