const MM_TO_CSS_PX = 96 / 25.4;

const mmToPixels = (millimetres) => millimetres * MM_TO_CSS_PX;

export const A3_PRINT_LAYOUT = Object.freeze({
  orientation: "landscape",
  pageWidthMm: 420,
  pageHeightMm: 297,
  treeWidthMm: 410,
  treeHeightMm: 269,
  overlapMm: 20,
});

export const A3_PRINT_VIEWPORT_WIDTH_PX = mmToPixels(A3_PRINT_LAYOUT.treeWidthMm);
export const A3_PRINT_VIEWPORT_HEIGHT_PX = mmToPixels(A3_PRINT_LAYOUT.treeHeightMm);
export const A3_PRINT_OVERLAP_PX = mmToPixels(A3_PRINT_LAYOUT.overlapMm);

const defaultViewportWidth = A3_PRINT_VIEWPORT_WIDTH_PX;
const defaultViewportHeight = A3_PRINT_VIEWPORT_HEIGHT_PX;
const defaultOverlap = A3_PRINT_OVERLAP_PX;

export const A3_MIN_READABLE_SCALE = 0.7;
export const A3_MIN_COMPACT_SCALE = 0.25;

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
  generationBands = [],
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
  const scaledWidth = width * printScale;
  const scaledHeight = height * printScale;
  const columns =
    scaledWidth <= pageWidth ? 1 : Math.ceil((scaledWidth - sharedEdge) / horizontalAdvance);
  const verticalPages = calculateA3VerticalPages({
    contentHeight: height,
    scale: printScale,
    viewportHeight: pageHeight,
    overlap: sharedEdge,
    generationBands,
  });
  const rows = verticalPages.length;
  const tiles = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const verticalPage = verticalPages[row];
      tiles.push({
        index: tiles.length,
        row,
        column,
        offsetX: column * horizontalAdvance,
        offsetY: verticalPage.offsetY,
        clipHeight: verticalPage.clipHeight,
        breakAfterGeneration: verticalPage.breakAfterGeneration,
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

/**
 * Produces vertical page slices whose lower edge falls in the gap between two
 * measured generations whenever possible. The next page retains the requested
 * assembly overlap without deliberately cutting a person's card in two.
 */
export function calculateA3VerticalPages({
  contentHeight,
  scale = 1,
  viewportHeight = defaultViewportHeight,
  overlap = defaultOverlap,
  generationBands = [],
}) {
  const printScale = positiveNumber(scale, 1);
  const height = positiveNumber(contentHeight, 1) * printScale;
  const pageHeight = positiveNumber(viewportHeight, defaultViewportHeight);
  const sharedEdge = Math.min(positiveNumber(overlap, defaultOverlap), pageHeight / 3);
  if (height <= pageHeight) {
    return [{ offsetY: 0, clipHeight: pageHeight, breakAfterGeneration: null }];
  }

  const bands = generationBands
    .map((band) => ({
      generation: Number(band.generation),
      top: Math.max(0, Number(band.top) || 0) * printScale,
      bottom: Math.max(0, Number(band.bottom) || 0) * printScale,
    }))
    .filter((band) => band.bottom > band.top)
    .sort((left, right) => left.top - right.top || left.generation - right.generation);
  const safeGaps = bands.slice(0, -1).map((band, index) => ({
    start: band.bottom + 1,
    end: Math.max(band.bottom + 1, bands[index + 1].top - 1),
    generation: band.generation,
  }));
  const pages = [];
  let offsetY = 0;
  let guard = 0;

  while (offsetY < height - 0.5 && guard < 1000) {
    guard += 1;
    const maximumEnd = offsetY + pageHeight;
    if (maximumEnd >= height - 0.5) {
      pages.push({ offsetY, clipHeight: pageHeight, breakAfterGeneration: null });
      break;
    }

    const minimumUsefulEnd = offsetY + Math.max(1, sharedEdge * 1.25);
    const rowGap = [...safeGaps]
      .reverse()
      .find((candidate) => candidate.start < maximumEnd && candidate.end > minimumUsefulEnd);
    const end = rowGap ? Math.min(maximumEnd, rowGap.end) : maximumEnd;
    pages.push({
      offsetY,
      clipHeight: Math.min(pageHeight, Math.max(1, end - offsetY)),
      breakAfterGeneration: rowGap?.generation ?? null,
    });
    offsetY = Math.max(offsetY + 1, end - sharedEdge);
  }

  return pages;
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

/**
 * Resolves the automatic page fit before applying the user's size choice.
 *
 * Applying the size first allowed height fitting to overwrite it completely:
 * a tall tree rendered at exactly the same 55% whether 100%, 85%, or 70% was
 * selected. The size selector is deliberately the last step so each option has
 * a visible and predictable effect.
 */
export function resolveA3PreviewScale({
  contentWidth,
  contentHeight,
  sizeFactor = 1,
  requestedColumns = "auto",
  fitHeight = true,
  viewportWidth = defaultViewportWidth,
  viewportHeight = defaultViewportHeight,
  overlap = defaultOverlap,
}) {
  const requestedSize = positiveNumber(sizeFactor, 1);
  const heightFit = fitHeight
    ? resolveA3HeightScale({
        contentHeight,
        preferredScale: 1,
        viewportHeight,
      })
    : { scale: 1, fitsAtPreferredScale: true };
  const minimumScale = fitHeight ? A3_MIN_COMPACT_SCALE : A3_MIN_READABLE_SCALE;
  const printArea = resolveA3PrintArea({
    contentWidth,
    preferredScale: heightFit.scale,
    requestedColumns,
    viewportWidth,
    overlap,
    minimumScale,
  });

  return {
    ...printArea,
    scale: printArea.scale * requestedSize,
    fittedScale: printArea.scale,
    sizeFactor: requestedSize,
    minimumScale,
    fitsAtPreferredHeight: heightFit.fitsAtPreferredScale,
  };
}

const previewCss = `
  :root {
    color: #10231c;
    background: #e8ece9;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  * { box-sizing: border-box; }

  html {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  body {
    display: flex;
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: #e8ece9;
    flex-direction: column;
  }

  .a3-preview-toolbar {
    position: relative;
    z-index: 100;
    flex: 0 0 auto;
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

  .a3-preview-scroll {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
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

  .a3-preview-toolbar input[type="range"],
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

  .a3-preview-toolbar input[type="range"] {
    width: min(260px, 34vw);
    min-height: 28px;
    border: 0;
    padding: 0;
    accent-color: #004225;
  }

  .a3-scale-output {
    min-width: 44px;
    color: #004225;
    font-size: 12px;
    font-weight: 800;
    text-align: right;
  }

  .a3-preview-pages {
    display: grid;
    align-content: start;
    justify-items: center;
    gap: 24px;
    min-height: max-content;
    overflow: visible;
    padding: 24px 16px 40px;
  }

  .a3-page-shell {
    position: relative;
    display: block;
    flex: none;
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
    grid-template-rows: 10mm 269mm 8mm;
    width: 420mm;
    height: 297mm;
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
    width: 410mm;
    height: 269mm;
    overflow: hidden;
    border: 0.25mm solid #d7dfda;
    background: #fff;
  }

  .a3-tree-clip {
    position: relative;
    width: 100%;
    overflow: hidden;
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
    margin: 0;
  }

  @media print {
    :root,
    html,
    body {
      width: auto;
      height: auto;
      overflow: visible !important;
      background: #fff !important;
    }

    body {
      display: block;
    }

    .a3-preview-toolbar {
      display: none !important;
    }

    .a3-preview-pages {
      display: block;
      padding: 0;
    }

    .a3-preview-scroll {
      height: auto;
      overflow: visible !important;
    }

    .a3-page-shell {
      width: 420mm !important;
      height: 297mm !important;
      margin: 0 !important;
    }

    .a3-page {
      position: relative;
      width: 420mm;
      height: 297mm;
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
  const generations = new Map();
  tree.querySelectorAll(".family-node[data-family-generation]").forEach((node) => {
    const generation = Number(node.dataset.familyGeneration);
    if (!Number.isFinite(generation)) return;
    const nodeBounds = node.getBoundingClientRect();
    const current = generations.get(generation) || {
      generation,
      top: Number.POSITIVE_INFINITY,
      bottom: 0,
    };
    current.top = Math.min(current.top, nodeBounds.top - bounds.top);
    current.bottom = Math.max(current.bottom, nodeBounds.bottom - bounds.top);
    generations.set(generation, current);
  });
  const result = {
    width: Math.max(1, Math.ceil(tree.scrollWidth || bounds.width)),
    height: Math.max(1, Math.ceil(tree.scrollHeight || bounds.height)),
    generationBands: [...generations.values()].sort(
      (left, right) => left.generation - right.generation,
    ),
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
  const clip = makeElement(document, "div", "a3-tree-clip");
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
    layout.rows === 1 && layout.scaledHeight < layout.viewportHeight
      ? (layout.viewportHeight - layout.scaledHeight) / 2
      : 0;

  tree.style.transform = `translate(${centreX - tile.offsetX}px, ${
    centreY - tile.offsetY
  }px) scale(${layout.scale})`;
  header.append(heading, pagePosition);
  clip.style.height = `${Math.min(layout.viewportHeight, tile.clipHeight || layout.viewportHeight)}px`;
  clip.append(tree);
  viewport.append(clip);
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

  document.querySelector(".a3-preview-modal")?.remove();
  const modal = makeElement(document, "div", "a3-preview-modal");
  const frame = makeElement(document, "iframe", "a3-preview-frame");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "A3 family tree print preview");
  frame.title = "A3 family tree print preview";
  modal.append(frame);
  document.body.append(modal);
  document.body.classList.add("a3-print-preview-open");

  const previewWindow = frame.contentWindow;
  if (!previewWindow) {
    modal.remove();
    document.body.classList.remove("a3-print-preview-open");
    return false;
  }

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
  const scaleSlider = makeElement(previewWindow.document, "input", "");
  const scaleOutput = makeElement(previewWindow.document, "output", "a3-scale-output", "100%");
  const printButton = makeElement(previewWindow.document, "button", "", "Print all A3 pages");
  const closeButton = makeElement(previewWindow.document, "button", "", "Close");
  const scrollViewport = makeElement(previewWindow.document, "div", "a3-preview-scroll");
  const pages = makeElement(previewWindow.document, "main", "a3-preview-pages");

  heading.append(headingTitle, headingHelp);
  scaleSlider.type = "range";
  scaleSlider.min = "10";
  scaleSlider.max = "150";
  scaleSlider.step = "5";
  scaleSlider.setAttribute("aria-label", "Tree scale percentage");
  scaleLabel.append(scaleText, scaleSlider, scaleOutput);
  printButton.type = "button";
  printButton.dataset.action = "print";
  closeButton.type = "button";
  toolbar.append(heading, scaleLabel, printButton, closeButton);
  scrollViewport.append(pages);
  previewWindow.document.body.append(toolbar, scrollViewport);

  await waitForPreviewStyles(previewWindow);
  const dimensions = measurePrintableTree(sourceCanvas, previewWindow.document);
  const fittedScale = resolveA3HeightScale({ contentHeight: dimensions.height }).scale;
  scaleSlider.value = String(Math.max(10, Math.min(150, Math.round(fittedScale * 100))));
  const renderPages = () => {
    const selectedScale = Math.max(0.1, Number(scaleSlider.value) / 100 || fittedScale);
    const layout = calculateA3Tiles({
      contentWidth: dimensions.width,
      contentHeight: dimensions.height,
      scale: selectedScale,
      generationBands: dimensions.generationBands,
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
    scaleOutput.textContent = `${Math.round(layout.scale * 100)}%`;
    headingHelp.textContent = `A3 landscape · ${layout.tiles.length} ${
      layout.tiles.length === 1 ? "sheet" : "sheets"
    } · ${layout.columns} across × ${layout.rows} high · tree at ${Math.round(
      layout.scale * 100,
    )}% · ${A3_PRINT_LAYOUT.overlapMm} mm overlap · print at 100% / actual size · disable browser headers and footers`;
    applyScreenPageScale(previewWindow);
    scrollViewport.scrollTop = 0;
    scrollViewport.scrollLeft = 0;
  };

  scaleSlider.addEventListener("input", renderPages);
  printButton.addEventListener("click", () => {
    previewWindow.focus();
    previewWindow.print();
  });
  const closePreview = () => {
    modal.remove();
    document.body.classList.remove("a3-print-preview-open");
    document.removeEventListener("keydown", closeOnEscape);
  };
  const closeOnEscape = (event) => {
    if (event.key === "Escape") closePreview();
  };
  closeButton.addEventListener("click", closePreview);
  document.addEventListener("keydown", closeOnEscape);
  previewWindow.addEventListener("resize", () => applyScreenPageScale(previewWindow));
  renderPages();
  previewWindow.focus();
  return true;
}
