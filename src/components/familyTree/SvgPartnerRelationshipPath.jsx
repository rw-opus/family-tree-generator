import { partnerRelationshipClass } from "./partnerRelationship.js";

/**
 * Draws only the partner portion of an SVG union connector. Marriage uses a
 * pair of solid rails; an unmarried partnership remains one dashed path.
 * Descendant connectors deliberately use their existing single-line paths.
 */
export function SvgPartnerRelationshipPath({ className, d, relationship }) {
  const relationshipClass = partnerRelationshipClass(relationship);

  if (relationshipClass === "partnership") {
    return <path className={`${className} partnership`} d={d} />;
  }

  return (
    <g className={`${className} marriage`} data-partner-relationship="marriage">
      <path className="family-svg-marriage-rail family-svg-marriage-outer" d={d} />
      <path className="family-svg-marriage-rail family-svg-marriage-gap" d={d} />
    </g>
  );
}
