/**
 * Layered genealogical layout.
 *
 * Family data is not a tree — a person can be a child in one branch and a
 * partner in another — so a focus-based renderer cannot place everybody on a
 * consistent row. This module lays the whole graph out at once:
 *
 *   1. every person is assigned an absolute generation, so one generation is
 *      exactly one row;
 *   2. couples become explicit union nodes, which is what makes a marriage
 *      identifiable and gives descent edges a single origin;
 *   3. rows are reordered by repeated median sweeps to cut edge crossings;
 *   4. x-coordinates are packed tight, then centred so that a union sits over
 *      the middle of its children and children sit under their union.
 *
 * The result is pure geometry. Rendering, card content and interaction stay in
 * the component layer.
 */

export const CARD_WIDTH = 112;
export const CARD_HEIGHT = 108;
export const CARD_GAP = 14;
export const PARTNER_GAP = 10;
export const ROW_GAP = 64;
export const CANVAS_PADDING = 40;

const ORDERING_PASSES = 6;
const RELAX_ROUNDS = 3;

// Each successive marriage of the same person drops its sibling bar a little
// lower, so the children of each are read off their own bar.
const UNION_BAR_OFFSET = 16;
const UNION_BAR_STEP = 10;
const UNION_BAR_MIN_CLEARANCE = 8;
const UNION_BAR_SEPARATION = 12;
const MAX_UNION_BAR_LANE = 2;
const OUTER_MARRIAGE_ROUTE_OFFSET = 10;
const OUTER_MARRIAGE_ROUTE_STEP = 6;
const COMPONENT_GAP = CARD_WIDTH;

const text = (value) => String(value ?? "").trim();

const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const measuredCardHeight = (nodeHeights, personId) => {
  const value = nodeHeights instanceof Map ? nodeHeights.get(personId) : nodeHeights?.[personId];
  const height = Number(value);
  return Number.isFinite(height) ? Math.max(CARD_HEIGHT, Math.ceil(height)) : CARD_HEIGHT;
};

function unionFind(ids) {
  const parent = new Map(ids.map((id) => [id, id]));

  const find = (id) => {
    let current = id;
    while (parent.get(current) !== current) {
      parent.set(current, parent.get(parent.get(current)));
      current = parent.get(current);
    }
    return current;
  };

  const union = (firstId, secondId) => {
    const firstRoot = find(firstId);
    const secondRoot = find(secondId);
    if (firstRoot && secondRoot && firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
  };

  return { find, union };
}

/**
 * Absolute generation for every person. Spouses and siblings are collapsed into
 * one component first so that a couple always shares a row, then the component
 * graph is layered by longest path — a child sits exactly one row below its
 * deepest parent.
 */
export function assignGenerations(people) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const ids = [...peopleById.keys()];
  const { find, union } = unionFind(ids);

  peopleById.forEach((person) => {
    (person.spouseIds || [])
      .filter((partnerId) => peopleById.has(partnerId))
      .forEach((partnerId) => union(person.id, partnerId));
    (person.siblingIds || [])
      .filter((siblingId) => peopleById.has(siblingId))
      .forEach((siblingId) => union(person.id, siblingId));

    const parentIds = [...new Set([person.fatherId, person.motherId])].filter((parentId) =>
      peopleById.has(parentId),
    );
    if (parentIds.length === 2) union(parentIds[0], parentIds[1]);
  });

  const components = new Set(ids.map(find));
  const childComponents = new Map([...components].map((id) => [id, new Set()]));
  const indegree = new Map([...components].map((id) => [id, 0]));

  peopleById.forEach((person) => {
    const childComponent = find(person.id);
    [...new Set([person.fatherId, person.motherId])]
      .filter((parentId) => peopleById.has(parentId))
      .forEach((parentId) => {
        const parentComponent = find(parentId);
        if (!parentComponent || parentComponent === childComponent) return;
        const edges = childComponents.get(parentComponent);
        if (edges.has(childComponent)) return;
        edges.add(childComponent);
        indegree.set(childComponent, indegree.get(childComponent) + 1);
      });
  });

  const depth = new Map([...components].map((id) => [id, 0]));
  const queue = [...components].filter((id) => indegree.get(id) === 0);
  const seen = new Set();

  while (queue.length) {
    const componentId = queue.shift();
    if (seen.has(componentId)) continue;
    seen.add(componentId);

    childComponents.get(componentId).forEach((childId) => {
      depth.set(childId, Math.max(depth.get(childId), depth.get(componentId) + 1));
      indegree.set(childId, indegree.get(childId) - 1);
      if (indegree.get(childId) === 0) queue.push(childId);
    });
  }

  // Any component left with a non-zero indegree sits on a cycle in the parent
  // data. Layering it by its own depth keeps the render stable rather than
  // dropping the people involved.
  return new Map(ids.map((id) => [id, depth.get(find(id)) || 0]));
}

function partnerType(person, partner) {
  const entry = (person?.partnerRelationships || []).find(
    (relationship) => text(relationship?.personId || relationship?.partnerId) === text(partner?.id),
  );
  const mirrored = (partner?.partnerRelationships || []).find(
    (relationship) => text(relationship?.personId || relationship?.partnerId) === text(person?.id),
  );
  const value = text(entry?.type || mirrored?.type).toLowerCase();
  if (value === "partnership" || value === "cohabitation") return "partnership";
  if (value === "marriage") return "marriage";
  return "";
}

/**
 * A union is a couple, or a lone parent, considered as the origin of a set of
 * children. Childless couples still produce a union so the marriage is drawn.
 */
export function buildUnions(people) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const unionsByKey = new Map();

  const unionFor = (parentIds) => {
    const key = [...parentIds].sort().join("+");
    if (!unionsByKey.has(key)) {
      unionsByKey.set(key, { id: `union:${key}`, parentIds: [...parentIds], childIds: [] });
    }
    return unionsByKey.get(key);
  };

  people.forEach((child) => {
    const recordedParentIds = [...new Set([child.fatherId, child.motherId])].filter((parentId) =>
      peopleById.has(parentId),
    );
    const parentIds = [...recordedParentIds];

    // GEDCOM files often record a child against one parent even though that
    // parent has exactly one recorded spouse. The editor exposes this as a
    // parent-link confirmation; the chart can safely use the same unambiguous
    // proposal without mutating the imported record. This is what attaches
    // Margherita's children to the middle of her marriage with Joseph.
    if (parentIds.length === 1) {
      const recordedParent = peopleById.get(parentIds[0]);
      const possibleSpouses = [...new Set(recordedParent?.spouseIds || [])].filter((spouseId) =>
        peopleById.has(spouseId),
      );
      if (possibleSpouses.length === 1) parentIds.push(possibleSpouses[0]);
    }

    if (!parentIds.length) return;
    unionFor(parentIds).childIds.push(child.id);
  });

  people.forEach((person) => {
    (person.spouseIds || [])
      .filter((partnerId) => peopleById.has(partnerId))
      .forEach((partnerId) => unionFor([person.id, partnerId]));
  });

  return [...unionsByKey.values()].map((union) => {
    const [first, second] = union.parentIds.map((id) => peopleById.get(id));
    const declared = second ? partnerType(first, second) : "";

    // A couple is taken to be married unless the relationships record says
    // otherwise. Most unions in a succession file are marriages, and treating
    // an unrecorded one as a partnership puts an unfounded statement about the
    // parents on the chart.
    const type = !second ? "single" : declared || "marriage";

    // Only a recorded couple who are not married says anything about how the
    // children were born. One unrecorded parent is a gap in the record, not a
    // statement about the parents, and must never be drawn as one.
    return { ...union, type, marital: type === "marriage", flagged: type === "partnership" };
  });
}

function orderWithinBlock(memberIds, partnersById) {
  if (memberIds.length < 3) return memberIds;

  const remaining = new Set(memberIds);
  const degree = (id) =>
    (partnersById.get(id) || []).filter((other) => remaining.has(other)).length;
  const start = memberIds.find((id) => degree(id) <= 1) || memberIds[0];
  const ordered = [];
  let current = start;

  while (current && remaining.has(current)) {
    ordered.push(current);
    remaining.delete(current);
    current = (partnersById.get(current) || []).find((other) => remaining.has(other));
  }

  return [...ordered, ...memberIds.filter((id) => remaining.has(id))];
}

/**
 * Groups each row into blocks of people who must stay side by side (a couple,
 * or a remarriage chain). Ordering operates on blocks so partners can never be
 * separated by the crossing-reduction sweeps.
 */
function buildRowBlocks(rowIds, unions) {
  const inRow = new Set(rowIds);
  const partnersById = new Map(rowIds.map((id) => [id, []]));

  unions.forEach((union) => {
    if (union.parentIds.length !== 2) return;
    const [first, second] = union.parentIds;
    if (!inRow.has(first) || !inRow.has(second)) return;
    partnersById.get(first).push(second);
    partnersById.get(second).push(first);
  });

  const { find, union: join } = unionFind(rowIds);
  partnersById.forEach((partners, id) => partners.forEach((partnerId) => join(id, partnerId)));

  const membersByRoot = new Map();
  rowIds.forEach((id) => {
    const root = find(id);
    membersByRoot.set(root, [...(membersByRoot.get(root) || []), id]);
  });

  return [...membersByRoot.values()].map((memberIds) => ({
    memberIds: orderWithinBlock(memberIds, partnersById),
  }));
}

function blockWidth(block) {
  return (
    block.memberIds.length * CARD_WIDTH + Math.max(0, block.memberIds.length - 1) * PARTNER_GAP
  );
}

function seedOrder(people, generations, maxGeneration) {
  const rows = Array.from({ length: maxGeneration + 1 }, () => []);
  const placed = new Set();
  const childrenByParent = new Map(people.map((person) => [person.id, []]));

  people.forEach((child) => {
    [...new Set([child.fatherId, child.motherId])]
      .filter((parentId) => childrenByParent.has(parentId))
      .forEach((parentId) => childrenByParent.get(parentId).push(child.id));
  });

  const visit = (personId) => {
    if (placed.has(personId)) return;
    placed.add(personId);
    rows[generations.get(personId)].push(personId);
    (childrenByParent.get(personId) || []).forEach(visit);
  };

  // Depth-first from the earliest generation keeps whole branches together,
  // which is a far better starting order for the sweeps than input order.
  [...people]
    .sort(
      (first, second) =>
        generations.get(first.id) - generations.get(second.id) ||
        text(first.fullName).localeCompare(text(second.fullName), "en-MT"),
    )
    .forEach((person) => visit(person.id));

  return rows;
}

function reorderRows(rows, unions, people) {
  const parentsByPerson = new Map(people.map((person) => [person.id, []]));
  const childrenByPerson = new Map(people.map((person) => [person.id, []]));

  unions.forEach((union) => {
    union.childIds.forEach((childId) => {
      union.parentIds.forEach((parentId) => {
        parentsByPerson.get(childId)?.push(parentId);
        childrenByPerson.get(parentId)?.push(childId);
      });
    });
  });

  const indexOf = (rowIndex) => {
    const positions = new Map();
    rows[rowIndex]?.forEach((id, index) => positions.set(id, index));
    return positions;
  };

  const sweep = (rowIndex, neighbourRowIndex, relations) => {
    const neighbourPositions = indexOf(neighbourRowIndex);
    const blocks = buildRowBlocks(rows[rowIndex], unions);
    if (blocks.length < 2) return;

    const scored = blocks.map((block, index) => {
      const positions = block.memberIds
        .flatMap((id) => relations.get(id) || [])
        .map((relatedId) => neighbourPositions.get(relatedId))
        .filter((position) => position !== undefined);
      return { block, index, score: median(positions) };
    });

    scored.sort((first, second) => {
      if (first.score === null && second.score === null) return first.index - second.index;
      if (first.score === null) return first.index - second.index;
      if (second.score === null) return first.index - second.index;
      return first.score - second.score || first.index - second.index;
    });

    rows[rowIndex] = scored.flatMap(({ block }) => block.memberIds);
  };

  for (let pass = 0; pass < ORDERING_PASSES; pass += 1) {
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      sweep(rowIndex, rowIndex - 1, parentsByPerson);
    }
    for (let rowIndex = rows.length - 2; rowIndex >= 0; rowIndex -= 1) {
      sweep(rowIndex, rowIndex + 1, childrenByPerson);
    }
  }

  return rows;
}

/**
 * Orders each row so the children of one union sit together, in the order their
 * parents appear in the row above.
 *
 * Without this the sweeps can leave siblings scattered, which forces a union's
 * sibling bar to stretch across unrelated families and makes one union's
 * descent lines cross another's. Contiguous siblings keep every bar short and
 * confined to its own family.
 */
function groupSiblings(rows, unions) {
  const unionByChild = new Map();
  unions.forEach((union) => union.childIds.forEach((childId) => unionByChild.set(childId, union)));

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const effectiveParentOrder = buildRowBlocks(rows[rowIndex - 1], unions).flatMap(
      (block) => block.memberIds,
    );
    const parentOrder = new Map(effectiveParentOrder.map((id, index) => [id, index]));
    const blocks = buildRowBlocks(rows[rowIndex], unions);

    const sortKey = (block) => {
      const positions = block.memberIds
        .map((childId) => unionByChild.get(childId))
        .filter(Boolean)
        .flatMap((union) =>
          union.parentIds.map((parentId) => parentOrder.get(parentId)).filter(Number.isFinite),
        );
      // The mean distinguishes Nicola's left, right and outer marriages. Using
      // the minimum gave all unions that shared Nicola the same key, so their
      // children could be permuted into the wrong family order.
      return positions.length ? mean(positions) : null;
    };

    const decorated = blocks.map((block, index) => ({ block, index, key: sortKey(block) }));
    // A block with no parent in the row above — somebody who married in — keeps
    // its current position rather than being swept to one end.
    const fallback = new Map();
    decorated.forEach((entry, position) => {
      if (entry.key !== null) return;
      const previous = decorated
        .slice(0, position)
        .reverse()
        .find((candidate) => candidate.key !== null);
      fallback.set(entry, previous ? previous.key : -1);
    });

    decorated.sort((first, second) => {
      const firstKey = first.key ?? fallback.get(first);
      const secondKey = second.key ?? fallback.get(second);
      return firstKey - secondKey || first.index - second.index;
    });

    rows[rowIndex] = decorated.flatMap(({ block }) => block.memberIds);
  }

  return rows;
}

function packRow(blocks, desiredById, maximumRight = Infinity) {
  let cursor = null;

  const widths = blocks.map(blockWidth);
  const lefts = [];

  blocks.forEach((block, index) => {
    const desired = desiredById.get(block);
    const minimumLeft = cursor === null ? 0 : cursor + CARD_GAP;
    lefts[index] =
      desired === undefined ? minimumLeft : Math.max(desired - widths[index] / 2, minimumLeft);
    cursor = lefts[index] + widths[index];
  });

  // The pass above can only ever push a block right to clear its neighbour, so
  // on its own the rows widen a little more on every centring pass and the
  // slack compounds. Relaxing lets each block slide back into the space its
  // neighbours left behind, which is what keeps the chart narrow.
  for (let round = 0; round < RELAX_ROUNDS; round += 1) {
    for (let index = 0; index < blocks.length; index += 1) {
      const desired = desiredById.get(blocks[index]);
      const lowerBound = index === 0 ? 0 : lefts[index - 1] + widths[index - 1] + CARD_GAP;
      const upperBound =
        index === blocks.length - 1
          ? Infinity
          : Math.max(lowerBound, lefts[index + 1] - CARD_GAP - widths[index]);
      const target = desired === undefined ? lowerBound : desired - widths[index] / 2;
      lefts[index] = Math.min(Math.max(target, lowerBound), upperBound);
    }
  }

  blocks.forEach((block, index) => {
    block.left = lefts[index];
    block.centre = lefts[index] + widths[index] / 2;
  });

  if (Number.isFinite(maximumRight) && blocks.length) {
    let right = maximumRight;
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      blocks[index].left = Math.min(blocks[index].left, right - widths[index]);
      right = blocks[index].left - CARD_GAP;
    }

    const correction = Math.max(0, -blocks[0].left);
    blocks.forEach((block, index) => {
      block.left += correction;
      block.centre = block.left + widths[index] / 2;
    });
  }
}

function centreRows(rows, unions) {
  const blocksByRow = rows.map((rowIds) => buildRowBlocks(rowIds, unions));
  const blockOfPerson = new Map();
  blocksByRow.forEach((blocks) =>
    blocks.forEach((block) => block.memberIds.forEach((id) => blockOfPerson.set(id, block))),
  );

  const unionByChild = new Map();
  const unionsById = new Map(unions.map((union) => [union.id, union]));
  const unionsByParent = new Map();
  unions.forEach((union) => union.childIds.forEach((childId) => unionByChild.set(childId, union)));
  unions.forEach((union) =>
    union.parentIds.forEach((parentId) =>
      unionsByParent.set(parentId, [...(unionsByParent.get(parentId) || []), union]),
    ),
  );

  const packedRowWidth = (blocks) =>
    blocks.reduce((total, block) => total + blockWidth(block), 0) +
    Math.max(0, blocks.length - 1) * CARD_GAP;
  const targetWidth = Math.max(...blocksByRow.map(packedRowWidth));

  blocksByRow.forEach((blocks) => packRow(blocks, new Map()));

  const centreOf = (personId) => {
    const block = blockOfPerson.get(personId);
    if (!block) return null;
    const index = block.memberIds.indexOf(personId);
    return block.left + index * (CARD_WIDTH + PARTNER_GAP) + CARD_WIDTH / 2;
  };

  const unionCentre = (union) => {
    const centres = union.parentIds.map(centreOf).filter((value) => value !== null);
    return centres.length ? mean(centres) : null;
  };

  const groupWidth = (group) =>
    group.blocks.reduce((total, block) => total + blockWidth(block), 0) +
    Math.max(0, group.blocks.length - 1) * CARD_GAP;

  const familyGroups = (blocks) => {
    const groups = [];

    blocks.forEach((block) => {
      const originIds = [
        ...new Set(
          block.memberIds.map((memberId) => unionByChild.get(memberId)?.id).filter(Boolean),
        ),
      ].sort();
      const key = originIds.length ? originIds.join("|") : `root:${block.memberIds.join("|")}`;
      const previous = groups.at(-1);

      if (originIds.length && previous?.key === key) {
        previous.blocks.push(block);
        return;
      }

      groups.push({ key, originIds, blocks: [block] });
    });

    return groups;
  };

  const placeGroups = (groups, desiredByGroup) => {
    let cursor = 0;

    groups.forEach((group) => {
      const width = groupWidth(group);
      const desired = desiredByGroup.get(group);
      group.left = Math.max(cursor, desired === undefined ? cursor : desired - width / 2);
      group.centre = group.left + width / 2;
      cursor = group.left + width + CARD_GAP;
    });

    // Let a family slide back into newly available room without changing the
    // order of this generation.
    for (let round = 0; round < RELAX_ROUNDS; round += 1) {
      for (let index = groups.length - 1; index >= 0; index -= 1) {
        const group = groups[index];
        const width = groupWidth(group);
        const lowerBound =
          index === 0 ? 0 : groups[index - 1].left + groupWidth(groups[index - 1]) + CARD_GAP;
        const upperBound =
          index === groups.length - 1
            ? Infinity
            : Math.max(lowerBound, groups[index + 1].left - CARD_GAP - width);
        const desired = desiredByGroup.get(group);
        const target = desired === undefined ? lowerBound : desired - width / 2;
        group.left = Math.min(Math.max(target, lowerBound), upperBound);
        group.centre = group.left + width / 2;
      }
    }

    let right = targetWidth;
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const group = groups[index];
      group.left = Math.min(group.left, right - groupWidth(group));
      group.centre = group.left + groupWidth(group) / 2;
      right = group.left - CARD_GAP;
    }

    const correction = Math.max(0, -(groups[0]?.left || 0));
    groups.forEach((group) => {
      group.left += correction;
      group.centre = group.left + groupWidth(group) / 2;
    });

    groups.forEach((group) => {
      let left = group.left;
      group.blocks.forEach((block) => {
        block.left = left;
        block.centre = left + blockWidth(block) / 2;
        left += blockWidth(block) + CARD_GAP;
      });
    });
  };

  // Place from ancestors down. A complete sibling set is treated as one group
  // and centred under its own union. The old widest-row anchor pulled Nicola's
  // three children thousands of pixels away from their respective marriages.
  packRow(blocksByRow[0], new Map());
  for (let rowIndex = 1; rowIndex < blocksByRow.length; rowIndex += 1) {
    const groups = familyGroups(blocksByRow[rowIndex]);
    const desired = new Map();

    groups.forEach((group) => {
      const targets = group.originIds
        .map((unionId) => unionCentre(unionsById.get(unionId)))
        .filter((value) => value !== null);
      if (targets.length) desired.set(group, mean(targets));
    });

    placeGroups(groups, desired);
  }

  // Now work back towards the ancestors once. Descendant households are wider
  // than their two parent cards, so a purely top-down pass can leave a marriage
  // far to the left of its otherwise compact child group. Moving each complete
  // spouse block over the centre of its children preserves the tight child row
  // while shortening the parent-to-union stem.
  for (let rowIndex = blocksByRow.length - 2; rowIndex >= 0; rowIndex -= 1) {
    const desired = new Map();

    blocksByRow[rowIndex].forEach((block) => {
      const childUnions = [
        ...new Set(block.memberIds.flatMap((parentId) => unionsByParent.get(parentId) || [])),
      ];
      const targets = childUnions
        .filter((union) => union.childIds.length)
        .flatMap((union) => union.childIds.map(centreOf))
        .filter((value) => value !== null);
      if (targets.length) desired.set(block, mean(targets));
    });

    packRow(blocksByRow[rowIndex], desired, targetWidth);
  }

  return { blocksByRow, centreOf, unionCentre, blockOfPerson, anchorRow: 0 };
}

/**
 * Builds the full geometry for a set of people.
 *
 * @returns {{
 *   nodes: Array, unions: Array, edges: Array,
 *   width: number, height: number, generationCount: number
 * }}
 */
export function buildFamilyTreeLayout(people = [], { nodeHeights = {} } = {}) {
  const cleanPeople = people.filter((person) => text(person?.id));
  if (!cleanPeople.length) {
    return { nodes: [], unions: [], edges: [], width: 0, height: 0, generationCount: 0 };
  }

  const generations = assignGenerations(cleanPeople);
  const maxGeneration = Math.max(...cleanPeople.map((person) => generations.get(person.id)));
  const heightByPerson = new Map(
    cleanPeople.map((person) => [person.id, measuredCardHeight(nodeHeights, person.id)]),
  );
  const generationHeights = Array.from({ length: maxGeneration + 1 }, () => CARD_HEIGHT);
  cleanPeople.forEach((person) => {
    const generation = generations.get(person.id);
    generationHeights[generation] = Math.max(
      generationHeights[generation],
      heightByPerson.get(person.id),
    );
  });
  const rowTops = [];
  generationHeights.forEach((height, generation) => {
    rowTops[generation] =
      generation === 0
        ? CANVAS_PADDING
        : rowTops[generation - 1] + generationHeights[generation - 1] + ROW_GAP;
  });
  const rowTop = (generation) => rowTops[generation] ?? CANVAS_PADDING;
  const rowHeight = (generation) => generationHeights[generation] ?? CARD_HEIGHT;
  const unions = buildUnions(cleanPeople);

  const rows = groupSiblings(
    reorderRows(seedOrder(cleanPeople, generations, maxGeneration), unions, cleanPeople),
    unions,
  );
  const { centreOf, unionCentre } = centreRows(rows, unions);

  const peopleById = new Map(cleanPeople.map((person) => [person.id, person]));

  const unionParentGeneration = (union) =>
    Math.max(...union.parentIds.map((parentId) => generations.get(parentId) ?? 0));

  const outsideMarriage = new Set();
  unions.forEach((union) => {
    if (!union.flagged) return;
    union.childIds.forEach((childId) => outsideMarriage.add(childId));
  });

  const nodes = cleanPeople.map((person) => {
    const generation = generations.get(person.id);
    const centre = centreOf(person.id) ?? 0;
    return {
      id: person.id,
      person,
      generation,
      x: centre - CARD_WIDTH / 2,
      y: rowTop(generation),
      width: CARD_WIDTH,
      height: heightByPerson.get(person.id),
      bornOutsideMarriage: outsideMarriage.has(person.id),
    };
  });

  // Where somebody married more than once, each marriage needs its own sibling
  // bar at its own depth. Sharing one bar makes the children of three different
  // mothers indistinguishable, which is the whole point of the chart.
  const marriageIndexByUnion = new Map();
  const unionsTakenByParent = new Map();

  [...unions]
    .filter((union) => union.childIds.length || union.parentIds.length === 2)
    .sort((first, second) => (unionCentre(first) ?? 0) - (unionCentre(second) ?? 0))
    .forEach((union) => {
      const index = Math.max(
        0,
        ...union.parentIds.map((parentId) => unionsTakenByParent.get(parentId) || 0),
      );
      marriageIndexByUnion.set(union.id, index);
      union.parentIds.forEach((parentId) => unionsTakenByParent.set(parentId, index + 1));
    });

  const marriageCountByParent = new Map();
  unions.forEach((union) =>
    union.parentIds.forEach((parentId) =>
      marriageCountByParent.set(parentId, (marriageCountByParent.get(parentId) || 0) + 1),
    ),
  );

  const placedUnions = unions
    .map((union) => {
      const centre = unionCentre(union);
      if (centre === null) return null;
      const generation = unionParentGeneration(union);
      const parentBottom = rowTop(generation) + rowHeight(generation);
      const marriageIndex = marriageIndexByUnion.get(union.id) || 0;
      const childTop = rowTop(generation + 1);
      const childCentres = union.childIds.map(centreOf).filter((value) => value !== null);
      return {
        ...union,
        x: centre,
        y: parentBottom + UNION_BAR_OFFSET,
        generation,
        parentBottom,
        childTop,
        childSpanLeft: childCentres.length ? Math.min(...childCentres) : centre,
        childSpanRight: childCentres.length ? Math.max(...childCentres) : centre,
        marriageIndex,
        // Only worth numbering on the chart when a parent married more than once.
        numbered: union.parentIds.some((parentId) => marriageCountByParent.get(parentId) > 1),
      };
    })
    .filter(Boolean);

  // Neighbouring first marriages used to share the same Y coordinate. When
  // their child spans touched, several independent bars appeared to be one long
  // rail. Allocate a lane per overlapping interval, while also keeping each
  // remarriage of one person on a distinct depth.
  const lanesByGeneration = new Map();
  [...placedUnions]
    .filter((union) => union.childIds.length)
    .sort(
      (first, second) =>
        first.generation - second.generation || first.childSpanLeft - second.childSpanLeft,
    )
    .forEach((union) => {
      const lanes = lanesByGeneration.get(union.generation) || [];
      let lane = union.marriageIndex;
      while (
        Number.isFinite(lanes[lane]) &&
        union.childSpanLeft <= lanes[lane] + UNION_BAR_SEPARATION
      ) {
        lane += 1;
      }
      lane = Math.min(lane, MAX_UNION_BAR_LANE);
      lanes[lane] = union.childSpanRight;
      lanesByGeneration.set(union.generation, lanes);
      union.barLane = lane;
      union.y = Math.min(
        union.parentBottom + UNION_BAR_OFFSET + lane * UNION_BAR_STEP,
        union.childTop - UNION_BAR_MIN_CLEARANCE,
      );
    });

  // Separate families were each centred over their own descendants with nothing
  // pulling them together, which left very large voids between them.
  const componentOf = (() => {
    const { find, union: join } = unionFind(cleanPeople.map((person) => person.id));
    cleanPeople.forEach((person) => {
      [person.fatherId, person.motherId, ...(person.spouseIds || []), ...(person.siblingIds || [])]
        .filter((relatedId) => peopleById.has(relatedId))
        .forEach((relatedId) => join(person.id, relatedId));
    });
    return find;
  })();

  const edges = [];

  placedUnions.forEach((union) => {
    const component = componentOf(union.parentIds[0]);
    const parentCentres = union.parentIds.map(centreOf).filter((value) => value !== null);
    const barY = union.y;
    // Two partners side by side get the classic bar across the gap between them.
    // A later marriage sits further along the row, so its bar would strike
    // through whoever stands in between — those join at the union marker below.
    const adjacent =
      parentCentres.length === 2 &&
      Math.abs(Math.abs(parentCentres[0] - parentCentres[1]) - (CARD_WIDTH + PARTNER_GAP)) < 1;
    const parentCardHeights = union.parentIds
      .map((parentId) => heightByPerson.get(parentId))
      .filter(Number.isFinite);
    const cardMiddleY =
      rowTop(union.generation) +
      (parentCardHeights.length ? Math.min(...parentCardHeights) : CARD_HEIGHT) / 2;
    const routeY =
      rowTop(union.generation) -
      OUTER_MARRIAGE_ROUTE_OFFSET -
      union.marriageIndex * OUTER_MARRIAGE_ROUTE_STEP;

    if (parentCentres.length === 2) {
      const parentDetails = union.parentIds
        .map((parentId) => ({
          id: parentId,
          centre: centreOf(parentId),
          marriageCount: marriageCountByParent.get(parentId) || 0,
        }))
        .filter((parent) => parent.centre !== null);
      const anchor = [...parentDetails].sort(
        (first, second) => second.marriageCount - first.marriageCount,
      )[0];
      const outerPartner = parentDetails.find((parent) => parent.id !== anchor?.id);
      const direction = Math.sign((outerPartner?.centre ?? union.x) - (anchor?.centre ?? union.x));

      union.markerX = adjacent
        ? union.x
        : (outerPartner?.centre ?? union.x) - (direction * (CARD_WIDTH + PARTNER_GAP)) / 2;
      union.markerY = adjacent ? cardMiddleY : routeY;

      edges.push({
        id: `${union.id}:partners`,
        kind: "partner",
        component,
        marital: union.marital,
        type: union.type,
        marriageIndex: union.marriageIndex,
        route: adjacent ? "straight" : "over",
        routeY,
        from: { x: Math.min(...parentCentres), y: cardMiddleY },
        to: { x: Math.max(...parentCentres), y: cardMiddleY },
      });
    } else {
      union.markerX = parentCentres[0] ?? union.x;
      union.markerY = union.parentBottom;
    }

    if (!union.childIds.length) return;

    const childCentres = union.childIds
      .map((childId) => ({ childId, centre: centreOf(childId) }))
      .filter((entry) => entry.centre !== null);
    if (!childCentres.length) return;

    const childSpanLeft = Math.min(...childCentres.map((entry) => entry.centre));
    const childSpanRight = Math.max(...childCentres.map((entry) => entry.centre));
    const barLeft = Math.min(childSpanLeft, union.markerX);
    const barRight = Math.max(childSpanRight, union.markerX);

    // A child branch has one origin: the actual union marker. That keeps the
    // descendants attached to their own marriage instead of two card corners.
    edges.push({
      id: `${union.id}:stem`,
      kind: "stem",
      component,
      flagged: union.flagged,
      marriageIndex: union.marriageIndex,
      route: adjacent || parentCentres.length < 2 ? "direct" : "outer-union",
      from: { x: union.markerX, y: union.markerY },
      to: { x: union.markerX, y: barY },
    });

    // The bar spans this union's own children only. Reaching out to union.x as
    // well used to stretch it across unrelated families whenever the union sat
    // outside its children's span.
    edges.push({
      id: `${union.id}:bar`,
      kind: "sibling-bar",
      component,
      flagged: union.flagged,
      marriageIndex: union.marriageIndex,
      from: { x: barLeft, y: barY },
      to: { x: barRight, y: barY },
    });

    childCentres.forEach(({ childId, centre }) => {
      edges.push({
        id: `${union.id}:child:${childId}`,
        kind: "descent",
        component,
        flagged: union.flagged,
        marriageIndex: union.marriageIndex,
        childId,
        from: { x: centre, y: barY },
        to: { x: centre, y: rowTop(generations.get(childId)) },
      });
    });
  });

  const bounds = new Map();
  nodes.forEach((node) => {
    const key = componentOf(node.id);
    const box = bounds.get(key) || { min: Infinity, max: -Infinity };
    bounds.set(key, {
      min: Math.min(box.min, node.x),
      max: Math.max(box.max, node.x + node.width),
    });
  });

  const shiftByComponent = new Map();
  let cursor = CANVAS_PADDING;
  [...bounds.entries()]
    .sort((first, second) => first[1].min - second[1].min)
    .forEach(([key, box]) => {
      shiftByComponent.set(key, cursor - box.min);
      cursor += box.max - box.min + COMPONENT_GAP;
    });

  const shiftFor = (key) => shiftByComponent.get(key) || 0;
  const movePoint = (point, key) => ({ ...point, x: point.x + shiftFor(key) });

  return {
    generationCount: maxGeneration + 1,
    width: Math.max(0, cursor - COMPONENT_GAP) + CANVAS_PADDING,
    height: rowTop(maxGeneration) + rowHeight(maxGeneration) + CANVAS_PADDING,
    generationHeights,
    nodes: nodes.map((node) => ({ ...node, x: node.x + shiftFor(componentOf(node.id)) })),
    unions: placedUnions.map((union) => ({
      ...union,
      x: union.x + shiftFor(componentOf(union.parentIds[0])),
      markerX: union.markerX + shiftFor(componentOf(union.parentIds[0])),
      markerY: union.markerY,
    })),
    edges: edges.map((edge) => ({
      ...edge,
      from: movePoint(edge.from, edge.component),
      to: movePoint(edge.to, edge.component),
    })),
    peopleById,
  };
}
