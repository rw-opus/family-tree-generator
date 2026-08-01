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

// Each successive marriage of the same person drops its sibling bar a little
// lower, so the children of each are read off their own bar.
const UNION_BAR_OFFSET = 24;
const UNION_BAR_STEP = 10;
const UNION_BAR_MIN_CLEARANCE = 8;
const UNION_BAR_SEPARATION = 12;
const STEM_TURN_CLEARANCE = 12;
const STEM_CHILD_COLLISION_RADIUS = 4;
const CONNECTOR_OPENING_HALF_WIDTH = 5;
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

/**
 * A centred marriage stem can land on the centre line of a middle child. In
 * that case the two verticals read as one continuous line. Enter the sibling
 * bar through the nearest gap between children instead, while keeping the
 * first part of the stem exactly at the middle of the parents' union.
 */
function childBarEntry(markerX, childCentres = []) {
  const centres = [...new Set(childCentres)].sort((first, second) => first - second);
  const clashes = centres.some(
    (childCentre) => Math.abs(childCentre - markerX) <= STEM_CHILD_COLLISION_RADIUS,
  );
  if (!clashes) return markerX;

  const gaps = centres.slice(1).map((centre, index) => (centres[index] + centre) / 2);
  if (gaps.length) {
    return [...gaps].sort(
      (first, second) => Math.abs(first - markerX) - Math.abs(second - markerX),
    )[0];
  }

  // An only child has no internal gap to enter through, and it needs none: the
  // union stem and the child's descent are meant to read as one straight line
  // from the middle of the marriage down to the child. Stepping aside here put
  // a dog-leg on every single-child branch.
  return markerX;
}

export function splitSiblingBar(left, right, crossingXs = []) {
  const crossings = [...new Set(crossingXs)]
    .filter(
      (crossingX) =>
        crossingX - CONNECTOR_OPENING_HALF_WIDTH > left &&
        crossingX + CONNECTOR_OPENING_HALF_WIDTH < right,
    )
    .sort((first, second) => first - second);
  if (!crossings.length) return [{ left, right }];

  const segments = [];
  let cursor = left;
  crossings.forEach((crossingX) => {
    const openingLeft = crossingX - CONNECTOR_OPENING_HALF_WIDTH;
    const openingRight = crossingX + CONNECTOR_OPENING_HALF_WIDTH;
    if (openingLeft > cursor) segments.push({ left: cursor, right: openingLeft });
    cursor = Math.max(cursor, openingRight);
  });
  if (cursor < right) segments.push({ left: cursor, right });
  return segments;
}

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

/** Assigns a different vertical lane whenever complete child-bar spans meet. */
export function assignUnionBarLanes(unions = []) {
  const lanesByGeneration = new Map();
  const laneByUnion = new Map();

  [...unions]
    .filter((union) => union.childIds?.length)
    .sort((first, second) => first.generation - second.generation || first.barLeft - second.barLeft)
    .forEach((union) => {
      const lanes = lanesByGeneration.get(union.generation) || [];
      let lane = union.marriageIndex || 0;
      while (Number.isFinite(lanes[lane]) && union.barLeft <= lanes[lane] + UNION_BAR_SEPARATION) {
        lane += 1;
      }
      lanes[lane] = Math.max(lanes[lane] ?? -Infinity, union.barRight);
      lanesByGeneration.set(union.generation, lanes);
      laneByUnion.set(union.id, lane);
    });

  return unions.map((union) => ({
    ...union,
    barLane: laneByUnion.get(union.id) || 0,
  }));
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

  // Siblings of a much-married person tie with them on parent order, and the
  // tie used to break on seed order, which could strand the plain sibling on
  // the far side of the spouse chain. The parents' sibling bar then had to
  // reach across every spouse — through the same corridor the outer marriage
  // routes over. Keeping the longest chain outermost frees that corridor.
  const marriageCount = new Map();
  unions
    .filter((union) => union.parentIds.length === 2)
    .forEach((union) =>
      union.parentIds.forEach((parentId) =>
        marriageCount.set(parentId, (marriageCount.get(parentId) || 0) + 1),
      ),
    );
  const chainWeight = (block) =>
    Math.max(0, ...block.memberIds.map((id) => marriageCount.get(id) || 0));

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
      return (
        firstKey - secondKey ||
        chainWeight(first.block) - chainWeight(second.block) ||
        first.index - second.index
      );
    });

    rows[rowIndex] = decorated.flatMap(({ block }) => block.memberIds);
  }

  return rows;
}

/**
 * Bottom-up subtree placement, following the reference sketches.
 *
 * Every spouse block owns the blocks of its children, and a subtree's width is
 * the greater of the block itself and its children's packed span. Children are
 * packed at the minimum gap and centred under their parent block; the parent is
 * centred over them. So the space between siblings expands exactly where a
 * branch's descendants need the room — C's children spread beneath C until
 * D's three cousins push back — and a childless sibling takes one card.
 *
 * The previous passes placed whole rows against each other (first anchored on
 * the widest row, then top-down with a single return sweep), which always left
 * some boundary parent far from its own children.
 */
function centreRows(rows, unions) {
  const blocksByRow = rows.map((rowIds) => buildRowBlocks(rowIds, unions));
  const blockOfPerson = new Map();
  blocksByRow.forEach((blocks, rowIndex) =>
    blocks.forEach((block, orderIndex) => {
      block.rowIndex = rowIndex;
      block.orderIndex = orderIndex;
      block.memberIds.forEach((id) => blockOfPerson.set(id, block));
    }),
  );

  const unionByChild = new Map();
  unions.forEach((union) => union.childIds.forEach((childId) => unionByChild.set(childId, union)));

  // Attach every block to one parent block: the one holding the parents of its
  // first member with recorded parents. A chain that marries two families
  // together is anchored to one of them; the other family reaches it with a
  // longer connector rather than the layout trying to serve both at once.
  const childrenOf = new Map();
  const parentOf = new Map();
  blocksByRow.forEach((blocks) =>
    blocks.forEach((block) => {
      for (const memberId of block.memberIds) {
        const union = unionByChild.get(memberId);
        const anchor = union ? blockOfPerson.get(union.parentIds[0]) : null;
        if (anchor && anchor !== block && anchor.rowIndex < block.rowIndex) {
          parentOf.set(block, anchor);
          childrenOf.set(anchor, [...(childrenOf.get(anchor) || []), block]);
          return;
        }
      }
    }),
  );
  childrenOf.forEach((children) =>
    children.sort((first, second) => first.orderIndex - second.orderIndex),
  );

  const subtreeWidth = new Map();
  const measure = (block) => {
    const children = childrenOf.get(block) || [];
    const childrenWidth = children.reduce(
      (total, child, index) => total + measure(child) + (index ? CARD_GAP : 0),
      0,
    );
    const width = Math.max(blockWidth(block), childrenWidth);
    subtreeWidth.set(block, width);
    return width;
  };

  const deepestRow = (block) =>
    (childrenOf.get(block) || []).reduce(
      (deepest, child) => Math.max(deepest, deepestRow(child)),
      block.rowIndex,
    );

  // A subtree is placed as one unit: the block centred in its span, and its
  // children's spans packed at the minimum gap, centred beneath it.
  const rowCursor = new Map();
  const place = (block, left) => {
    const span = subtreeWidth.get(block);
    const width = blockWidth(block);
    block.left = left + (span - width) / 2;
    block.centre = block.left + width / 2;
    rowCursor.set(
      block.rowIndex,
      Math.max(rowCursor.get(block.rowIndex) ?? -Infinity, block.left + width),
    );

    const children = childrenOf.get(block) || [];
    if (!children.length) return;

    // Children are grouped by the marriage they came from, and each group is
    // centred under that marriage rather than under the whole block. Packing
    // every child of a much-married person as one run left each marriage's
    // stem leaning sideways to reach its own bar, and those leaning stems
    // crossed the neighbouring marriage's children.
    const memberCentre = (memberId) => {
      const index = block.memberIds.indexOf(memberId);
      return index < 0 ? null : block.left + index * (CARD_WIDTH + PARTNER_GAP) + CARD_WIDTH / 2;
    };

    const groups = [];
    children.forEach((child) => {
      const union = child.memberIds.map((id) => unionByChild.get(id)).find(Boolean);
      const key = union?.id ?? `loose:${child.orderIndex}`;
      const previous = groups.at(-1);
      if (previous?.key === key) {
        previous.children.push(child);
        return;
      }
      groups.push({ key, union, children: [child] });
    });

    groups.forEach((group) => {
      group.width = group.children.reduce(
        (total, child, index) => total + subtreeWidth.get(child) + (index ? CARD_GAP : 0),
        0,
      );
      const centres = (group.union?.parentIds || []).map(memberCentre).filter((v) => v !== null);
      group.desired = centres.length ? mean(centres) : null;
    });

    const totalWidth = groups.reduce(
      (total, group, index) => total + group.width + (index ? CARD_GAP : 0),
      0,
    );
    let cursor = left + (span - totalWidth) / 2;

    groups.forEach((group) => {
      const wanted = group.desired === null ? cursor : group.desired - group.width / 2;
      let childLeft = Math.max(cursor, wanted);
      group.children.forEach((child) => {
        place(child, childLeft);
        childLeft += subtreeWidth.get(child) + CARD_GAP;
      });
      cursor = childLeft;
    });
  };

  const roots = blocksByRow
    .flat()
    .filter((block) => !parentOf.has(block))
    .sort(
      (first, second) => first.rowIndex - second.rowIndex || first.orderIndex - second.orderIndex,
    );

  roots.forEach((root) => {
    measure(root);
    // Start after anything already placed on any row this subtree touches.
    let left = 0;
    for (let rowIndex = root.rowIndex; rowIndex <= deepestRow(root); rowIndex += 1) {
      const used = rowCursor.get(rowIndex);
      if (Number.isFinite(used)) left = Math.max(left, used + CARD_GAP);
    }
    place(root, left);
  });

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

  const placedUnions = assignUnionBarLanes(
    unions
      .map((union) => {
        const centre = unionCentre(union);
        if (centre === null) return null;
        const generation = unionParentGeneration(union);
        const marriageIndex = marriageIndexByUnion.get(union.id) || 0;
        const childCentres = union.childIds.map(centreOf).filter((value) => value !== null);
        const parentCentres = union.parentIds.map(centreOf).filter((value) => value !== null);
        const adjacent =
          parentCentres.length === 2 &&
          Math.abs(Math.abs(parentCentres[0] - parentCentres[1]) - (CARD_WIDTH + PARTNER_GAP)) < 1;
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
        const direction = Math.sign((outerPartner?.centre ?? centre) - (anchor?.centre ?? centre));
        const markerX =
          parentCentres.length < 2
            ? (parentCentres[0] ?? centre)
            : adjacent
              ? centre
              : (outerPartner?.centre ?? centre) - (direction * (CARD_WIDTH + PARTNER_GAP)) / 2;
        const childSpanLeft = childCentres.length ? Math.min(...childCentres) : centre;
        const childSpanRight = childCentres.length ? Math.max(...childCentres) : centre;
        const barEntryX = childBarEntry(markerX, childCentres);

        return {
          ...union,
          x: centre,
          generation,
          parentCentres,
          adjacent,
          markerX,
          barEntryX,
          childSpanLeft,
          childSpanRight,
          barLeft: Math.min(childSpanLeft, barEntryX),
          barRight: Math.max(childSpanRight, barEntryX),
          marriageIndex,
          // Only worth numbering on the chart when a parent married more than once.
          numbered: union.parentIds.some((parentId) => marriageCountByParent.get(parentId) > 1),
        };
      })
      .filter(Boolean),
  );

  // Neighbouring first marriages used to share the same Y coordinate. When
  // their complete parent-to-children spans touched, several independent bars
  // appeared to be one long rail. Allocate a lane from the final drawn span,
  // including the route back to the marriage marker, rather than from only the
  // children. The latter misses almost every one-child branch.
  // More independent family bars require more vertical lanes. Grow only the
  // affected generation corridor so those rails never collapse together or
  // run into the cards below.
  const rowGaps = Array.from({ length: maxGeneration }, () => ROW_GAP);
  placedUnions
    .filter((union) => union.childIds.length)
    .forEach((union) => {
      rowGaps[union.generation] = Math.max(
        rowGaps[union.generation] ?? ROW_GAP,
        UNION_BAR_OFFSET + union.barLane * UNION_BAR_STEP + UNION_BAR_MIN_CLEARANCE,
      );
    });

  const rowTops = [];
  generationHeights.forEach((height, generation) => {
    rowTops[generation] =
      generation === 0
        ? CANVAS_PADDING
        : rowTops[generation - 1] + generationHeights[generation - 1] + rowGaps[generation - 1];
  });
  const rowTop = (generation) => rowTops[generation] ?? CANVAS_PADDING;

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

  placedUnions.forEach((union) => {
    union.parentBottom = rowTop(union.generation) + rowHeight(union.generation);
    union.childTop = rowTop(union.generation + 1);
    union.y = union.parentBottom + UNION_BAR_OFFSET + (union.barLane || 0) * UNION_BAR_STEP;
    const parentCardHeights = union.parentIds
      .map((parentId) => heightByPerson.get(parentId))
      .filter(Number.isFinite);
    union.cardMiddleY =
      rowTop(union.generation) +
      (parentCardHeights.length ? Math.min(...parentCardHeights) : CARD_HEIGHT) / 2;
    union.routeY =
      rowTop(union.generation) -
      OUTER_MARRIAGE_ROUTE_OFFSET -
      union.marriageIndex * OUTER_MARRIAGE_ROUTE_STEP;
    union.markerY =
      union.parentCentres.length === 2
        ? union.adjacent
          ? union.cardMiddleY
          : union.routeY
        : union.parentBottom;
    union.stemTurnY =
      union.barEntryX !== union.markerX
        ? Math.min(union.y - UNION_BAR_MIN_CLEARANCE, union.parentBottom + STEM_TURN_CLEARANCE)
        : null;
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

  const verticalRoutes = placedUnions.flatMap((union) => {
    if (!union.childIds.length) return [];
    const routes = [];
    if (Number.isFinite(union.stemTurnY) && union.barEntryX !== union.markerX) {
      routes.push({
        unionId: union.id,
        x: union.markerX,
        fromY: union.markerY,
        toY: union.stemTurnY,
      });
      routes.push({
        unionId: union.id,
        x: union.barEntryX,
        fromY: union.stemTurnY,
        toY: union.y,
      });
    } else {
      routes.push({
        unionId: union.id,
        x: union.markerX,
        fromY: union.markerY,
        toY: union.y,
      });
    }
    union.childIds.forEach((childId) => {
      const childCentre = centreOf(childId);
      if (childCentre === null) return;
      routes.push({
        unionId: union.id,
        x: childCentre,
        fromY: union.y,
        toY: rowTop(generations.get(childId)),
      });
    });
    return routes;
  });

  placedUnions.forEach((union) => {
    const component = componentOf(union.parentIds[0]);
    const parentCentres = union.parentCentres;
    const barY = union.y;

    if (parentCentres.length === 2) {
      edges.push({
        id: `${union.id}:partners`,
        unionId: union.id,
        kind: "partner",
        component,
        marital: union.marital,
        type: union.type,
        marriageIndex: union.marriageIndex,
        route: union.adjacent ? "straight" : "over",
        routeY: union.routeY,
        // A marriage line meets the side of each spouse's box. Running it
        // centre to centre hid it behind both cards, and on the routed form the
        // descent landed on the far card's centre, dropping in from above
        // instead of meeting its edge.
        from: { x: Math.min(...parentCentres) + CARD_WIDTH / 2, y: union.cardMiddleY },
        to: { x: Math.max(...parentCentres) - CARD_WIDTH / 2, y: union.cardMiddleY },
      });
    }

    if (!union.childIds.length) return;

    const childCentres = union.childIds
      .map((childId) => ({ childId, centre: centreOf(childId) }))
      .filter((entry) => entry.centre !== null);
    if (!childCentres.length) return;

    // A child branch has one origin: the actual union marker. That keeps the
    // descendants attached to their own marriage instead of two card corners.
    edges.push({
      id: `${union.id}:stem`,
      unionId: union.id,
      kind: "stem",
      component,
      flagged: union.flagged,
      marriageIndex: union.marriageIndex,
      route: union.adjacent || parentCentres.length < 2 ? "direct" : "outer-union",
      turnY: union.stemTurnY,
      from: { x: union.markerX, y: union.markerY },
      to: { x: union.barEntryX, y: barY },
    });

    // The bar spans this union's own children only. Reaching out to union.x as
    // well used to stretch it across unrelated families whenever the union sat
    // outside its children's span.
    const crossingXs = verticalRoutes
      .filter((route) => {
        if (route.unionId === union.id) return false;
        const top = Math.min(route.fromY, route.toY);
        const bottom = Math.max(route.fromY, route.toY);
        return top < barY && bottom > barY && route.x > union.barLeft && route.x < union.barRight;
      })
      .map((route) => route.x);
    const barSegments = splitSiblingBar(union.barLeft, union.barRight, crossingXs).map(
      (segment) => ({
        from: { x: segment.left, y: barY },
        to: { x: segment.right, y: barY },
      }),
    );
    edges.push({
      id: `${union.id}:bar`,
      unionId: union.id,
      kind: "sibling-bar",
      component,
      flagged: union.flagged,
      marriageIndex: union.marriageIndex,
      from: { x: union.barLeft, y: barY },
      to: { x: union.barRight, y: barY },
      segments: barSegments,
    });

    childCentres.forEach(({ childId, centre }) => {
      edges.push({
        id: `${union.id}:child:${childId}`,
        unionId: union.id,
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
    unions: placedUnions.map((union) => {
      // Every horizontal field has to move with the family, or the union hands
      // out a mixture of shifted and unshifted coordinates.
      const shift = shiftFor(componentOf(union.parentIds[0]));
      const moved = (value) => (Number.isFinite(value) ? value + shift : value);
      return {
        ...union,
        x: moved(union.x),
        markerX: moved(union.markerX),
        markerY: union.markerY,
        barEntryX: moved(union.barEntryX),
        barLeft: moved(union.barLeft),
        barRight: moved(union.barRight),
        childSpanLeft: moved(union.childSpanLeft),
        childSpanRight: moved(union.childSpanRight),
      };
    }),
    edges: edges.map((edge) => ({
      ...edge,
      from: movePoint(edge.from, edge.component),
      to: movePoint(edge.to, edge.component),
      segments: edge.segments?.map((segment) => ({
        from: movePoint(segment.from, edge.component),
        to: movePoint(segment.to, edge.component),
      })),
    })),
    peopleById,
  };
}
