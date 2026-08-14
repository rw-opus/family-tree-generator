export const STICKY_NAV_OFFSET_PROPERTY = "--property-workspace-nav-height";

/**
 * Writes the sticky navigation's measured height onto the scrolling page so
 * `scroll-margin-top` can reserve exactly that much room. Fixed rem offsets
 * cannot do this: the Property & Tax header wraps onto extra lines on narrow
 * screens and on phones, which used to leave a jumped-to section heading
 * hidden underneath the sticky menu.
 */
export function syncStickyNavOffset(page, shell, property = STICKY_NAV_OFFSET_PROPERTY) {
  if (!page?.style || typeof shell?.getBoundingClientRect !== "function") return 0;
  const height = Math.ceil(shell.getBoundingClientRect().height || 0);
  // A detached or not-yet-laid-out shell measures zero. Keeping the previous
  // value lets the stylesheet fallback apply instead of collapsing the offset.
  if (height <= 0) return 0;
  page.style.setProperty(property, `${height}px`);
  return height;
}

/**
 * Keeps the offset in step with the sticky navigation while the workspace is
 * open. Returns a cleanup function even when ResizeObserver is unavailable.
 */
export function observeStickyNavOffset(page, shell, property = STICKY_NAV_OFFSET_PROPERTY) {
  syncStickyNavOffset(page, shell, property);
  if (!page || !shell || typeof ResizeObserver === "undefined") return () => {};
  const observer = new ResizeObserver(() => syncStickyNavOffset(page, shell, property));
  observer.observe(shell);
  return () => observer.disconnect();
}
