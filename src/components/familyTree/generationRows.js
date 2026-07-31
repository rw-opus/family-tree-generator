function unionFind(ids) {
  const parent = new Map(ids.map((id) => [id, id]));

  const find = (id) => {
    const current = parent.get(id);
    if (!current || current === id) return current;
    const root = find(current);
    parent.set(id, root);
    return root;
  };

  const union = (firstId, secondId) => {
    const firstRoot = find(firstId);
    const secondRoot = find(secondId);
    if (firstRoot && secondRoot && firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
  };

  return { find, union };
}

export function familyGenerationById(people = []) {
  const peopleById = new Map(
    people.filter((person) => person?.id).map((person) => [person.id, person]),
  );
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

  const componentIds = new Set(ids.map(find));
  const childrenByComponent = new Map([...componentIds].map((id) => [id, new Set()]));
  const indegree = new Map([...componentIds].map((id) => [id, 0]));

  peopleById.forEach((person) => {
    const childComponent = find(person.id);
    [...new Set([person.fatherId, person.motherId])]
      .filter((parentId) => peopleById.has(parentId))
      .forEach((parentId) => {
        const parentComponent = find(parentId);
        if (!parentComponent || parentComponent === childComponent) return;
        const children = childrenByComponent.get(parentComponent);
        if (!children.has(childComponent)) {
          children.add(childComponent);
          indegree.set(childComponent, (indegree.get(childComponent) || 0) + 1);
        }
      });
  });

  const depthByComponent = new Map([...componentIds].map((id) => [id, 0]));
  const queue = [...componentIds].filter((id) => indegree.get(id) === 0).sort();
  const visited = new Set();

  while (queue.length) {
    const componentId = queue.shift();
    if (visited.has(componentId)) continue;
    visited.add(componentId);

    childrenByComponent.get(componentId)?.forEach((childId) => {
      depthByComponent.set(
        childId,
        Math.max(depthByComponent.get(childId) || 0, (depthByComponent.get(componentId) || 0) + 1),
      );
      indegree.set(childId, (indegree.get(childId) || 0) - 1);
      if (indegree.get(childId) === 0) queue.push(childId);
    });
  }

  return new Map(ids.map((id) => [id, depthByComponent.get(find(id)) || 0]));
}

export function widestFamilyGeneration(generationByPerson) {
  const counts = new Map();
  generationByPerson.forEach((generation) => {
    counts.set(generation, (counts.get(generation) || 0) + 1);
  });

  return (
    [...counts.entries()]
      .sort((first, second) => second[1] - first[1] || first[0] - second[0])
      .at(0)?.[0] ?? null
  );
}

function canvasScale(canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    rect,
    x: canvas.offsetWidth ? rect.width / canvas.offsetWidth || 1 : 1,
    y: canvas.offsetHeight ? rect.height / canvas.offsetHeight || 1 : 1,
  };
}

export function alignFamilyGenerationRows(root) {
  const canvas = root?.querySelector?.(".family-canvas");
  const cards = [...(root?.querySelectorAll?.("[data-family-generation]") || [])];
  if (!canvas || !cards.length) return () => {};

  cards.forEach((card) => {
    card.style.removeProperty("min-height");
    card.style.removeProperty("margin-top");
  });

  const cardsByGeneration = new Map();
  cards.forEach((card) => {
    const generation = Number(card.dataset.familyGeneration);
    if (!Number.isFinite(generation)) return;
    const generationCards = cardsByGeneration.get(generation) || [];
    generationCards.push(card);
    cardsByGeneration.set(generation, generationCards);
  });

  const naturalScale = canvasScale(canvas);
  cardsByGeneration.forEach((generationCards) => {
    const tallest = Math.max(
      ...generationCards.map((card) => card.getBoundingClientRect().height / naturalScale.y),
    );
    generationCards.forEach((card) =>
      card.style.setProperty("min-height", `${Math.ceil(tallest)}px`),
    );
  });

  [...cardsByGeneration.keys()]
    .sort((first, second) => first - second)
    .forEach((generation) => {
      const scale = canvasScale(canvas);
      const generationCards = cardsByGeneration.get(generation);
      const topByCard = generationCards.map((card) => ({
        card,
        top: (card.getBoundingClientRect().top - scale.rect.top) / scale.y,
      }));
      const rowTop = Math.max(...topByCard.map(({ top }) => top));
      topByCard.forEach(({ card, top }) => {
        const offset = Math.max(0, Math.ceil(rowTop - top));
        if (offset) card.style.setProperty("margin-top", `${offset}px`);
      });
    });

  return () => {
    cards.forEach((card) => {
      card.style.removeProperty("min-height");
      card.style.removeProperty("margin-top");
    });
  };
}
