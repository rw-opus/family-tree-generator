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
        </div>
      </section>
    </div>
  );
}
