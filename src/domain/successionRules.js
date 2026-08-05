import { isValidIsoDate } from "./dateFormat.js";

export const SUCCESSION_REFORM_START = "2005-03-01";
export const ARTICLE_815_REPEAL_START = "2012-07-24";
export const LEGACY_RULES_REFERENCE_DATE = "2005-02-28";
export const LEGACY_1993_AMENDMENT_START = "1993-12-01";
export const HISTORICAL_LAW_WARNING_PREFIX = "Historical law must be checked:";

// Exact article matching is deliberate. A broad range such as "788-830" does not
// establish that a provision changed after the death is material to this succession.
// Callers must identify the section engaged by the facts before a warning is shown.
const VERIFIED_LEGACY_AMENDMENTS = Object.freeze([
  Object.freeze({
    effectiveDate: LEGACY_1993_AMENDMENT_START,
    source: "Act XXI of 1993, brought into force by Legal Notice 127 of 1993",
    articles: Object.freeze([
      "623(f)",
      "631",
      "633A",
      "634",
      "636",
      "638",
      "639",
      "646",
      "825",
      "826",
      "829",
    ]),
  }),
]);

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
      referenceDate: LEGACY_RULES_REFERENCE_DATE,
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

function uniqueArticleNumbers(articleNumbers = []) {
  return [...new Set(articleNumbers.map((article) => String(article).trim()).filter(Boolean))];
}

export function legacyHistoricalLawReview(dateOfDeath, applicableArticleNumbers = []) {
  if (!isValidIsoDate(dateOfDeath) || dateOfDeath >= SUCCESSION_REFORM_START) {
    return { required: false, changes: [], articles: [], warning: "" };
  }

  const applicableArticles = uniqueArticleNumbers(applicableArticleNumbers);
  const changes = VERIFIED_LEGACY_AMENDMENTS.map((amendment) => {
    const changedArticles = new Set(amendment.articles);
    return {
      effectiveDate: amendment.effectiveDate,
      source: amendment.source,
      articles: applicableArticles.filter((article) => changedArticles.has(article)),
    };
  }).filter((amendment) => dateOfDeath < amendment.effectiveDate && amendment.articles.length > 0);

  if (!changes.length) return { required: false, changes: [], articles: [], warning: "" };

  const articles = uniqueArticleNumbers(changes.flatMap((change) => change.articles));
  const articleLabel = articles.length === 1 ? "article" : "articles";
  const changeDates = [...new Set(changes.map((change) => change.effectiveDate))];
  const dateLabel = changeDates
    .map((date) => {
      const [year, month, day] = date.split("-");
      return `${day}-${month}-${year}`;
    })
    .join(", ");
  const warning = `${HISTORICAL_LAW_WARNING_PREFIX} former Civil Code ${articleLabel} ${articles.join(", ")} ${articles.length === 1 ? "was" : "were"} changed from ${dateLabel}, after this succession opened. The calculator has used the full-ownership treatment shown in the ${LEGACY_RULES_REFERENCE_DATE.split("-").reverse().join("-")} consolidation; check the version applicable on the date of death.`;

  return { required: true, changes, articles, warning };
}

export function legacyHistoricalLawWarning(dateOfDeath, applicableArticleNumbers = []) {
  return legacyHistoricalLawReview(dateOfDeath, applicableArticleNumbers).warning;
}

export function isLegacyHistoricalLawWarning(value = "") {
  return String(value).startsWith(HISTORICAL_LAW_WARNING_PREFIX);
}

export function article815ReviewWarning() {
  return "This succession opened while former Civil Code article 815 was in force. Confirm whether any proposed heir was conceived and born outside marriage; if so, enter the historically adjusted heir shares manually until that status is recorded by the calculator.";
}
