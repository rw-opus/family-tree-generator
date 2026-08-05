import { isValidIsoDate } from "./dateFormat.js";

const DEFAULT_RELATIONSHIP_LABEL = "Marriage or partnership";
const DEFAULT_TRANSFER_LABEL = "Transfer or donation";

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function calendarDaysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

function subtractCalendarYears(isoDate, years) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const targetYear = Math.max(1, year - years);
  const targetDay = Math.min(day, calendarDaysInMonth(targetYear, month));
  return [
    String(targetYear).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(targetDay).padStart(2, "0"),
  ].join("-");
}

/**
 * A will must have a real date and, where death is known, must predate death.
 * An invalid death date is treated as unknown rather than blocking the will.
 */
export function validateWillDateChronology(willDate, dateOfDeath = "") {
  if (!isValidIsoDate(willDate)) return "Enter a valid will date.";
  if (isValidIsoDate(dateOfDeath) && willDate >= dateOfDeath) {
    return "Will date must be before the date of death.";
  }
  return "";
}

/**
 * A declaration causa mortis must have a real date and, where death is known,
 * must postdate death.
 */
export function validateCausaMortisDateChronology(declarationDate, dateOfDeath = "") {
  if (!isValidIsoDate(declarationDate)) {
    return "Enter a valid declaration causa mortis date.";
  }
  if (isValidIsoDate(dateOfDeath) && declarationDate <= dateOfDeath) {
    return "Declaration causa mortis date must be after the date of death.";
  }
  return "";
}

function relationshipDeathConstraints({
  startDate,
  endDate,
  dateOfDeath,
  personLabel,
  relationshipLabel,
}) {
  if (!isValidIsoDate(dateOfDeath)) return [];

  const errors = [];
  if (startDate) {
    if (startDate > dateOfDeath) {
      errors.push(
        `${relationshipLabel} start date must be on or before ${personLabel}'s date of death.`,
      );
    } else if (startDate < subtractCalendarYears(dateOfDeath, 90)) {
      errors.push(
        `${relationshipLabel} start date cannot be more than 90 years before ${personLabel}'s date of death.`,
      );
    }
  }
  if (endDate && endDate > dateOfDeath) {
    errors.push(
      `${relationshipLabel} end date must be on or before ${personLabel}'s date of death.`,
    );
  }
  return errors;
}

/**
 * Validates a marriage or partnership against both parties' known dates of
 * death. Relationship dates may remain optional for historic/imported records;
 * callers can require either date for a form by setting the matching flag.
 */
export function validateRelationshipDateChronology({
  startDate = "",
  endDate = "",
  personDateOfDeath = "",
  partnerDateOfDeath = "",
  personLabel = "the first person",
  partnerLabel = "the other person",
  relationshipLabel = DEFAULT_RELATIONSHIP_LABEL,
  startDateRequired = false,
  endDateRequired = false,
} = {}) {
  const errors = [];
  const hasValidStartDate = isValidIsoDate(startDate);
  const hasValidEndDate = isValidIsoDate(endDate);

  if (startDateRequired && !startDate) {
    errors.push(`Enter a ${relationshipLabel.toLowerCase()} start date.`);
  } else if (startDate && !hasValidStartDate) {
    errors.push(`Enter a valid ${relationshipLabel.toLowerCase()} start date.`);
  }

  if (endDateRequired && !endDate) {
    errors.push(`Enter a ${relationshipLabel.toLowerCase()} end date.`);
  } else if (endDate && !hasValidEndDate) {
    errors.push(`Enter a valid ${relationshipLabel.toLowerCase()} end date.`);
  }

  if (hasValidStartDate && hasValidEndDate && endDate < startDate) {
    errors.push(`${relationshipLabel} end date cannot be before its start date.`);
  }

  if (hasValidStartDate || hasValidEndDate) {
    errors.push(
      ...relationshipDeathConstraints({
        startDate: hasValidStartDate ? startDate : "",
        endDate: hasValidEndDate ? endDate : "",
        dateOfDeath: personDateOfDeath,
        personLabel,
        relationshipLabel,
      }),
      ...relationshipDeathConstraints({
        startDate: hasValidStartDate ? startDate : "",
        endDate: hasValidEndDate ? endDate : "",
        dateOfDeath: partnerDateOfDeath,
        personLabel: partnerLabel,
        relationshipLabel,
      }),
    );
  }

  return [...new Set(errors)];
}

/**
 * A transfer or donation must postdate every known acquisition represented by
 * the transferred share and cannot postdate a known seller death.
 */
export function validateTransferDateChronology({
  transferDate = "",
  acquisitionDates = [],
  sellerDateOfDeath = "",
  eventLabel = DEFAULT_TRANSFER_LABEL,
} = {}) {
  if (!isValidIsoDate(transferDate)) return `Enter a valid ${eventLabel.toLowerCase()} date.`;

  const knownAcquisitionDates = (
    Array.isArray(acquisitionDates) ? acquisitionDates : [acquisitionDates]
  ).filter(isValidIsoDate);
  if (knownAcquisitionDates.some((acquisitionDate) => transferDate <= acquisitionDate)) {
    return `${eventLabel} date must be after every known acquisition date for the share.`;
  }
  if (isValidIsoDate(sellerDateOfDeath) && transferDate > sellerDateOfDeath) {
    return `${eventLabel} date must be on or before the seller's date of death.`;
  }
  return "";
}
