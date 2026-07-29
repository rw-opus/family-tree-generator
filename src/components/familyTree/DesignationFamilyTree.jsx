function placeholder(id, fullName, designation) {
  return {
    id,
    fullName,
    designations: [designation],
    isPlaceholder: true,
  };
}

function BranchRow({ members, renderCard }) {
  if (!members.length) return null;

  return (
    <div className={`family-branch-row ${members.length === 1 ? "single" : ""}`}>
      {members.map((person) => (
        <div className="family-branch-item" key={person.id}>
          {renderCard(person)}
        </div>
      ))}
    </div>
  );
}

function Generation({ label, members, renderCard }) {
  if (!members.length) return null;

  return (
    <>
      <div className="family-down-line" />
      <div className="family-generation-label">{label}</div>
      <BranchRow members={members} renderCard={renderCard} />
    </>
  );
}

function SideBranch({ top, lower, topLabel, lowerLabel, renderCard }) {
  if (!top.length && !lower.length) return null;

  return (
    <div className="family-side-branch">
      <div className="family-generation-label">{topLabel}</div>
      <div className="family-row">{top.map(renderCard)}</div>
      {lower.length > 0 && (
        <>
          <div className="family-down-line" />
          <div className="family-generation-label">{lowerLabel}</div>
          <BranchRow members={lower} renderCard={renderCard} />
        </>
      )}
    </div>
  );
}

function AncestorGeneration({ label, members, renderCard }) {
  if (!members.length) return null;

  return (
    <>
      <div className="family-generation-label">{label}</div>
      <BranchRow members={members} renderCard={renderCard} />
      <div className="family-down-line" />
    </>
  );
}

export function DesignationFamilyTree({
  deceased,
  focalPerson,
  spouses,
  children,
  grandchildren,
  greatGrandchildren,
  parents,
  grandparents,
  siblings,
  nephews,
  uncles,
  cousins,
  renderCard,
}) {
  const siblingConnectors = siblings.length
    ? siblings
    : nephews.length
      ? [placeholder("nephew-parent", "Brother/Sister", "Parent of nephew/niece")]
      : [];
  const cousinConnectors = uncles.length
    ? uncles
    : cousins.length
      ? [placeholder("cousin-parent", "Uncle/Aunt", "Parent of cousin")]
      : [];
  const childGeneration = children.length
    ? children
    : grandchildren.length || greatGrandchildren.length
      ? [placeholder("child-line", "Child", "Child")]
      : [];
  const grandchildGeneration = grandchildren.length
    ? grandchildren
    : greatGrandchildren.length
      ? [placeholder("grandchild-line", "Grandchild", "Grandchild")]
      : [];
  const hasRelations = [
    spouses,
    children,
    grandchildren,
    greatGrandchildren,
    parents,
    grandparents,
    siblings,
    nephews,
    uncles,
    cousins,
  ].some((group) => group.length);

  return (
    <>
      <AncestorGeneration label="Grandparents" members={grandparents} renderCard={renderCard} />
      <AncestorGeneration label="Parents" members={parents} renderCard={renderCard} />
      <div className="family-main-stage">
        <div className="family-side-slot left">
          {(siblingConnectors.length > 0 || nephews.length > 0) && (
            <>
              <div className="family-side-stack">
                <SideBranch
                  top={siblingConnectors}
                  lower={nephews}
                  topLabel={nephews.length ? "Brother / Sister Line" : "Siblings"}
                  lowerLabel="Nephews / Nieces"
                  renderCard={renderCard}
                />
              </div>
              <span className="family-side-line" />
            </>
          )}
        </div>
        <div className="family-union">
          {focalPerson ? (
            renderCard(focalPerson, deceased ? "deceased" : "")
          ) : (
            <div className="family-empty">Add a person to start the tree.</div>
          )}
          {spouses
            .filter((person) => person.id !== focalPerson?.id)
            .map((person) => (
              <span className="family-spouse" key={person.id}>
                <span className="family-spouse-line" />
                {renderCard(person)}
              </span>
            ))}
        </div>
        <div className="family-side-slot right">
          {(cousinConnectors.length > 0 || cousins.length > 0) && (
            <>
              <span className="family-side-line" />
              <div className="family-side-stack">
                <SideBranch
                  top={cousinConnectors}
                  lower={cousins}
                  topLabel={cousins.length ? "Uncle / Aunt Line" : "Uncles / Aunts"}
                  lowerLabel="Cousins"
                  renderCard={renderCard}
                />
              </div>
            </>
          )}
        </div>
      </div>
      <Generation label="Children" members={childGeneration} renderCard={renderCard} />
      <Generation label="Grandchildren" members={grandchildGeneration} renderCard={renderCard} />
      <Generation
        label="Great-Grandchildren"
        members={greatGrandchildren}
        renderCard={renderCard}
      />
      {!hasRelations && (
        <div className="family-empty">
          Add relationship designations to show people in the tree.
        </div>
      )}
    </>
  );
}
