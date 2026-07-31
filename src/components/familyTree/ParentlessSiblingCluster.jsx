import "./ParentlessSiblingCluster.css";

export function ParentlessSiblingCluster({ clusterKey, branches }) {
  return (
    <div className="family-parentless-sibling-cluster" data-sibling-cluster-key={clusterKey}>
      <div className="family-children-branch family-parentless-sibling-rail">
        {branches.map(({ personId, content, branchAnchorOffset }) => (
          <div
            className="family-child-branch-item family-parentless-sibling-item"
            data-sibling-person-id={personId}
            key={personId}
            style={{ "--branch-anchor-offset": `${branchAnchorOffset}px` }}
          >
            <span className="family-child-stem" aria-hidden="true" />
            {content}
          </div>
        ))}
      </div>
    </div>
  );
}
