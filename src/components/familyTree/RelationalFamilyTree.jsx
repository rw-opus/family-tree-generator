import { compactNodeWidth, PARTNER_LINK_WIDTH } from "./treePresentation.js";

function buildChildrenByParent(people, peopleById) {
  const childrenByParent = new Map();

  people.forEach((person) => {
    [person.fatherId, person.motherId]
      .filter((parentId) => peopleById.has(parentId))
      .forEach((parentId) => {
        const children = childrenByParent.get(parentId) || [];
        childrenByParent.set(parentId, [...children, person]);
      });
  });

  return childrenByParent;
}

function createUnionNeighbours(people, peopleById, childrenByParent) {
  return (personId) => {
    const neighbours = new Set(peopleById.get(personId)?.spouseIds || []);

    people.forEach((candidate) => {
      if ((candidate.spouseIds || []).includes(personId)) {
        neighbours.add(candidate.id);
      }
    });
    (childrenByParent.get(personId) || []).forEach((child) => {
      [child.fatherId, child.motherId].forEach((parentId) => {
        if (parentId && parentId !== personId && peopleById.has(parentId)) {
          neighbours.add(parentId);
        }
      });
    });

    neighbours.delete(personId);
    return [...neighbours].filter((personId) => peopleById.has(personId));
  };
}

function partnershipComponent(startId, unionNeighbours) {
  const component = new Set();
  const queue = [startId];

  while (queue.length) {
    const personId = queue.shift();
    if (!personId || component.has(personId)) continue;

    component.add(personId);
    unionNeighbours(personId).forEach((partnerId) => {
      if (!component.has(partnerId)) queue.push(partnerId);
    });
  }

  return [...component];
}

function pairKey(personIds) {
  return [...personIds].sort().join("::");
}

function groupChildrenByUnion(people, householdIds) {
  const householdIdSet = new Set(householdIds);
  const childGroups = new Map();

  people.forEach((child) => {
    if (householdIdSet.has(child.id)) return;

    const parentIds = [child.fatherId, child.motherId].filter((parentId) =>
      householdIdSet.has(parentId),
    );
    if (!parentIds.length) return;

    const key = pairKey(parentIds);
    const group = childGroups.get(key) || {
      parentIds: [...new Set(parentIds)],
      children: [],
    };
    group.children.push(child);
    childGroups.set(key, group);
  });

  return childGroups;
}

function includeChildlessUnions(childGroups, householdIds, unionNeighbours) {
  const unionGroups = new Map(childGroups);
  const householdIdSet = new Set(householdIds);

  householdIds.forEach((personId) => {
    unionNeighbours(personId).forEach((partnerId) => {
      if (!householdIdSet.has(partnerId)) return;

      const parentIds = [personId, partnerId].sort();
      const key = pairKey(parentIds);
      if (!unionGroups.has(key)) {
        unionGroups.set(key, { parentIds, children: [] });
      }
    });
  });

  if (!unionGroups.size) {
    unionGroups.set(householdIds[0], {
      parentIds: [householdIds[0]],
      children: [],
    });
  }

  return unionGroups;
}

function findRoots(people, peopleById, unionNeighbours, displayName) {
  return people
    .filter(
      (person) =>
        ![person.fatherId, person.motherId].some((parentId) => peopleById.has(parentId)) &&
        !unionNeighbours(person.id).some((partnerId) => {
          const partner = peopleById.get(partnerId);
          return [partner?.fatherId, partner?.motherId].some((parentId) =>
            peopleById.has(parentId),
          );
        }),
    )
    .sort((first, second) => displayName(first).localeCompare(displayName(second)));
}

export function RelationalFamilyTree({ people, displayName, cardName, renderCard }) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const childrenByParent = buildChildrenByParent(people, peopleById);
  const unionNeighbours = createUnionNeighbours(people, peopleById, childrenByParent);
  const rendered = new Set();

  const renderHousehold = (startId, trail = new Set()) => {
    if (!peopleById.has(startId) || rendered.has(startId) || trail.has(startId)) {
      return null;
    }

    const householdIds = partnershipComponent(startId, unionNeighbours);
    householdIds.forEach((personId) => rendered.add(personId));

    const childGroups = groupChildrenByUnion(people, householdIds);
    const unionGroups = includeChildlessUnions(childGroups, householdIds, unionNeighbours);
    const nextTrail = new Set([...trail, ...householdIds]);

    return (
      <div className="family-household" key={`household-${startId}`}>
        <div className={`family-household-unions ${unionGroups.size > 1 ? "multiple" : ""}`}>
          {[...unionGroups.entries()].map(([key, group]) => {
            const parents = group.parentIds
              .map((personId) => peopleById.get(personId))
              .filter(Boolean)
              .sort((first, second) => {
                if (first.id === startId) return -1;
                if (second.id === startId) return 1;
                return displayName(first).localeCompare(displayName(second));
              });
            const children = [...group.children].sort((first, second) =>
              displayName(first).localeCompare(displayName(second)),
            );

            return (
              <div className="family-union-block" key={key}>
                <div
                  className={[
                    "family-parent-row",
                    parents.length === 1 && "single-parent",
                    children.length && "has-children",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {parents.map((person, index) => (
                    <span className="family-parent-node" key={`${key}-${person.id}`}>
                      {index > 0 && <span className="family-partner-link" aria-hidden="true" />}
                      {renderCard(person)}
                    </span>
                  ))}
                </div>
                {children.length > 0 && (
                  <>
                    <span className="family-union-stem" aria-hidden="true" />
                    <div
                      className={`family-children-branch ${children.length === 1 ? "single" : ""}`}
                    >
                      {children.map((child) => {
                        const childHousehold = renderHousehold(child.id, nextTrail);
                        const partnerIds = unionNeighbours(child.id);
                        const partner = peopleById.get(partnerIds[0]);
                        const partnerWidth = partner ? compactNodeWidth(cardName(partner)) : 0;
                        const branchAnchorOffset =
                          childHousehold && partnerIds.length === 1
                            ? -(PARTNER_LINK_WIDTH + partnerWidth) / 2
                            : 0;

                        return (
                          <div
                            className="family-child-branch-item"
                            key={child.id}
                            style={{
                              "--branch-anchor-offset": `${branchAnchorOffset}px`,
                            }}
                          >
                            <span className="family-child-stem" aria-hidden="true" />
                            {childHousehold || renderCard(child)}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const roots = findRoots(people, peopleById, unionNeighbours, displayName);
  const forest = [];

  [...roots, ...people].forEach((person) => {
    const household = renderHousehold(person.id);
    if (household) forest.push(household);
  });

  return <div className="relational-forest">{forest}</div>;
}
