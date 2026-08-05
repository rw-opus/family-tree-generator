import { useEffect, useRef } from "react";

function touchDistance(touches) {
  const horizontal = touches[1].clientX - touches[0].clientX;
  const vertical = touches[1].clientY - touches[0].clientY;
  return Math.hypot(horizontal, vertical);
}

function touchCentre(touches) {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

export function usePinchZoom(surfaceRef, chartRef, zoom, onZoomChange, dependency) {
  const zoomRef = useRef(zoom);
  const onZoomChangeRef = useRef(onZoomChange);
  const pinchRef = useRef(null);

  useEffect(() => {
    zoomRef.current = zoom;
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange, zoom]);

  useEffect(() => {
    const surface = surfaceRef.current;
    const chart = chartRef.current;
    if (!surface || !chart) return undefined;

    const startPinch = (event) => {
      if (event.touches.length !== 2) return;
      const centre = touchCentre(event.touches);
      const chartRect = chart.getBoundingClientRect();
      const scale = Math.max(0.1, Number(zoomRef.current) / 100 || 1);
      pinchRef.current = {
        distance: touchDistance(event.touches),
        zoom: zoomRef.current,
        lastZoom: zoomRef.current,
        anchorX: (chart.scrollLeft + centre.x - chartRect.left) / scale,
        anchorY: (chart.scrollTop + centre.y - chartRect.top) / scale,
      };
    };
    const movePinch = (event) => {
      if (event.touches.length !== 2 || !pinchRef.current) return;
      event.preventDefault();
      const distance = touchDistance(event.touches);
      if (!pinchRef.current.distance || !distance) return;

      const nextZoom = Math.min(
        200,
        Math.max(10, Math.round((pinchRef.current.zoom * distance) / pinchRef.current.distance)),
      );
      if (nextZoom === pinchRef.current.lastZoom) return;

      pinchRef.current.lastZoom = nextZoom;
      onZoomChangeRef.current?.(nextZoom);
      const centre = touchCentre(event.touches);
      const anchorX = pinchRef.current.anchorX;
      const anchorY = pinchRef.current.anchorY;
      window.requestAnimationFrame(() => {
        const chartRect = chart.getBoundingClientRect();
        const nextScale = Math.max(0.1, nextZoom / 100);
        chart.scrollLeft = Math.max(0, anchorX * nextScale - (centre.x - chartRect.left));
        chart.scrollTop = Math.max(0, anchorY * nextScale - (centre.y - chartRect.top));
      });
    };
    const endPinch = (event) => {
      if (event.touches.length < 2) pinchRef.current = null;
    };

    surface.addEventListener("touchstart", startPinch, { passive: true });
    surface.addEventListener("touchmove", movePinch, { passive: false });
    surface.addEventListener("touchend", endPinch, { passive: true });
    surface.addEventListener("touchcancel", endPinch, { passive: true });

    return () => {
      surface.removeEventListener("touchstart", startPinch);
      surface.removeEventListener("touchmove", movePinch);
      surface.removeEventListener("touchend", endPinch);
      surface.removeEventListener("touchcancel", endPinch);
    };
  }, [chartRef, dependency, surfaceRef]);
}
