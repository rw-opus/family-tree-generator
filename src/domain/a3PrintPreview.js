const MM_TO_CSS_PX = 96 / 25.4;

const mmToPixels = (millimetres) => millimetres * MM_TO_CSS_PX;

export const A3_PRINT_LAYOUT = Object.freeze({
  orientation: "landscape",
  pageWidthMm: 400,
  pageHeightMm: 277,
  treeWidthMm: 390,
  treeHeightMm: 249,
  overlapMm: 20,
});

export const A3_PRINT_VIEWPORT_WIDTH_PX = mmToPixels(A3_PRINT_LAYOUT.treeWidthMm);
export const A3_PRINT_VIEWPORT_HEIGHT_PX = mmToPixels(A3_PRINT_LAYOUT.treeHeightMm);
export const A3_PRINT_OVERLAP_PX = mmToPixels(A3_PRINT_LAYOUT.overlapMm);

const defaultViewportWidth = A3_PRINT_VIEWPORT_WIDTH_PX;
const defaultViewportHeight = A3_PRINT_VIEWPORT_HEIGHT_PX;
const defaultOverlap = A3_PRINT_OVERLAP_PX;

export const A3_MIN_READABLE_SCALE = 0.7;

export function a3PrintableWidthForColumns(
  columns,
  { viewportWidth = defaultViewportWidth, overlap = defaultOverlap } = {},
) {
  const columnCount = Math.max(1, Number.parseInt(columns, 10) || 1);
  const pageWidth = positiveNumber(viewportWidth, defaultViewportWidth);
  const sharedEdge = Math.min(positiveNumber(overlap, defaultOverlap), pageWidth / 3);
  return pageWidth + (columnCount - 1) * (pageWidth - sharedEdge);
}

const positiveNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

export function calculateA3Tiles({
  contentWidth,
  contentHeight,
  scale = 1,
  viewportWidth = defaultViewportWidth,
  viewportHeight = defaultViewportHeight,
  overlap = defaultOverlap,
}) {
  const width = positiveNumber(contentWidth, 1);
  const height = positiveNumber(contentHeight, 1);
  const printScale = positiveNumber(scale, 1);
  const pageWidth = positiveNumber(viewportWidth, defaultViewportWidth);
  const pageHeight = positiveNumber(viewportHeight, defaultViewportHeight);
  const sharedEdge = Math.min(
    positiveNumber(overlap, defaultOverlap),
    pageWidth / 3,
    pageHeight / 3,
  );
  const horizontalAdvance = Math.max(1, pageWidth - sharedEdge);
  const verticalAdvance = Math.max(1, pageHeight - sharedEdge);
  const scaledWidth = width * printScale;
  const scaledHeight = height * printScale;
  const columns =
    scaledWidth <= pageWidth ? 1 : Math.ceil((scaledWidth - sharedEdge) / horizontalAdvance);
  const rows =
    scaledHeight <= pageHeight ? 1 : Math.ceil((scaledHeight - sharedEdge) / verticalAdvance);
  const tiles = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      tiles.push({
        index: tiles.length,
        row,
        column,
        offsetX: column * horizontalAdvance,
        offsetY: row * verticalAdvance,
      });
    }
  }

  return {
    columns,
    rows,
    scale: printScale,
    scaledWidth,
    scaledHeight,
    viewportWidth: pageWidth,
    viewportHeight: pageHeight,
    overlap: sharedEdge,
    tiles,
  };
}

export function resolveA3PrintArea({
  contentWidth,
  preferredScale = 1,
  requestedColumns = "auto",
  viewportWidth = defaultViewportWidth,
  overlap = defaultOverlap,
  minimumScale = A3_MIN_READABLE_SCALE,
}) {
  const width = positiveNumber(contentWidth, 1);
  const preferred = positiveNumber(preferredScale, 1);
  const minimum = Math.min(preferred, positiveNumber(minimumScale, A3_MIN_READABLE_SCALE));
  const pageWidth = positiveNumber(viewportWidth, defaultViewportWidth);
  const sharedEdge = Math.min(positiveNumber(overlap, defaultOverlap), pageWidth / 3);
  const columnCount = Number.parseInt(requestedColumns, 10);

  if (!Number.isFinite(columnCount) || columnCount < 1) {
    return {
      scale: preferred,
      requestedColumns: 0,
      targetWidth: 0,
      limitedByMinimumScale: false,
    };
  }

  const targetWidth = a3PrintableWidthForColumns(columnCount, {
    viewportWidth: pageWidth,
    overlap: sharedEdge,
  });
  const scaleNeeded = targetWidth / width;
  const scale = Math.min(preferred, Math.max(minimum, scaleNeeded));

  return {
    scale,
    requestedColumns: columnCount,
    targetWidth,
    limitedByMinimumScale: scaleNeeded < minimum,
  };
}

/**
 * Scale that lands the whole tree inside one sheet's height.
 *
 * resolveA3PrintArea only ever fitted width, so a tall tree was tiled onto a
 * second row of sheets instead of being scaled down. A family tree is read down
 * the generations, so breaking it across sheets vertically is far worse than
 * printing it a little smaller.
 */
export function resolveA3HeightScale({
  contentHeight,
  preferredScale = 1,
  viewportHeight = defaultViewportHeight,
}) {
  const height = positiveNumber(contentHeight, 1);
  const preferred = positiveNumber(preferredScale, 1);
  const pageHeight = positiveNumber(viewportHeight, defaultViewportHeight);
  // Half a pixel of headroom: an exact fit rounds a hair over the page in
  // floating point and tips the tree onto a second row of sheets.
  const scaleNeeded = Math.max(0, pageHeight - 0.5) / height;

  return {
    scale: Math.min(preferred, scaleNeeded),
    fitsAtPreferredScale: height * preferred <= pageHeight,
  };
}

const previewCss = `
  :root {
    color: #10231c;
    background: #e8ece9;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: #e8ece9;
  }

  .a3-preview-toolbar {
    position: sticky;
    z-index: 100;
    top: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 64px;
    border-bottom: 1px solid #cbd6d0;
    background: rgba(255, 255, 255, 0.97);
    padding: 10px 16px;
    box-shadow: 0 5px 18px rgba(18, 48, 36, 0.1);
  }

  .a3-preview-heading {
    display: grid;
    flex: 1;
    gap: 2px;
    min-width: 180px;
  }

  .a3-preview-heading strong {
    color: #10231c;
    font-size: 15px;
  }

  .a3-preview-heading span,
  .a3-preview-toolbar label {
    color: #65756e;
    font-size: 11px;
    font-weight: 700;
  }

  .a3-preview-toolbar label {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .a3-preview-toolbar select,
  .a3-preview-toolbar button {
    min-height: 36px;
    border: 1px solid #9eb9aa;
    border-radius: 7px;
    background: #fff;
    color: #004225;
    padding: 0 11px;
    font: 700 12px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .a3-preview-toolbar button[data-action="print"] {
    border-color: #004225;
    background: #004225;
    color: #fff;
  }

  .a3-preview-pages {
    display: grid;
    justify-items: center;
    gap: 24px;
    padding: 24px 16px 40px;
  }

  .a3-page-shell {
    position: relative;
    break-after: page;
    page-break-after: always;
  }

  .a3-page-shell:last-child {
    break-after: auto;
    page-break-after: auto;
  }

  .a3-page {
    position: absolute;
    top: 0;
    left: 0;
    display: grid;
    grid-template-rows: 10mm 249mm 8mm;
    width: 400mm;
    height: 277mm;
    overflow: hidden;
    background: #fff;
    padding: 5mm;
    transform-origin: top left;
    box-shadow: 0 10px 34px rgba(15, 35, 25, 0.2);
  }

  .a3-page-header,
  .a3-page-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8mm;
    color: #42564b;
    font-size: 9pt;
  }

  .a3-page-header strong {
    overflow: hidden;
    color: #163c2b;
    font-size: 12pt;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .a3-page-footer {
    align-items: end;
    color: #65756e;
    font-size: 8pt;
  }

  .a3-tree-viewport {
    position: relative;
    width: 390mm;
    height: 249mm;
    overflow: hidden;
    border: 0.25mm solid #d7dfda;
    background: #fff;
  }

  .a3-print-tree {
    position: absolute !important;
    top: 0;
    left: 0;
    min-width: 0 !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    zoom: 1 !important;
    transform-origin: top left;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }

  .a3-print-tree .layered-family-tree {
    margin: 0 !important;
  }

  .a3-print-tree .family-chart-title {
    display: none !important;
  }

  .a3-print-tree .family-node.selected {
    box-shadow: 0 4px 14px rgba(28, 52, 40, 0.11) !important;
    transform: none !important;
  }

  .a3-print-tree .family-node.selected::after {
    display: none !important;
  }

  .a3-measure {
    position: fixed;
    top: 0;
    left: -100000px;
    width: max-content !important;
    height: max-content !important;
    overflow: visible !important;
    background: #fff;
    pointer-events: none;
  }

  .a3-measure .family-chart {
    width: max-content !important;
    height: max-content !important;
    min-width: 0 !important;
    min-height: 0 !important;
    overflow: visible !important;
  }

  .a3-measure .family-canvas {
    position: static !important;
    width: max-content !important;
    height: max-content !important;
    min-height: 0 !important;
    margin: 0 !important;
    zoom: 1 !important;
  }

  @media (max-width: 680px) {
    .a3-preview-toolbar {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .a3-preview-heading {
      grid-column: 1 / -1;
    }

    .a3-preview-toolbar label {
      grid-column: 1 / -1;
    }
  }

  @page {
    size: A3 landscape;
    margin: 10mm;
  }

  @media print {
    :root,
    body {
      background: #fff !important;
    }

    .a3-preview-toolbar {
      display: none !important;
    }

    .a3-preview-pages {
      display: block;
      padding: 0;
    }

    .a3-page-shell {
      width: 400mm !important;
      height: 277mm !important;
      margin: 0 !important;
    }

    .a3-page {
      position: relative;
      width: 400mm;
      height: 277mm;
      margin: 0;
      transform: none !important;
      box-shadow: none;
    }
  }
`;

const copyApplicationStyles = (sourceDocument, targetDocument) => {
  sourceDocument.querySelectorAll('link[rel="stylesheet"]').forEach((sourceLink) => {
    const link = targetDocument.createElement("link");
    link.rel = "stylesheet";
    link.href = sourceLink.href;
    targetDocument.head.append(link);
  });

  sourceDocument.querySelectorAll("style").forEach((sourceStyle) => {
    const style = targetDocument.createElement("style");
    style.textContent = sourceStyle.textContent;
    targetDocument.head.append(style);
  });
};

const waitForPreviewStyles = async (previewWindow) => {
  const links = [...previewWindow.document.querySelectorAll('link[rel="stylesheet"]')];
  await Promise.all(
    links.map(
      (link) =>
        new Promise((resolve) => {
          if (link.sheet) {
            resolve();
            return;
          }
          const finish = () => resolve();
          link.addEventListener("load", finish, { once: true });
          link.addEventListener("error", finish, { once: true });
          previewWindow.setTimeout(finish, 1500);
        }),
    ),
  );
  await previewWindow.document.fonts?.ready;
};

const makeElement = (document, tagName, className, text) => {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const cleanTreeClone = (tree) => {
  tree.querySelectorAll(".selected").forEach((element) => {
    element.classList.remove("selected");
    element.removeAttribute("aria-current");
  });
  tree.classList.add("a3-print-tree");
  return tree;
};

const measurePrintableTree = (sourceCanvas, previewDocument) => {
  const measure = makeElement(previewDocument, "div", "tree-stage a3-measure");
  const chart = makeElement(previewDocument, "div", "family-chart");
  const tree = cleanTreeClone(sourceCanvas.cloneNode(true));
  chart.append(tree);
  measure.append(chart);
  previewDocument.body.append(measure);

  const bounds = tree.getBoundingClientRect();
  const result = {
    width: Math.max(1, Math.ceil(tree.scrollWidth || bounds.width)),
    height: Math.max(1, Math.ceil(tree.scrollHeight || bounds.height)),
  };
  measure.remove();
  return result;
};

const createPage = ({ document, sourceCanvas, title, tile, layout, pageNumber, pageCount }) => {
  const shell = makeElement(document, "section", "a3-page-shell");
  const page = makeElement(document, "article", "a3-page");
  const header = makeElement(document, "header", "a3-page-header");
  const heading = makeElement(document, "strong", "", title);
  const pagePosition = makeElement(
    document,
    "span",
    "",
    `Page ${pageNumber} of ${pageCount} · Column ${tile.column + 1}/${layout.columns} · Row ${
      tile.row + 1
    }/${layout.rows}`,
  );
  const viewport = makeElement(document, "div", "tree-stage a3-tree-viewport");
  const tree = cleanTreeClone(sourceCanvas.cloneNode(true));
  const footer = makeElement(document, "footer", "a3-page-footer");
  const overlapNote = makeElement(
    document,
    "span",
    "",
    layout.tiles.length > 1
      ? `${A3_PRINT_LAYOUT.overlapMm} mm overlap is repeated on adjoining sheets`
      : "A3 landscape · actual size",
  );
  const sheetNumber = makeElement(document, "span", "", `${pageNumber} / ${pageCount}`);
  const centreX =
    layout.scaledWidth < layout.viewportWidth ? (layout.viewportWidth - layout.scaledWidth) / 2 : 0;
  const centreY =
    layout.scaledHeight < layout.viewportHeight
      ? (layout.viewportHeight - layout.scaledHeight) / 2
      : 0;

  tree.style.transform = `translate(${centreX - tile.offsetX}px, ${
    centreY - tile.offsetY
  }px) scale(${layout.scale})`;
  header.append(heading, pagePosition);
  viewport.append(tree);
  footer.append(overlapNote, sheetNumber);
  page.append(header, viewport, footer);
  shell.append(page);
  return shell;
};

const applyScreenPageScale = (previewWindow) => {
  const availableWidth = Math.max(280, previewWindow.innerWidth - 32);
  const fullPageWidth = mmToPixels(A3_PRINT_LAYOUT.pageWidthMm);
  const fullPageHeight = mmToPixels(A3_PRINT_LAYOUT.pageHeightMm);
  const screenScale = Math.min(1, availableWidth / fullPageWidth);

  previewWindow.document.querySelectorAll(".a3-page-shell").forEach((shell) => {
    shell.style.width = `${fullPageWidth * screenScale}px`;
    shell.style.height = `${fullPageHeight * screenScale}px`;
    shell.querySelector(".a3-page").style.transform = `scale(${screenScale})`;
  });
};

export async function openA3PrintPreview(node, title = "Family tree") {
  if (!node) return false;

  const previewWindow = window.open("", "_blank");
  if (!previewWindow) {
    window.alert(
      "The browser blocked the print preview. Allow pop-ups for this site and try again.",
    );
    return false;
  }

  previewWindow.opener = null;
  previewWindow.document.open();
  previewWindow.document.write(
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>A3 family tree print preview</title></head><body></body></html>',
  );
  previewWindow.document.close();
  copyApplicationStyles(document, previewWindow.document);
  const style = previewWindow.document.createElement("style");
  style.textContent = previewCss;
  previewWindow.document.head.append(style);

  const sourceCanvas = node.querySelector(".family-canvas") || node;
  const toolbar = makeElement(previewWindow.document, "header", "a3-preview-toolbar");
  const heading = makeElement(previewWindow.document, "div", "a3-preview-heading");
  const headingTitle = makeElement(previewWindow.document, "strong", "", "A3 print preview");
  const headingHelp = makeElement(
    previewWindow.document,
    "span",
    "",
    "Landscape A3 · print at 100% / actual size · disable browser headers and footers",
  );
  const scaleLabel = makeElement(previewWindow.document, "label", "");
  const scaleText = makeElement(previewWindow.document, "span", "", "Tree scale");
  const scaleSelect = makeElement(previewWindow.document, "select", "");
  const areaLabel = makeElement(previewWindow.document, "label", "");
  const areaText = makeElement(previewWindow.document, "span", "", "Print area width");
  const areaSelect = makeElement(previewWindow.document, "select", "");
  const heightLabel = makeElement(previewWindow.document, "label", "");
  const heightText = makeElement(previewWindow.document, "span", "", "Sheet height");
  const heightSelect = makeElement(previewWindow.document, "select", "");
  const printButton = makeElement(previewWindow.document, "button", "", "Print all A3 pages");
  const closeButton = makeElement(previewWindow.document, "button", "", "Close");
  const pages = makeElement(previewWindow.document, "main", "a3-preview-pages");

  [
    ["1", "100% · most readable"],
    ["0.85", "85% · fewer sheets"],
    ["0.7", "70% · compact"],
  ].forEach(([value, label]) => {
    const option = makeElement(previewWindow.document, "option", "", label);
    option.value = value;
    scaleSelect.append(option);
  });

  [
    ["auto", "Automatic"],
    ["1", "1 A3 sheet wide"],
    ["2", "2 A3 sheets wide"],
  ].forEach(([value, label]) => {
    const option = makeElement(previewWindow.document, "option", "", label);
    option.value = value;
    areaSelect.append(option);
  });

  [
    ["fit", "Fit all generations on one sheet"],
    ["actual", "Actual size · split across sheets"],
  ].forEach(([value, label]) => {
    const option = makeElement(previewWindow.document, "option", "", label);
    option.value = value;
    heightSelect.append(option);
  });

  heading.append(headingTitle, headingHelp);
  scaleLabel.append(scaleText, scaleSelect);
  areaLabel.append(areaText, areaSelect);
  heightLabel.append(heightText, heightSelect);
  printButton.type = "button";
  printButton.dataset.action = "print";
  closeButton.type = "button";
  toolbar.append(heading, scaleLabel, areaLabel, heightLabel, printButton, closeButton);
  previewWindow.document.body.append(toolbar, pages);

  await waitForPreviewStyles(previewWindow);
  const dimensions = measurePrintableTree(sourceCanvas, previewWindow.document);
  const renderPages = () => {
    const printArea = resolveA3PrintArea({
      contentWidth: dimensions.width,
      preferredScale: scaleSelect.value,
      requestedColumns: areaSelect.value,
    });
    // Height is fitted after width, so a tall tree is scaled onto a single row
    // of sheets rather than being cut across two.
    const heightFit =
      heightSelect.value === "fit"
        ? resolveA3HeightScale({
            contentHeight: dimensions.height,
            preferredScale: printArea.scale,
          })
        : { scale: printArea.scale, fitsAtPreferredScale: true };
    const layout = calculateA3Tiles({
      contentWidth: dimensions.width,
      contentHeight: dimensions.height,
      scale: heightFit.scale,
    });
    pages.replaceChildren(
      ...layout.tiles.map((tile, index) =>
        createPage({
          document: previewWindow.document,
          sourceCanvas,
          title,
          tile,
          layout,
          pageNumber: index + 1,
          pageCount: layout.tiles.length,
        }),
      ),
    );
    const minimumScaleNote =
      printArea.requestedColumns && layout.columns > printArea.requestedColumns
        ? ` · minimum ${Math.round(A3_MIN_READABLE_SCALE * 100)}% readability requires ${layout.columns} sheets wide`
        : "";
    headingHelp.textContent = `A3 landscape · ${layout.tiles.length} ${
      layout.tiles.length === 1 ? "sheet" : "sheets"
    } · tree at ${Math.round(layout.scale * 100)}%${minimumScaleNote} · ${A3_PRINT_LAYOUT.overlapMm} mm overlap · print at 100% / actual size · disable browser headers and footers`;
    applyScreenPageScale(previewWindow);
  };

  scaleSelect.addEventListener("change", renderPages);
  areaSelect.addEventListener("change", renderPages);
  heightSelect.addEventListener("change", renderPages);
  printButton.addEventListener("click", () => {
    previewWindow.focus();
    previewWindow.print();
  });
  closeButton.addEventListener("click", () => previewWindow.close());
  previewWindow.addEventListener("resize", () => applyScreenPageScale(previewWindow));
  renderPages();
  previewWindow.focus();
  return true;
}
