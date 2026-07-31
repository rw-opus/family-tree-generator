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
export const ROW_GAP = 48;
export const CANVAS_PADDING = 24;

const ROW_PITCH = CARD_HEIGHT + ROW_GAP;
const ORDERING_PASSES = 6;
const CENTRING_PASSES = 8;
const RELAX_ROUNDS = 3;

const text = (value) => String(value ?? "").trim();

const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
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
    const parentIds = [...new Set([child.fatherId, child.motherId])].filter((parentId) =>
      peopleById.has(parentId),
    );
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
    const spousesOfFirst = new Set(first?.spouseIds || []);
    const spousesOfSecond = new Set(second?.spouseIds || []);
    const linked =
      Boolean(second) && (spousesOfFirst.has(second.id) || spousesOfSecond.has(first.id));

    // A couple recorded only through a shared child is not evidence of a
    // marriage, so it stays a partnership until the marriage is entered.
    const type = !second ? "single" : declared || (linked ? "marriage" : "partnership");

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

function packRow(blocks, desiredById) {
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
}

function centreRows(rows, unions) {
  const blocksByRow = rows.map((rowIds) => buildRowBlocks(rowIds, unions));
  const blockOfPerson = new Map();
  blocksByRow.forEach((blocks) =>
    blocks.forEach((block) => block.memberIds.forEach((id) => blockOfPerson.set(id, block))),
  );

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

  for (let pass = 0; pass < CENTRING_PASSES; pass += 1) {
    // Pull each row of children under the unions that produced them.
    for (let rowIndex = 1; rowIndex < blocksByRow.length; rowIndex += 1) {
      const desired = new Map();
      blocksByRow[rowIndex].forEach((block) => {
        const targets = block.memberIds
          .map((childId) => {
            const union = unions.find((candidate) => candidate.childIds.includes(childId));
            return union ? unionCentre(union) : null;
          })
          .filter((value) => value !== null);
        if (targets.length) desired.set(block, mean(targets));
      });
      packRow(blocksByRow[rowIndex], desired);
    }

    // Then lift each row of parents over the middle of their children.
    for (let rowIndex = blocksByRow.length - 2; rowIndex >= 0; rowIndex -= 1) {
      const desired = new Map();
      blocksByRow[rowIndex].forEach((block) => {
        const targets = unions
          .filter(
            (union) =>
              union.childIds.length &&
              union.parentIds.some((parentId) => block.memberIds.includes(parentId)),
          )
          .flatMap((union) => union.childIds.map(centreOf))
          .filter((value) => value !== null);
        if (targets.length) desired.set(block, mean(targets));
      });
      packRow(blocksByRow[rowIndex], desired);
    }
  }

  return { blocksByRow, centreOf, unionCentre, blockOfPerson };
}

/**
 * Builds the full geometry for a set of people.
 *
 * @returns {{
 *   nodes: Array, unions: Array, edges: Array,
 *   width: number, height: number, generationCount: number
 * }}
 */
export function buildFamilyTreeLayout(people = []) {
  const cleanPeople = people.filter((person) => text(person?.id));
  if (!cleanPeople.length) {
    return { nodes: [], unions: [], edges: [], width: 0, height: 0, generationCount: 0 };
  }

  const generations = assignGenerations(cleanPeople);
  const maxGeneration = Math.max(...cleanPeople.map((person) => generations.get(person.id)));
  const unions = buildUnions(cleanPeople);

  const rows = reorderRows(seedOrder(cleanPeople, generations, maxGeneration), unions, cleanPeople);
  const { centreOf, unionCentre } = centreRows(rows, unions);

  const rowTop = (generation) => CANVAS_PADDING + generation * ROW_PITCH;
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
      height: CARD_HEIGHT,
      bornOutsideMarriage: outsideMarriage.has(person.id),
    };
  });

  const placedUnions = unions
    .map((union) => {
      const centre = unionCentre(union);
      if (centre === null) return null;
      const generation = unionParentGeneration(union);
      const parentBottom = rowTop(generation) + CARD_HEIGHT;
      return {
        ...union,
        x: centre,
        y: parentBottom + ROW_GAP / 2,
        generation,
        parentBottom,
        childTop: rowTop(generation + 1),
      };
    })
    .filter(Boolean);

  const edges = [];

  placedUnions.forEach((union) => {
    // The bar joining the partners, carrying the marriage marker.
    if (union.parentIds.length === 2) {
      const centres = union.parentIds.map(centreOf).filter((value) => value !== null);
      if (centres.length === 2) {
        edges.push({
          id: `${union.id}:partners`,
          kind: "partner",
          marital: union.marital,
          type: union.type,
          from: { x: Math.min(...centres), y: rowTop(union.generation) + CARD_HEIGHT / 2 },
          to: { x: Math.max(...centres), y: rowTop(union.generation) + CARD_HEIGHT / 2 },
        });
      }
    }

    if (!union.childIds.length) return;

    const childCentres = union.childIds
      .map((childId) => ({ childId, centre: centreOf(childId) }))
      .filter((entry) => entry.centre !== null);
    if (!childCentres.length) return;

    const barY = union.y;

    union.parentIds.forEach((parentId) => {
      const centre = centreOf(parentId);
      if (centre === null) return;
      edges.push({
        id: `${union.id}:stem:${parentId}`,
        kind: "stem",
        flagged: union.flagged,
        from: { x: centre, y: union.parentBottom },
        to: { x: union.x, y: barY },
      });
    });

    edges.push({
      id: `${union.id}:bar`,
      kind: "sibling-bar",
      flagged: union.flagged,
      from: { x: Math.min(union.x, ...childCentres.map((entry) => entry.centre)), y: barY },
      to: { x: Math.max(union.x, ...childCentres.map((entry) => entry.centre)), y: barY },
    });

    childCentres.forEach(({ childId, centre }) => {
      edges.push({
        id: `${union.id}:child:${childId}`,
        kind: "descent",
        flagged: union.flagged,
        childId,
        from: { x: centre, y: barY },
        to: { x: centre, y: rowTop(generations.get(childId)) },
      });
    });
  });

  const rightEdge = Math.max(...nodes.map((node) => node.x + node.width));
  const leftEdge = Math.min(...nodes.map((node) => node.x));
  const shift = CANVAS_PADDING - leftEdge;

  const shifted = (point) => ({ ...point, x: point.x + shift });

  return {
    generationCount: maxGeneration + 1,
    width: rightEdge - leftEdge + CANVAS_PADDING * 2,
    height: rowTop(maxGeneration) + CARD_HEIGHT + CANVAS_PADDING,
    nodes: nodes.map((node) => ({ ...node, x: node.x + shift })),
    unions: placedUnions.map((union) => ({ ...union, x: union.x + shift })),
    edges: edges.map((edge) => ({
      ...edge,
      from: shifted(edge.from),
      to: shifted(edge.to),
    })),
    peopleById,
  };
}
