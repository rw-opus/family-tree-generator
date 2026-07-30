import { useLayoutEffect, useMemo, useRef, useState } from "react";

export function MultiplePartnerHousehold({ anchor, groups, renderCard, renderChildren }) {
  const layoutRef = useRef(null);
  const [connectorGeometry, setConnectorGeometry] = useState({
    width: 0,
    height: 0,
    paths: [],
  });
  const orderedGroups = useMemo(
    () => [...groups].sort((first, second) => first.partnerName.localeCompare(second.partnerName)),
    [groups],
  );
  const leftCount = Math.floor(orderedGroups.length / 2);
  const positionedGroups = useMemo(
    () => [
      ...orderedGroups.slice(0, leftCount).map((group, sideIndex) => ({
        ...group,
        side: "left",
        sideIndex: leftCount - sideIndex - 1,
      })),
      ...orderedGroups.slice(leftCount).map((group, sideIndex) => ({
        ...group,
        side: "right",
        sideIndex,
      })),
    ],
    [leftCount, orderedGroups],
  );
  const railLevels = Math.max(leftCount, orderedGroups.length - leftCount) - 1;

  useLayoutEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return undefined;

    const measure = () => {
      const anchorNode = layout.querySelector(".family-multi-anchor-node > [data-person-id]");
      if (!anchorNode || !layout.offsetWidth || !layout.offsetHeight) return;

      const layoutRect = layout.getBoundingClientRect();
      const scaleX = layoutRect.width / layout.offsetWidth || 1;
      const scaleY = layoutRect.height / layout.offsetHeight || 1;
      const anchorRect = anchorNode.getBoundingClientRect();
      const anchorTop = (anchorRect.top - layoutRect.top) / scaleY;
      const anchorMiddle = anchorTop + anchorRect.height / scaleY / 2;
      const anchorLeft = (anchorRect.left - layoutRect.left) / scaleX;
      const anchorRight = anchorLeft + anchorRect.width / scaleX;
      const nextPaths = [];

      positionedGroups.forEach((group) => {
        const union = [...layout.querySelectorAll("[data-remarriage-key]")].find(
          (element) => element.dataset.remarriageKey === group.key,
        );
        const partnerNode = [...(union?.querySelectorAll("[data-person-id]") || [])].find(
          (element) => element.dataset.personId === group.partner.id,
        );
        if (!partnerNode) return;

        const partnerRect = partnerNode.getBoundingClientRect();
        const partnerTop = (partnerRect.top - layoutRect.top) / scaleY;
        const partnerMiddle = partnerTop + partnerRect.height / scaleY / 2;
        const partnerLeft = (partnerRect.left - layoutRect.left) / scaleX;
        const partnerRight = partnerLeft + partnerRect.width / scaleX;
        const startsOnLeft = group.side === "left";
        const startX = startsOnLeft ? anchorLeft : anchorRight;
        const endX = startsOnLeft ? partnerRight : partnerLeft;

        if (group.sideIndex === 0 && Math.abs(anchorMiddle - partnerMiddle) < 1) {
          nextPaths.push(`M ${startX} ${anchorMiddle} H ${endX}`);
          return;
        }

        const railY = Math.max(2, Math.min(anchorTop, partnerTop) - group.sideIndex * 14);
        nextPaths.push(`M ${startX} ${anchorMiddle} V ${railY} H ${endX} V ${partnerMiddle}`);
      });

      setConnectorGeometry({
        width: layout.offsetWidth,
        height: layout.offsetHeight,
        paths: nextPaths,
      });
    };

    measure();
    const observer = globalThis.ResizeObserver ? new ResizeObserver(measure) : null;
    observer?.observe(layout);
    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [positionedGroups]);

  return (
    <div
      className="family-remarriage-layout"
      ref={layoutRef}
      style={{ "--remarriage-rail-space": `${Math.max(0, railLevels) * 14}px` }}
    >
      <svg
        className="family-remarriage-connectors"
        aria-hidden="true"
        preserveAspectRatio="none"
        viewBox={`0 0 ${connectorGeometry.width || 1} ${connectorGeometry.height || 1}`}
      >
        {connectorGeometry.paths.map((path, index) => (
          <path className="family-remarriage-link" d={path} key={`${path}-${index}`} />
        ))}
      </svg>
      {positionedGroups.map((group, index) => {
        const order = index < leftCount ? index : index + 1;

        return (
          <div
            className={`family-union-block family-remarriage-union ${group.side}`}
            data-remarriage-key={group.key}
            key={group.key}
            style={{ order }}
          >
            <div className="family-parent-row single-parent">
              <span className="family-parent-node">{renderCard(group.partner)}</span>
            </div>
            {renderChildren(group.children)}
          </div>
        );
      })}
      <span className="family-multi-anchor-node" style={{ order: leftCount }}>
        {renderCard(anchor)}
      </span>
    </div>
  );
}
