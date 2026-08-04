const PUBLIC_ERROR_TYPES = new Set([
  "Error",
  "TypeError",
  "ReferenceError",
  "SyntaxError",
  "RangeError",
  "URIError",
  "AggregateError",
  "DOMException",
]);

/* Startup messages can accidentally contain a person's name, a property
   address or a database diagnostic. Only expose a generic error category. */
export function publicFamilyTreeErrorReference(error) {
  const type = String(error?.name || "").trim();
  return `Error reference: ${PUBLIC_ERROR_TYPES.has(type) ? type : "Application startup error"}`;
}

/* Family-tree activity contains personal, testamentary and financial data.
   Retain the exception type and stack needed to identify code faults while
   stripping messages, breadcrumbs and browser context that may contain PII. */
export function sanitiseTelemetryEvent(event) {
  if (!event || typeof event !== "object") return event;
  const safeEvent = { ...event };
  delete safeEvent.breadcrumbs;
  delete safeEvent.request;
  delete safeEvent.user;
  delete safeEvent.extra;
  delete safeEvent.contexts;
  delete safeEvent.message;
  delete safeEvent.logentry;
  if (Array.isArray(event.exception?.values)) {
    safeEvent.exception = {
      ...event.exception,
      values: event.exception.values.map((exception) => {
        const safeException = { ...exception };
        delete safeException.value;
        return safeException;
      }),
    };
  }
  return safeEvent;
}
