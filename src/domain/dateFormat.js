const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DISPLAY_DATE_PATTERN = /^(\d{2})-(\d{2})-(\d{4})$/;

const isLeapYear = (year) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const daysInMonth = (year, month) => {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
};

const isValidDateParts = (year, month, day) =>
  year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);

/**
 * Returns whether a value is a real calendar date stored as YYYY-MM-DD.
 */
export function isValidIsoDate(value) {
  const match = ISO_DATE_PATTERN.exec(String(value || ""));
  if (!match) return false;

  const [, year, month, day] = match.map(Number);
  return isValidDateParts(year, month, day);
}

/**
 * Converts an ISO storage date (YYYY-MM-DD) to its UI representation
 * (DD-MM-YYYY). Invalid or empty values are displayed as an empty field.
 */
export function isoDateToDisplay(value) {
  const text = String(value || "");
  if (!isValidIsoDate(text)) return "";

  const [, year, month, day] = ISO_DATE_PATTERN.exec(text);
  return `${day}-${month}-${year}`;
}

/**
 * Converts a DD-MM-YYYY display date to ISO storage format. An empty field
 * returns an empty string; an incomplete or invalid date returns null.
 */
export function displayDateToIso(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const match = DISPLAY_DATE_PATTERN.exec(text);
  if (!match) return null;

  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  if (!isValidDateParts(year, month, day)) return null;

  return `${yearText}-${monthText}-${dayText}`;
}

/**
 * Keeps date entry mobile-friendly by accepting digits, slashes, dots or
 * hyphens and presenting up to eight digits as DD-MM-YYYY.
 */
export function formatDateDraft(value) {
  const text = String(value || "").trim();
  if (ISO_DATE_PATTERN.test(text)) return isoDateToDisplay(text);

  const digits = text.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}
