import { describe, expect, it } from "vitest";
import { calculateA3Tiles } from "../../src/domain/a3PrintPreview.js";

describe("A3 print pagination", () => {
  it("keeps a small tree on one landscape A3 sheet", () => {
    const layout = calculateA3Tiles({
      contentWidth: 900,
      contentHeight: 600,
      viewportWidth: 1000,
      viewportHeight: 700,
      overlap: 100,
    });

    expect(layout).toMatchObject({
      columns: 1,
      rows: 1,
    });
    expect(layout.tiles).toEqual([
      expect.objectContaining({ index: 0, row: 0, column: 0, offsetX: 0, offsetY: 0 }),
    ]);
  });

  it("tiles a wide tree across adjoining sheets with repeated overlap", () => {
    const layout = calculateA3Tiles({
      contentWidth: 2700,
      contentHeight: 600,
      viewportWidth: 1000,
      viewportHeight: 700,
      overlap: 100,
    });

    expect(layout).toMatchObject({
      columns: 3,
      rows: 1,
      overlap: 100,
    });
    expect(layout.tiles.map(({ offsetX, offsetY }) => [offsetX, offsetY])).toEqual([
      [0, 0],
      [900, 0],
      [1800, 0],
    ]);
  });

  it("numbers a multi-row family tree in reading order", () => {
    const layout = calculateA3Tiles({
      contentWidth: 1800,
      contentHeight: 1350,
      viewportWidth: 1000,
      viewportHeight: 700,
      overlap: 100,
    });

    expect(layout).toMatchObject({
      columns: 2,
      rows: 3,
    });
    expect(layout.tiles).toHaveLength(6);
    expect(layout.tiles.at(-1)).toMatchObject({
      index: 5,
      row: 2,
      column: 1,
      offsetX: 900,
      offsetY: 1200,
    });
  });

  it("allows a reduced tree scale to use fewer A3 sheets", () => {
    const fullSize = calculateA3Tiles({
      contentWidth: 1800,
      contentHeight: 600,
      scale: 1,
      viewportWidth: 1000,
      viewportHeight: 700,
      overlap: 100,
    });
    const reduced = calculateA3Tiles({
      contentWidth: 1800,
      contentHeight: 600,
      scale: 0.5,
      viewportWidth: 1000,
      viewportHeight: 700,
      overlap: 100,
    });

    expect(fullSize.tiles).toHaveLength(2);
    expect(reduced.tiles).toHaveLength(1);
  });
});
