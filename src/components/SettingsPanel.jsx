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
            <span className="settings-zoom">
              <input
                aria-label="Tree zoom"
                type="range"
                min="25"
                max="140"
                step="5"
                value={zoom}
                onChange={(event) => {
                  const nextZoom = Number(event.target.value);
                  onZoomChange(nextZoom);
                  update({ treeZoom: nextZoom });
                }}
              />
              <output>{zoom}%</output>
            </span>
          </label>

          <label className="settings-check">
            <span>Tree ownership</span>
            <span>
              <input
                type="checkbox"
                checked={settings.showOwnershipOnTree !== false}
                onChange={(event) => update({ showOwnershipOnTree: event.target.checked })}
              />
              Show shares on people
            </span>
          </label>
        </div>
      </section>
    </div>
  );
}
