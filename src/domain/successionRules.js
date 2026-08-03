import { isValidIsoDate } from "./dateFormat.js";

export const SUCCESSION_REFORM_START = "2005-03-01";
export const ARTICLE_815_REPEAL_START = "2012-07-24";

export const LEGACY_INTESTACY_SOURCE_GAPS = Object.freeze({
  descendants: Object.freeze(["808", "809"]),
  ascendants: Object.freeze(["810", "811", "812", "813"]),
  collaterals: Object.freeze(["814", "815", "816"]),
  childrenOutsideMarriage: Object.freeze(["817", "818", "819", "820", "821", "822", "823", "824"]),
  survivingSpouse: Object.freeze(["825", "826", "827", "828", "829"]),
  government: Object.freeze(["830"]),
});

export function successionRuleset(dateOfDeath) {
  if (!dateOfDeath) {
    return {
      key: "undated",
      label: "Enter the date of death",
      supported: false,
      complete: false,
    };
  }
  if (!isValidIsoDate(dateOfDeath)) {
    return {
      key: "invalid-date",
      label: "Enter a valid date of death",
      supported: false,
      complete: false,
    };
  }
  if (dateOfDeath < SUCCESSION_REFORM_START) {
    return {
      key: "pre2005",
      label: "Historical law before 1 March 2005",
      supported: true,
      complete: false,
      article815ReviewRequired: false,
    };
  }
  if (dateOfDeath < ARTICLE_815_REPEAL_START) {
    return {
      key: "post2005-article815",
      label: "Rules from 1 March 2005, including former article 815",
      supported: true,
      complete: false,
      article815ReviewRequired: true,
    };
  }
  return {
    key: "current",
    label: "Current rules",
    supported: true,
    complete: true,
    article815ReviewRequired: false,
  };
}

export function legacySourceGapWarning(articleNumbers, subject) {
  return `The complete pre-1 March 2005 text of former Civil Code articles ${articleNumbers.join(
    ", ",
  )} is needed before ${subject} can be allocated automatically. Enter edited heirs totalling 100% in the meantime.`;
}

export function article815ReviewWarning() {
  return "This succession opened while former Civil Code article 815 was in force. Confirm whether any proposed heir was conceived and born outside marriage; if so, enter the historically adjusted heir shares manually until that status is recorded by the calculator.";
}
