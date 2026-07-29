import { useEffect, useRef } from "react";

function touchDistance(touches) {
  const horizontal = touches[1].clientX - touches[0].clientX;
  const vertical = touches[1].clientY - touches[0].clientY;
  return Math.hypot(horizontal, vertical);
}

export function usePinchZoom(chartRef, zoom, onZoomChange, dependency) {
  const zoomRef = useRef(zoom);
  const onZoomChangeRef = useRef(onZoomChange);
  const pinchRef = useRef(null);

  useEffect(() => {
    zoomRef.current = zoom;
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange, zoom]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return undefined;

    const startPinch = (event) => {
      if (event.touches.length !== 2) return;
      pinchRef.current = {
        distance: touchDistance(event.touches),
        zoom: zoomRef.current,
        lastZoom: zoomRef.current,
      };
    };
    const movePinch = (event) => {
      if (event.touches.length !== 2 || !pinchRef.current) return;
      event.preventDefault();
      const distance = touchDistance(event.touches);
      if (!pinchRef.current.distance || !distance) return;

      const nextZoom =
        Math.round((pinchRef.current.zoom * distance) / pinchRef.current.distance / 5) * 5;
      if (nextZoom === pinchRef.current.lastZoom) return;

      pinchRef.current.lastZoom = nextZoom;
      onZoomChangeRef.current?.(nextZoom);
    };
    const endPinch = (event) => {
      if (event.touches.length < 2) pinchRef.current = null;
    };

    chart.addEventListener("touchstart", startPinch, { passive: true });
    chart.addEventListener("touchmove", movePinch, { passive: false });
    chart.addEventListener("touchend", endPinch, { passive: true });
    chart.addEventListener("touchcancel", endPinch, { passive: true });

    return () => {
      chart.removeEventListener("touchstart", startPinch);
      chart.removeEventListener("touchmove", movePinch);
      chart.removeEventListener("touchend", endPinch);
      chart.removeEventListener("touchcancel", endPinch);
    };
  }, [chartRef, dependency]);
}
