import { describe, expect, it } from "vitest";
import {
  A3_MIN_COMPACT_SCALE,
  A3_PRINT_LAYOUT,
  A3_PRINT_VIEWPORT_HEIGHT_PX,
  a3PrintableWidthForColumns,
  calculateA3Tiles,
  calculateA3VerticalPages,
  resolveA3HeightScale,
  resolveA3PreviewScale,
  resolveA3PrintArea,
} from "../../src/domain/a3PrintPreview.js";
import { buildFamilyTreeLayout } from "../../src/components/familyTree/treeLayout.js";

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

  it("uses a two-centimetre overlap for adjoining A3 sheets", () => {
    expect(A3_PRINT_LAYOUT.overlapMm).toBe(20);

    const expectedOverlapPx = (20 * 96) / 25.4;
    const layout = calculateA3Tiles({
      contentWidth: 2000,
      contentHeight: 600,
      viewportWidth: 1000,
      viewportHeight: 700,
    });

    expect(layout.overlap).toBeCloseTo(expectedOverlapPx);
    expect(layout.tiles[1].offsetX).toBeCloseTo(1000 - expectedOverlapPx);
    expect(a3PrintableWidthForColumns(2)).toBeCloseTo(2 * ((410 * 96) / 25.4) - expectedOverlapPx);
  });

  it("breaks a tall tree between measured generation rows", () => {
    const pages = calculateA3VerticalPages({
      contentHeight: 1500,
      scale: 1,
      viewportHeight: 700,
      overlap: 100,
      generationBands: [
        { generation: 0, top: 20, bottom: 220 },
        { generation: 1, top: 360, bottom: 620 },
        { generation: 2, top: 820, bottom: 1080 },
        { generation: 3, top: 1240, bottom: 1480 },
      ],
    });

    expect(pages[0]).toMatchObject({
      offsetY: 0,
      clipHeight: 700,
      breakAfterGeneration: 1,
    });
    expect(pages[1].offsetY).toBe(600);
    expect(pages[1].breakAfterGeneration).toBe(2);
  });

  it("keeps page boundaries inside generation gaps rather than on card borders", () => {
    const pages = calculateA3VerticalPages({
      contentHeight: 1200,
      viewportHeight: 700,
      overlap: 100,
      generationBands: [
        { generation: 0, top: 0, bottom: 260 },
        { generation: 1, top: 400, bottom: 760 },
        { generation: 2, top: 920, bottom: 1200 },
      ],
    });

    expect(pages[0].clipHeight).toBe(399);
    expect(pages[0].breakAfterGeneration).toBe(0);
    expect(pages[1].offsetY).toBe(299);
  });

  it("fits a tree to a user-selected one- or two-sheet print width", () => {
    expect(
      resolveA3PrintArea({
        contentWidth: 1800,
        preferredScale: 1,
        requestedColumns: "1",
        viewportWidth: 1000,
        overlap: 100,
      }),
    ).toMatchObject({ scale: 0.7, requestedColumns: 1, limitedByMinimumScale: true });

    expect(
      resolveA3PrintArea({
        contentWidth: 1800,
        preferredScale: 1,
        requestedColumns: "2",
        viewportWidth: 1000,
        overlap: 100,
      }),
    ).toMatchObject({ scale: 1, requestedColumns: 2, limitedByMinimumScale: false });
  });

  it("never shrinks below the minimum readable print scale", () => {
    const printArea = resolveA3PrintArea({
      contentWidth: 5000,
      preferredScale: 1,
      requestedColumns: "2",
      viewportWidth: 1000,
      overlap: 100,
    });
    const layout = calculateA3Tiles({
      contentWidth: 5000,
      contentHeight: 600,
      scale: printArea.scale,
      viewportWidth: 1000,
      viewportHeight: 700,
      overlap: 100,
    });

    expect(printArea).toMatchObject({ scale: 0.7, limitedByMinimumScale: true });
    expect(layout.columns).toBeGreaterThan(2);
  });

  it("leaves the selected tree scale unchanged when print width is automatic", () => {
    expect(
      resolveA3PrintArea({
        contentWidth: 5000,
        preferredScale: 0.85,
        requestedColumns: "auto",
      }),
    ).toMatchObject({ scale: 0.85, requestedColumns: 0, limitedByMinimumScale: false });
  });

  it("honours a compact sheet-width choice after height fitting", () => {
    const printArea = resolveA3PrintArea({
      contentWidth: 9000,
      preferredScale: 0.5,
      requestedColumns: "2",
      minimumScale: A3_MIN_COMPACT_SCALE,
    });
    const layout = calculateA3Tiles({
      contentWidth: 9000,
      contentHeight: 1800,
      scale: printArea.scale,
    });

    expect(printArea.scale).toBeGreaterThanOrEqual(A3_MIN_COMPACT_SCALE);
    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(1);
  });
});

describe("A3 landscape height fitting", () => {
  const generationChain = (count) =>
    Array.from({ length: count }, (_, index) => ({
      id: `p${index}`,
      fullName: `Person ${index}`,
      fatherId: index > 0 ? `p${index - 1}` : "",
      motherId: "",
      spouseIds: [],
      siblingIds: [],
    }));

  it("leaves a short tree at its preferred scale", () => {
    const fit = resolveA3HeightScale({ contentHeight: 400, preferredScale: 1 });

    expect(fit.scale).toBe(1);
    expect(fit.fitsAtPreferredScale).toBe(true);
  });

  it("scales a tall tree down to one sheet of height", () => {
    const fit = resolveA3HeightScale({ contentHeight: 4000, preferredScale: 1 });

    expect(fit.fitsAtPreferredScale).toBe(false);
    expect(4000 * fit.scale).toBeLessThanOrEqual(A3_PRINT_VIEWPORT_HEIGHT_PX + 0.001);
  });

  it("never scales a tree up beyond the requested scale", () => {
    expect(resolveA3HeightScale({ contentHeight: 100, preferredScale: 0.7 }).scale).toBe(0.7);
  });

  it("puts ten generations on a single row of landscape A3 sheets", () => {
    const layout = buildFamilyTreeLayout(generationChain(10));
    expect(layout.generationCount).toBe(10);

    const fit = resolveA3HeightScale({ contentHeight: layout.height, preferredScale: 1 });
    const tiles = calculateA3Tiles({
      contentWidth: layout.width,
      contentHeight: layout.height,
      scale: fit.scale,
    });

    // Height is what must not break: a tree is read down the generations.
    expect(tiles.rows).toBe(1);
  });

  it("still splits a very deep tree across sheets when height fitting is off", () => {
    const layout = buildFamilyTreeLayout(generationChain(10));
    const tiles = calculateA3Tiles({
      contentWidth: layout.width,
      contentHeight: layout.height,
      scale: 1,
    });

    expect(tiles.rows).toBeGreaterThan(1);
  });

  it("applies the user's tree size after height fitting", () => {
    const full = resolveA3PreviewScale({
      contentWidth: 9000,
      contentHeight: 1800,
      sizeFactor: 1,
    });
    const medium = resolveA3PreviewScale({
      contentWidth: 9000,
      contentHeight: 1800,
      sizeFactor: 0.85,
    });
    const compact = resolveA3PreviewScale({
      contentWidth: 9000,
      contentHeight: 1800,
      sizeFactor: 0.7,
    });

    expect(medium.scale).toBeCloseTo(full.scale * 0.85);
    expect(compact.scale).toBeCloseTo(full.scale * 0.7);
    expect(full.scale).toBeGreaterThan(medium.scale);
    expect(medium.scale).toBeGreaterThan(compact.scale);
  });

  it("lets the print-area width reduce a height-fitted wide tree", () => {
    const automatic = resolveA3PreviewScale({
      contentWidth: 9000,
      contentHeight: 1800,
      requestedColumns: "auto",
    });
    const twoSheetsWide = resolveA3PreviewScale({
      contentWidth: 9000,
      contentHeight: 1800,
      requestedColumns: "2",
    });

    expect(twoSheetsWide.scale).toBeLessThan(automatic.scale);
    expect(
      calculateA3Tiles({
        contentWidth: 9000,
        contentHeight: 1800,
        scale: twoSheetsWide.scale,
      }).columns,
    ).toBe(2);
  });
});
