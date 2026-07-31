/**
 * Presents a notary consistently without forcing users to type the prefix
 * into every stored record. Existing values already prefixed with "Not." are
 * preserved as-is.
 */
export function displayNotaryName(value) {
  const name = String(value || "").trim();
  if (!name) return "";
  return /^not\.\s*/i.test(name) ? name : `Not. ${name}`;
}
