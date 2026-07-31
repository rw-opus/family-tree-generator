import { CrossBranchUnionLayer } from "./CrossBranchUnionLayer.jsx";
import { MultiplePartnerHousehold } from "./MultiplePartnerHousehold.jsx";
import { ParentlessSiblingCluster } from "./ParentlessSiblingCluster.jsx";
import { PartnerNetworkHousehold } from "./PartnerNetworkHousehold.jsx";
import {
  partnerRelationship,
  partnerRelationshipAnnotation,
  partnerRelationshipClass,
} from "./partnerRelationship.js";
import { compactNodeWidth, PARTNER_LINK_WIDTH } from "./treePresentation.js";
import "./PartnerRelationship.css";

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

function buildUnionNeighbours(people, peopleById, childrenByParent) {
  const neighboursById = new Map(people.map((person) => [person.id, new Set()]));

  people.forEach((person) => {
    (person.spouseIds || [])
      .filter((partnerId) => partnerId !== person.id && peopleById.has(partnerId))
      .forEach((partnerId) => {
        neighboursById.get(person.id).add(partnerId);
        neighboursById.get(partnerId).add(person.id);
      });
  });

  people.forEach((person) => {
    (childrenByParent.get(person.id) || []).forEach((child) => {
      [child.fatherId, child.motherId].forEach((parentId) => {
        if (parentId && parentId !== person.id && peopleById.has(parentId)) {
          neighboursById.get(person.id).add(parentId);
        }
      });
    });
  });

  return new Map([...neighboursById].map(([personId, neighbours]) => [personId, [...neighbours]]));
}

function partnershipComponent(startId, unionNeighboursById) {
  const component = new Set();
  const queue = [startId];

  while (queue.length) {
    const personId = queue.shift();
    if (!personId || component.has(personId)) continue;

    component.add(personId);
    (unionNeighboursById.get(personId) || []).forEach((partnerId) => {
      if (!component.has(partnerId)) queue.push(partnerId);
    });
  }

  return [...component];
}

function pairKey(personIds) {
  return [...personIds].sort().join("::");
}

function unionRelationship(firstPerson, secondPerson) {
  const hasSpouseLink =
    (firstPerson?.spouseIds || []).includes(secondPerson?.id) ||
    (secondPerson?.spouseIds || []).includes(firstPerson?.id);

  return partnerRelationship(firstPerson, secondPerson, hasSpouseLink ? "marriage" : "partnership");
}

function validParentIds(person, peopleById) {
  return [...new Set([person?.fatherId, person?.motherId])].filter((parentId) =>
    peopleById.has(parentId),
  );
}

function parentlessSiblingGroups(people, peopleById, displayNamesById) {
  const neighboursById = new Map(people.map((person) => [person.id, new Set()]));

  people.forEach((person) => {
    (person.siblingIds || [])
      .filter((siblingId) => siblingId !== person.id && peopleById.has(siblingId))
      .forEach((siblingId) => {
        neighboursById.get(person.id).add(siblingId);
        neighboursById.get(siblingId).add(person.id);
      });
  });

  const visited = new Set();
  const groups = [];

  people.forEach((person) => {
    if (visited.has(person.id) || !neighboursById.get(person.id)?.size) return;

    const componentIds = [];
    const queue = [person.id];
    while (queue.length) {
      const personId = queue.shift();
      if (!personId || visited.has(personId)) continue;

      visited.add(personId);
      componentIds.push(personId);
      neighboursById.get(personId)?.forEach((siblingId) => {
        if (!visited.has(siblingId)) queue.push(siblingId);
      });
    }

    const siblings = componentIds.map((personId) => peopleById.get(personId)).filter(Boolean);
    if (
      siblings.length < 2 ||
      siblings.some((sibling) => validParentIds(sibling, peopleById).length > 0)
    ) {
      return;
    }

    groups.push(
      siblings.sort((first, second) =>
        (displayNamesById.get(first.id) || "").localeCompare(displayNamesById.get(second.id) || ""),
      ),
    );
  });

  return groups.sort((first, second) =>
    (displayNamesById.get(first[0]?.id) || "").localeCompare(
      displayNamesById.get(second[0]?.id) || "",
    ),
  );
}

function buildUnionPairs(people, peopleById) {
  const pairs = new Map();
  const ensurePair = (personIds) => {
    const parentIds = [...new Set(personIds)].filter((personId) => peopleById.has(personId)).sort();
    if (parentIds.length !== 2) return null;

    const key = pairKey(parentIds);
    if (!pairs.has(key)) {
      pairs.set(key, {
        key,
        parentIds,
        children: [],
        relationship: unionRelationship(peopleById.get(parentIds[0]), peopleById.get(parentIds[1])),
      });
    }
    return pairs.get(key);
  };

  people.forEach((person) => {
    (person.spouseIds || []).forEach((partnerId) => ensurePair([person.id, partnerId]));

    const parents = validParentIds(person, peopleById);
    const pair = ensurePair(parents);
    if (pair && !pair.children.some((child) => child.id === person.id)) {
      pair.children.push(person);
    }
  });

  return pairs;
}

function crossBranchUnionGroups(unionPairs, peopleById) {
  return [...unionPairs.values()].filter(({ parentIds }) =>
    parentIds.every((personId) => validParentIds(peopleById.get(personId), peopleById).length > 0),
  );
}

function groupChildrenByUnion(people, householdIds, peopleById, excludedUnionKeys) {
  const householdIdSet = new Set(householdIds);
  const childGroups = new Map();

  people.forEach((child) => {
    if (householdIdSet.has(child.id)) return;

    const knownParentIds = validParentIds(child, peopleById);
    if (knownParentIds.length === 2 && excludedUnionKeys.has(pairKey(knownParentIds))) {
      return;
    }

    const parentIds = [child.fatherId, child.motherId].filter((parentId) =>
      householdIdSet.has(parentId),
    );
    if (!parentIds.length) return;

    const key = pairKey(parentIds);
    const group = childGroups.get(key) || {
      parentIds: [...new Set(parentIds)],
      children: [],
      relationship:
        parentIds.length === 2
          ? unionRelationship(peopleById.get(parentIds[0]), peopleById.get(parentIds[1]))
          : null,
    };
    group.children.push(child);
    childGroups.set(key, group);
  });

  return childGroups;
}

function includeChildlessUnions(childGroups, householdIds, unionNeighboursById, peopleById) {
  const unionGroups = new Map(childGroups);
  const householdIdSet = new Set(householdIds);

  householdIds.forEach((personId) => {
    (unionNeighboursById.get(personId) || []).forEach((partnerId) => {
      if (!householdIdSet.has(partnerId)) return;

      const parentIds = [personId, partnerId].sort();
      const key = pairKey(parentIds);
      if (!unionGroups.has(key)) {
        unionGroups.set(key, {
          parentIds,
          children: [],
          relationship: unionRelationship(
            peopleById.get(parentIds[0]),
            peopleById.get(parentIds[1]),
          ),
        });
      }
    });
  });

  if (!unionGroups.size) {
    unionGroups.set(householdIds[0], {
      parentIds: [householdIds[0]],
      children: [],
      relationship: null,
    });
  }

  return unionGroups;
}

function findRoots(people, peopleById, unionNeighboursById, displayNamesById) {
  return people
    .filter(
      (person) =>
        ![person.fatherId, person.motherId].some((parentId) => peopleById.has(parentId)) &&
        !(unionNeighboursById.get(person.id) || []).some((partnerId) => {
          const partner = peopleById.get(partnerId);
          return [partner?.fatherId, partner?.motherId].some((parentId) =>
            peopleById.has(parentId),
          );
        }),
    )
    .sort((first, second) =>
      (displayNamesById.get(first.id) || "").localeCompare(displayNamesById.get(second.id) || ""),
    );
}

export function RelationalFamilyTree({ people, displayName, cardName, renderCard }) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const displayNamesById = new Map(people.map((person) => [person.id, displayName(person)]));
  const cachedDisplayName = (person) => displayNamesById.get(person?.id) || "";
  const childrenByParent = buildChildrenByParent(people, peopleById);
  const unionPairs = buildUnionPairs(people, peopleById);
  const crossUnions = crossBranchUnionGroups(unionPairs, peopleById).map((union) => ({
    ...union,
    children: [...union.children].sort((first, second) =>
      cachedDisplayName(first).localeCompare(cachedDisplayName(second)),
    ),
  }));
  const crossUnionKeys = new Set(crossUnions.map((union) => union.key));
  const allUnionNeighbours = buildUnionNeighbours(people, peopleById, childrenByParent);
  const unionNeighboursById = new Map(
    [...allUnionNeighbours].map(([personId, partnerIds]) => [
      personId,
      partnerIds.filter((partnerId) => !crossUnionKeys.has(pairKey([personId, partnerId]))),
    ]),
  );
  const siblingGroups = parentlessSiblingGroups(people, peopleById, displayNamesById);
  const rendered = new Set();
  const householdBranchAnchorOffset = (person) => {
    const partnerIds = unionNeighboursById.get(person.id) || [];
    const partner = peopleById.get(partnerIds[0]);
    const partnerWidth = partner ? compactNodeWidth(cardName(partner)) : 0;

    return partnerIds.length === 1 ? -(PARTNER_LINK_WIDTH + partnerWidth) / 2 : 0;
  };

  let renderHousehold;
  const renderChildren = (children, trail = new Set()) => {
    if (!children.length) return null;

    const childBranches = children
      .map((child) => {
        const childHousehold = renderHousehold(child.id, trail);
        if (!childHousehold) return null;

        return (
          <div
            className="family-child-branch-item"
            key={child.id}
            style={{
              "--branch-anchor-offset": `${householdBranchAnchorOffset(child)}px`,
            }}
          >
            <span className="family-child-stem" aria-hidden="true" />
            {childHousehold}
          </div>
        );
      })
      .filter(Boolean);

    if (!childBranches.length) return null;

    return (
      <>
        <span className="family-union-stem" aria-hidden="true" />
        <div className={`family-children-branch ${childBranches.length === 1 ? "single" : ""}`}>
          {childBranches}
        </div>
      </>
    );
  };

  renderHousehold = (startId, trail = new Set()) => {
    if (!peopleById.has(startId) || rendered.has(startId) || trail.has(startId)) {
      return null;
    }

    const householdIds = partnershipComponent(startId, unionNeighboursById);
    const householdIdSet = new Set(householdIds);
    householdIds.forEach((personId) => rendered.add(personId));

    const childGroups = groupChildrenByUnion(people, householdIds, peopleById, crossUnionKeys);
    const unionGroups = includeChildlessUnions(
      childGroups,
      householdIds,
      unionNeighboursById,
      peopleById,
    );
    const nextTrail = new Set([...trail, ...householdIds]);
    const anchorId = householdIds.reduce((currentAnchorId, personId) => {
      const currentPartners = (unionNeighboursById.get(currentAnchorId) || []).filter((partnerId) =>
        householdIdSet.has(partnerId),
      ).length;
      const candidatePartners = (unionNeighboursById.get(personId) || []).filter((partnerId) =>
        householdIdSet.has(partnerId),
      ).length;

      return candidatePartners > currentPartners ? personId : currentAnchorId;
    }, startId);
    const anchor = peopleById.get(anchorId);
    const anchoredGroups = [...unionGroups.entries()].map(([key, group]) => {
      const partnerId =
        group.parentIds.length === 2 && group.parentIds.includes(anchorId)
          ? group.parentIds.find((personId) => personId !== anchorId)
          : null;
      const partner = peopleById.get(partnerId);

      return {
        ...group,
        key,
        partner,
        partnerName: partner ? cachedDisplayName(partner) : "",
        children: [...group.children].sort((first, second) =>
          cachedDisplayName(first).localeCompare(cachedDisplayName(second)),
        ),
      };
    });
    const hasAnchoredMultiplePartners =
      anchoredGroups.length > 1 &&
      anchor &&
      anchoredGroups.every((group) => group.partner) &&
      new Set(anchoredGroups.map((group) => group.partner.id)).size === anchoredGroups.length;
    const groupedParentIds = anchoredGroups.flatMap((group) => group.parentIds);
    const hasNonStarPartnerNetwork =
      !hasAnchoredMultiplePartners &&
      householdIds.length > 1 &&
      new Set(groupedParentIds).size < groupedParentIds.length;
    const branchAnchor = peopleById.get(startId) || anchor;
    const componentGroups =
      hasAnchoredMultiplePartners || hasNonStarPartnerNetwork
        ? anchoredGroups.map((group) => ({
            ...group,
            childrenContent: renderChildren(group.children, nextTrail),
          }))
        : anchoredGroups;

    return (
      <div className="family-household" key={`household-${startId}`}>
        <div
          className={`family-household-unions ${unionGroups.size > 1 ? "multiple" : ""} ${
            hasAnchoredMultiplePartners ? "anchored-multiple" : ""
          }`}
        >
          {hasAnchoredMultiplePartners ? (
            <MultiplePartnerHousehold
              anchor={anchor}
              branchAnchor={branchAnchor}
              groups={componentGroups}
              renderCard={renderCard}
            />
          ) : hasNonStarPartnerNetwork ? (
            <PartnerNetworkHousehold
              anchor={branchAnchor}
              people={householdIds.map((personId) => peopleById.get(personId)).filter(Boolean)}
              groups={componentGroups}
              renderCard={renderCard}
            />
          ) : (
            [...unionGroups.entries()].map(([key, group]) => {
              const parents = group.parentIds
                .map((personId) => peopleById.get(personId))
                .filter(Boolean)
                .sort((first, second) => {
                  if (first.id === startId) return -1;
                  if (second.id === startId) return 1;
                  return cachedDisplayName(first).localeCompare(cachedDisplayName(second));
                });
              const children = [...group.children].sort((first, second) =>
                cachedDisplayName(first).localeCompare(cachedDisplayName(second)),
              );
              const relationshipAnnotation = partnerRelationshipAnnotation(group.relationship);
              const relationshipLabel =
                group.relationship?.type === "partnership" ? "Unmarried partnership" : "Marriage";

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
                        {index > 0 && (
                          <span
                            aria-label={`${relationshipLabel}${
                              relationshipAnnotation ? `, ${relationshipAnnotation}` : ""
                            }`}
                            className={`family-partner-link ${partnerRelationshipClass(
                              group.relationship,
                            )}`}
                            role="img"
                          >
                            {relationshipAnnotation && (
                              <span className="family-union-annotation">
                                {relationshipAnnotation}
                              </span>
                            )}
                          </span>
                        )}
                        {renderCard(person)}
                      </span>
                    ))}
                  </div>
                  {renderChildren(children, nextTrail)}
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const roots = findRoots(people, peopleById, unionNeighboursById, displayNamesById);
  const forest = [];

  siblingGroups.forEach((siblings) => {
    const clusterKey = siblings
      .map((sibling) => sibling.id)
      .sort()
      .join("::");
    const branches = siblings
      .map((sibling) => {
        const content = renderHousehold(sibling.id);
        if (!content) return null;

        return {
          personId: sibling.id,
          content,
          branchAnchorOffset: householdBranchAnchorOffset(sibling),
        };
      })
      .filter(Boolean);

    if (branches.length > 1) {
      forest.push(
        <ParentlessSiblingCluster
          branches={branches}
          clusterKey={clusterKey}
          key={`siblings-${clusterKey}`}
        />,
      );
    } else {
      branches.forEach(({ content }) => forest.push(content));
    }
  });

  roots.forEach((person) => {
    const household = renderHousehold(person.id);
    if (household) forest.push(household);
  });

  const crossUnionDescendants = crossUnions
    .map((union) => {
      const children = union.children.filter((child) => !rendered.has(child.id));
      if (!children.length) return null;

      return (
        <div
          className="family-cross-union-descendants"
          data-cross-union-key={union.key}
          key={union.key}
        >
          {renderChildren(children, new Set(union.parentIds))}
        </div>
      );
    })
    .filter(Boolean);

  people.forEach((person) => {
    const household = renderHousehold(person.id);
    if (household) forest.push(household);
  });

  return (
    <CrossBranchUnionLayer unions={crossUnions}>
      <div className="relational-forest">{forest}</div>
      {crossUnionDescendants.length > 0 && (
        <div className="family-cross-union-descendants-row">{crossUnionDescendants}</div>
      )}
    </CrossBranchUnionLayer>
  );
}
