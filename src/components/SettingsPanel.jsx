export function SettingsPanel({ settings, zoom, onChange, onZoomChange }) {
  const update = (patch) => onChange({ ...settings, ...patch });

  return (
    <div className="settings-panel">
      <section className="editor-panel compact-settings">
        <header>
          <p className="eyebrow">Workspace preferences</p>
          <h2>Settings</h2>
        </header>

        <div className="settings-rows">
          <label>
            <span>Inheritance shares</span>
            <select
              value={settings.shareDisplay || "both"}
              onChange={(event) => update({ shareDisplay: event.target.value })}
            >
              <option value="both">Fraction and percentage</option>
              <option value="fraction">Fractions only</option>
              <option value="percentage">Percentages only</option>
            </select>
          </label>

          <label>
            <span>Tree zoom</span>
            <select
              value={zoom}
              onChange={(event) => {
                const nextZoom = Number(event.target.value);
                onZoomChange(nextZoom);
                update({ treeZoom: nextZoom });
              }}
            >
              <option value="75">75%</option>
              <option value="90">90%</option>
              <option value="100">100%</option>
              <option value="110">110%</option>
              <option value="125">125%</option>
            </select>
          </label>

          <label className="settings-check">
            <span>Tree ownership</span>
            <span>
              <input
                type="checkbox"
                checked={settings.showOwnershipOnTree !== false}
                onChange={(event) =>
                  update({ showOwnershipOnTree: event.target.checked })
                }
              />
              Show shares on people
            </span>
          </label>
        </div>
      </section>
    </div>
  );
}
