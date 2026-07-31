import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { partnerRelationship, partnerRelationshipAnnotation } from "./partnerRelationship.js";
import { SvgPartnerRelationshipPath } from "./SvgPartnerRelationshipPath.jsx";
import "./GenerationRowFamilyTree.css";
import "./PartnerRelationship.css";

function pairKey(personIds) {
  return [...personIds].sort().join("::");
}

function validParentIds(person, peopleById) {
  return [...new Set([person?.fatherId, person?.motherId])].filter((parentId) =>
    peopleById.has(parentId),
  );
}

function familyRelationships(people, peopleById) {
  const partnerPairs = new Map();
  const childGroups = new Map();

  const addPartnerPair = (firstId, secondId, fallbackType = "marriage") => {
    if (!peopleById.has(firstId) || !peopleById.has(secondId) || firstId === secondId) return;

    const parentIds = [firstId, secondId].sort();
    const key = pairKey(parentIds);
    if (partnerPairs.has(key)) return;

    partnerPairs.set(key, {
      key,
      personIds: parentIds,
      relationship: partnerRelationship(
        peopleById.get(parentIds[0]),
        peopleById.get(parentIds[1]),
        fallbackType,
      ),
    });
  };

  people.forEach((person) => {
    (person.spouseIds || []).forEach((partnerId) =>
      addPartnerPair(person.id, partnerId, "marriage"),
    );

    const parentIds = validParentIds(person, peopleById).sort();
    if (!parentIds.length) return;

    if (parentIds.length === 2) addPartnerPair(parentIds[0], parentIds[1], "marriage");

    const key = pairKey(parentIds);
    const group = childGroups.get(key) || { key, parentIds, childIds: [] };
    group.childIds.push(person.id);
    childGroups.set(key, group);
  });

  return {
    partnerPairs: [...partnerPairs.values()],
    childGroups: [...childGroups.values()],
  };
}

function partnershipComponents(people, peopleById) {
  const neighbours = new Map(people.map((person) => [person.id, new Set()]));

  const connect = (firstId, secondId) => {
    if (!neighbours.has(firstId) || !neighbours.has(secondId) || firstId === secondId) return;
    neighbours.get(firstId).add(secondId);
    neighbours.get(secondId).add(firstId);
  };

  people.forEach((person) => {
    (person.spouseIds || []).forEach((partnerId) => connect(person.id, partnerId));
    const parentIds = validParentIds(person, peopleById);
    if (parentIds.length === 2) connect(parentIds[0], parentIds[1]);
  });

  const componentByPerson = new Map();
  people.forEach((person) => {
    if (componentByPerson.has(person.id)) return;

    const componentId = person.id;
    const queue = [person.id];
    while (queue.length) {
      const personId = queue.shift();
      if (!personId || componentByPerson.has(personId)) continue;
      componentByPerson.set(personId, componentId);
      neighbours.get(personId)?.forEach((partnerId) => queue.push(partnerId));
    }
  });

  return componentByPerson;
}

function orderedGenerationRows(people, generationByPerson) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const sourceIndex = new Map(people.map((person, index) => [person.id, index]));
  const componentByPerson = partnershipComponents(people, peopleById);
  const rows = new Map();

  people.forEach((person) => {
    const generation = generationByPerson.get(person.id) || 0;
    const row = rows.get(generation) || [];
    row.push(person);
    rows.set(generation, row);
  });

  const orderedRows = [];
  const positionByPerson = new Map();

  [...rows.keys()]
    .sort((first, second) => first - second)
    .forEach((generation) => {
      const row = rows.get(generation);
      const components = new Map();

      row.forEach((person) => {
        const componentId = componentByPerson.get(person.id) || person.id;
        const component = components.get(componentId) || [];
        component.push(person);
        components.set(componentId, component);
      });

      const componentAnchor = (component) => {
        const parentPositions = component.flatMap((person) =>
          validParentIds(person, peopleById)
            .map((parentId) => positionByPerson.get(parentId))
            .filter(Number.isFinite),
        );
        if (parentPositions.length) {
          return (
            parentPositions.reduce((sum, position) => sum + position, 0) / parentPositions.length
          );
        }
        return Math.min(...component.map((person) => sourceIndex.get(person.id) || 0));
      };

      const orderedPeople = [...components.values()]
        .sort(
          (first, second) =>
            componentAnchor(first) - componentAnchor(second) ||
            (sourceIndex.get(first[0]?.id) || 0) - (sourceIndex.get(second[0]?.id) || 0),
        )
        .flatMap((component) =>
          [...component].sort(
            (first, second) => (sourceIndex.get(first.id) || 0) - (sourceIndex.get(second.id) || 0),
          ),
        );

      orderedPeople.forEach((person, index) => positionByPerson.set(person.id, index));
      orderedRows.push({ generation, people: orderedPeople });
    });

  return orderedRows;
}

function relativeRect(node, layoutRect, scaleX, scaleY) {
  const rect = node.getBoundingClientRect();
  const left = (rect.left - layoutRect.left) / scaleX;
  const top = (rect.top - layoutRect.top) / scaleY;
  const width = rect.width / scaleX;
  const height = rect.height / scaleY;

  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

function partnerPath(first, second) {
  const left = first.centerX <= second.centerX ? first : second;
  const right = left === first ? second : first;
  const horizontalGap = right.left - left.right;
  const sharesRow = Math.abs(left.centerY - right.centerY) < 3;

  if (sharesRow && horizontalGap > 6) {
    return {
      d: `M ${left.right} ${left.centerY} H ${right.left}`,
      annotationX: (left.right + right.left) / 2,
      annotationY: left.centerY - 8,
    };
  }

  const railY = Math.max(4, Math.min(left.top, right.top) - 10);
  return {
    d: `M ${left.centerX} ${left.top} V ${railY} H ${right.centerX} V ${right.top}`,
    annotationX: (left.centerX + right.centerX) / 2,
    annotationY: railY - 5,
  };
}

function childPaths(parents, children) {
  if (!parents.length || !children.length) return null;

  const parentBottom = Math.max(...parents.map((parent) => parent.bottom));
  const childTop = Math.min(...children.map((child) => child.top));
  const originX = parents.reduce((sum, parent) => sum + parent.centerX, 0) / parents.length;
  const railY = Math.max(parentBottom + 12, parentBottom + (childTop - parentBottom) / 2);
  const childCenters = children.map((child) => child.centerX);
  const railStart = Math.min(originX, ...childCenters);
  const railEnd = Math.max(originX, ...childCenters);

  return {
    parent: `M ${originX} ${parentBottom} V ${railY}`,
    rail: `M ${railStart} ${railY} H ${railEnd}`,
    children: children.map((child) => `M ${child.centerX} ${railY} V ${child.top}`),
  };
}

export function GenerationRowFamilyTree({
  people,
  generationByPerson,
  widestGeneration,
  renderCard,
}) {
  const layoutRef = useRef(null);
  const [geometry, setGeometry] = useState({ width: 0, height: 0, partners: {}, children: {} });
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const rows = useMemo(
    () => orderedGenerationRows(people, generationByPerson),
    [generationByPerson, people],
  );
  const relationships = useMemo(
    () => familyRelationships(people, peopleById),
    [people, peopleById],
  );

  useLayoutEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return undefined;

    const measure = () => {
      if (!layout.offsetWidth || !layout.offsetHeight) return;

      const layoutRect = layout.getBoundingClientRect();
      const scaleX = layoutRect.width / layout.offsetWidth || 1;
      const scaleY = layoutRect.height / layout.offsetHeight || 1;
      const nodeById = new Map(
        [...layout.querySelectorAll("[data-person-id]")].map((node) => [
          node.dataset.personId,
          node,
        ]),
      );
      const rectFor = (personId) => {
        const node = nodeById.get(personId);
        return node ? relativeRect(node, layoutRect, scaleX, scaleY) : null;
      };

      const partners = Object.fromEntries(
        relationships.partnerPairs
          .map((pair) => {
            const first = rectFor(pair.personIds[0]);
            const second = rectFor(pair.personIds[1]);
            return first && second ? [pair.key, partnerPath(first, second)] : null;
          })
          .filter(Boolean),
      );
      const children = Object.fromEntries(
        relationships.childGroups
          .map((group) => {
            const parents = group.parentIds.map(rectFor).filter(Boolean);
            const childRects = group.childIds.map(rectFor).filter(Boolean);
            const paths = childPaths(parents, childRects);
            return paths ? [group.key, paths] : null;
          })
          .filter(Boolean),
      );

      setGeometry({ width: layout.offsetWidth, height: layout.offsetHeight, partners, children });
    };

    measure();
    const observer = globalThis.ResizeObserver ? new ResizeObserver(measure) : null;
    observer?.observe(layout);
    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [relationships]);

  return (
    <div className="family-generation-layout" ref={layoutRef}>
      <svg
        aria-hidden="true"
        className="family-generation-connectors"
        preserveAspectRatio="none"
        viewBox={`0 0 ${geometry.width || 1} ${geometry.height || 1}`}
      >
        {relationships.partnerPairs.map((pair) => {
          const path = geometry.partners[pair.key] || {};
          const annotation = partnerRelationshipAnnotation(pair.relationship);

          return (
            <g data-generation-partner-key={pair.key} key={pair.key}>
              <SvgPartnerRelationshipPath
                className="family-generation-partner-link"
                d={path.d || ""}
                relationship={pair.relationship}
              />
              {annotation && (
                <text
                  className="family-union-annotation svg-annotation"
                  x={path.annotationX || 0}
                  y={path.annotationY || 0}
                >
                  {annotation}
                </text>
              )}
            </g>
          );
        })}
        {relationships.childGroups.map((group) => {
          const paths = geometry.children[group.key] || {};

          return (
            <g data-generation-child-key={group.key} key={group.key}>
              <path className="family-generation-child-link" d={paths.parent || ""} />
              <path className="family-generation-child-link" d={paths.rail || ""} />
              {(paths.children || []).map((path, index) => (
                <path
                  className="family-generation-child-link"
                  d={path}
                  key={`${group.key}-${group.childIds[index] || index}`}
                />
              ))}
            </g>
          );
        })}
      </svg>
      {rows.map((row) => (
        <div
          className={`family-generation-row${
            row.generation === widestGeneration ? " widest-generation" : ""
          }`}
          data-generation={row.generation}
          key={row.generation}
        >
          {row.people.map((person) => (
            <div className="family-generation-person" key={person.id}>
              {renderCard(person)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
