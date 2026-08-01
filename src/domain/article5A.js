const ARTICLE_5A_START = "2005-11-01";
const MODERN_RATE_START = "2015-01-01";
const UCA_RATE_START = "2016-01-01";
const HOUSING_RELIEF_START = "2022-01-01";
export const INHERITANCE_CAUSA_MORTIS_CUTOFF = "1992-11-25";
const PRE_2004_CUTOFF = "2004-01-01";

const number = (value) => Math.max(0, Number(value) || 0);
const validDate = (value) => {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
};

const parseDate = (value) => {
  if (!validDate(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const noLaterThanYears = (start, end, years) => {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate || endDate < startDate) return false;
  const deadline = new Date(startDate);
  deadline.setUTCFullYear(deadline.getUTCFullYear() + years);
  return endDate <= deadline;
};

const method = ({
  key,
  label,
  rule,
  rate = null,
  basis,
  tax,
  requiresElection = false,
  note = "",
}) => ({
  key,
  label,
  rule,
  rate,
  basis: number(basis),
  tax: number(tax),
  requiresElection,
  note,
});

export const ARTICLE_5A_SPECIAL_TREATMENTS = [
  {
    key: "",
    label: "No exemption or out-of-scope treatment",
    kind: "none",
  },
  {
    key: "exempt-family-donation",
    label: "Exempt donation to qualifying family member",
    kind: "exemption",
    rule: "5A(4)(a)(i)",
    note: "The statutory relationship and donation conditions must be confirmed in the deed.",
  },
  {
    key: "exempt-deemed-donation",
    label: "Exempt qualifying deemed donation",
    kind: "exemption",
    rule: "5A(4)(b)",
    note: "The deemed donation must fall within Article 5(18)(b) or 5(21)(b)(ii).",
  },
  {
    key: "exempt-philanthropic-donation",
    label: "Exempt donation to approved philanthropic institution",
    kind: "exemption",
    rule: "5A(4)(a)(ii)",
    note: "The institution's approval and donation conditions must be confirmed.",
  },
  {
    key: "exempt-own-residence",
    label: "Exempt qualifying own residence",
    kind: "exemption",
    rule: "5A(4)(c)",
    note: "Requires the ownership, occupation, main-residence election and disposal-period conditions; relief may be proportionate.",
  },
  {
    key: "exempt-separation-divorce",
    label: "Exempt assignment on separation or divorce",
    kind: "exemption",
    rule: "5A(4)(d)",
    note: "The assignment must be consequent to a qualifying separation or divorce.",
  },
  {
    key: "exempt-community",
    label: "Exempt dissolution or partition between spouses/heirs",
    kind: "exemption",
    rule: "5A(4)(e)",
    note: "The original acquisition date carries through to a later transfer.",
  },
  {
    key: "exempt-intragroup",
    label: "Exempt qualifying intra-group transfer",
    kind: "exemption",
    rule: "5A(4)(f)",
    note: "Group-relief conditions and possible later group-exit tax require separate verification.",
  },
  {
    key: "exempt-incorporation",
    label: "Exempt qualifying incorporation",
    kind: "exemption",
    rule: "5A(4)(g)",
    note: "The going-concern and continuing-business conditions must be satisfied.",
  },
  {
    key: "exempt-trust",
    label: "Exempt qualifying trust transfer",
    kind: "exemption",
    rule: "5A(4)(h)",
    note: "This applies only to the trust transactions described by the provision.",
  },
  {
    key: "exempt-transferor",
    label: "Transferor otherwise exempt from tax",
    kind: "exemption",
    rule: "5A(4)(i)",
    note: "The transferor's separate statutory exemption must be verified.",
  },
  {
    key: "exempt-company-distribution",
    label: "Exempt qualifying company distribution",
    kind: "exemption",
    rule: "5A(4)(j)",
    note: "The 95%, five-year, capital-asset and distribution conditions must all be verified.",
  },
  {
    key: "scope-historical-promise",
    label: "Outside Article 5A: qualifying 2005–2006 promise election",
    kind: "out-of-scope",
    rule: "5A(3)(a)",
    note: "All historical promise, transfer, notice and deed-election deadlines must be met.",
  },
  {
    key: "scope-twelve-year-election",
    label: "Outside Article 5A: qualifying twelve-year election",
    kind: "out-of-scope",
    rule: "5A(3)(b)",
    note: "This is now limited to the transitional promise/project circumstances in the provision.",
  },
  {
    key: "scope-sda-election",
    label: "Outside Article 5A: qualifying SDA election",
    kind: "out-of-scope",
    rule: "5A(3)(c)",
    note: "The special designated area ownership and historical election conditions must be met.",
  },
  {
    key: "scope-co-owner-residence",
    label: "Outside Article 5A: qualifying co-owner residence transfer",
    kind: "out-of-scope",
    rule: "5A(3)(d)",
    note: "A deed election is required; another income-tax computation may apply.",
  },
  {
    key: "scope-government-acquisition",
    label: "Outside Article 5A: qualifying historic Government acquisition",
    kind: "out-of-scope",
    rule: "5A(3)(e)",
    note: "The public-purpose acquisition, pre-November 2005 possession/order and letter conditions apply.",
  },
  {
    key: "scope-business-replacement",
    label: "Outside Article 5A: qualifying business replacement",
    kind: "out-of-scope",
    rule: "5A(3)(g)",
    note: "A deed election and the business-replacement conditions are required.",
  },
  {
    key: "scope-court-winding-up",
    label: "Outside Article 5A: transfer in a Court winding up",
    kind: "out-of-scope",
    rule: "5A(3)(f)",
    note: "A separate ordinary-regime assessment may apply.",
  },
  {
    key: "scope-nonresident",
    label: "Outside Article 5A: qualifying non-resident transferor",
    kind: "out-of-scope",
    rule: "5A(3)(h)",
    note: "Foreign tax-residence certification and control conditions are required.",
  },
  {
    key: "scope-old-lease-option",
    label: "Outside Article 5A: pre-November 2005 lease option",
    kind: "out-of-scope",
    rule: "5A(3)(i)",
    note: "The qualifying lease and purchase-option arrangements must pre-date 1 November 2005.",
  },
  {
    key: "scope-listed-project-election",
    label: "Outside Article 5A: qualifying listed-debt project election",
    kind: "out-of-scope",
    rule: "5A(3)(j)",
    note: "The listed debt-security, prospectus-use and project-wide election conditions apply.",
  },
  {
    key: "scope-partition-no-owelty",
    label: "Outside Article 5A: partition with no owelty",
    kind: "out-of-scope",
    rule: "5A(2)(a)",
    note: "This does not apply where the special deemed-transfer rule in 5A(7A) applies.",
  },
  {
    key: "review-partition-7a",
    label: "Manual review: partition deemed transfer under 5A(7A)",
    kind: "manual-review",
    rule: "5A(7A)",
    note: "The deemed market-value transfer and carried acquisition date require a separate lot setup.",
  },
];

export const ARTICLE_5A_QUALIFYING_RATES = [
  { key: "", label: "No special qualifying rate" },
  { key: "sole-residence-2", label: "2% sole ordinary residence — 5A(5)(g)" },
  { key: "uca-5", label: "5% restored UCA/scheduled property — 5A(5)(h)" },
  { key: "article31c-10", label: "10% Article 31C circumstances — 5A(5)(d)" },
  { key: "group-exit", label: "Deemed group-exit transfer — 5A(12A)" },
  {
    key: "housing-tenant-10",
    label: "Housing Authority tenant, at least 10 years — 5A(5)(i)(i)",
  },
  {
    key: "housing-other-10",
    label: "Housing Authority lease, transfer to another person — 5A(5)(i)(ii)",
  },
  {
    key: "housing-3-to-10",
    label: "Housing Authority benefit, 3 to under 10 years — 5A(5)(i)(iii)",
  },
];

export const ARTICLE_5A_LEGAL_NOTES = [
  {
    rule: "5A(6)(a)",
    text: "Transfer value is the higher of market value and consideration.",
  },
  {
    rule: "5A(8)",
    text: "Parts acquired under different acquisitions must be assessed as separate transfers.",
  },
  {
    rule: "5A(2)(a) and 5A(7)",
    text: "An exchange is two transfers; partition owelty is a deemed sale and purchase.",
  },
  {
    rule: "5A(9)",
    text: "No deduction reduces the Article 5A taxable amount unless specifically prescribed.",
  },
  {
    rule: "5A(10)–(11)",
    text: "The tax is final, is due by the transferor and is remitted within 15 working days.",
  },
];

export function article5ATransferValue(lot = {}) {
  const consideration = number(
    lot.consideration === undefined || lot.consideration === ""
      ? lot.transferValue
      : lot.consideration,
  );
  const marketValue = number(lot.marketValue);
  return {
    consideration,
    marketValue,
    transferValue: Math.max(consideration, marketValue),
    marketValueOverrides: marketValue > consideration,
  };
}

function normalFlatMethod(lot, acquisitionDate, transferDate, transferValue) {
  if (transferDate < MODERN_RATE_START) {
    return method({
      key: "whole-12",
      label: "12% of transfer value",
      rule: "5A(5)(a)",
      rate: 0.12,
      basis: transferValue,
      tax: transferValue * 0.12,
    });
  }
  if (acquisitionDate < PRE_2004_CUTOFF) {
    const oldPromise = Boolean(lot.promiseNoticeBefore2014);
    const rate = oldPromise ? 0.12 : 0.1;
    return method({
      key: oldPromise ? "whole-12" : "whole-10",
      label: `${rate * 100}% of transfer value`,
      rule: "5A(5)(f)",
      rate,
      basis: transferValue,
      tax: transferValue * rate,
      note: oldPromise
        ? "The pre-17 November 2014 promise-of-sale notice condition was confirmed."
        : "",
    });
  }
  return method({
    key: "whole-8",
    label: "8% of transfer value",
    rule: "5A(5)(a)",
    rate: 0.08,
    basis: transferValue,
    tax: transferValue * 0.08,
  });
}

function fiveYearMethod(lot, acquisitionDate, transferDate, transferValue) {
  if (!lot.qualifiesFiveYearRate) return { method: null, warning: "" };
  if (transferDate < MODERN_RATE_START)
    return { method: null, warning: "The 5% five-year rate only applies from 1 January 2015." };
  if (!noLaterThanYears(acquisitionDate, transferDate, 5))
    return {
      method: null,
      warning: "The transfer is later than five years after the applicable acquisition date.",
    };
  if (lot.isProject)
    return { method: null, warning: "Property forming part of a project cannot use the 5% rate." };
  if (lot.relatedProjectWithinFiveYears)
    return {
      method: null,
      warning: "The related-person project condition prevents use of the 5% rate.",
    };
  if (lot.developmentPermitWorks && !lot.acquiredForSoleResidence)
    return {
      method: null,
      warning:
        "Development-permit works prevent the 5% rate unless the sole-residence acquisition exception applies.",
    };
  return {
    method: method({
      key: "five-year-5",
      label: "5% transfer within five years",
      rule: "5A(5)(e)",
      rate: 0.05,
      basis: transferValue,
      tax: transferValue * 0.05,
      note: "The non-project and development-work conditions were user-confirmed.",
    }),
    warning: "",
  };
}

function qualifyingRateMethod(lot, acquisitionDate, transferDate, transferValue, normalMethod) {
  const key = lot.qualifyingRate || "";
  if (!key) return { method: null, warning: "" };
  if (key === "sole-residence-2") {
    if (
      transferDate < MODERN_RATE_START ||
      !noLaterThanYears(acquisitionDate, transferDate, 3) ||
      !lot.acquiredForSoleResidence ||
      lot.ownsOtherResidentialProperty
    ) {
      return {
        method: null,
        warning:
          "The 2% rate requires a post-2014 transfer within three years, a deed declaration of sole-residence purpose, and no other residential property.",
      };
    }
    return {
      method: method({
        key,
        label: "2% qualifying sole ordinary residence",
        rule: "5A(5)(g)",
        rate: 0.02,
        basis: transferValue,
        tax: transferValue * 0.02,
      }),
      warning: "",
    };
  }
  if (key === "uca-5") {
    if (transferDate < UCA_RATE_START || !lot.ucaCertificateConfirmed) {
      return {
        method: null,
        warning:
          "The UCA/scheduled-property rate requires a transfer from 1 January 2016 and the prescribed completion certificate.",
      };
    }
    return {
      method: method({
        key,
        label: "5% restored UCA or scheduled property",
        rule: "5A(5)(h)",
        rate: 0.05,
        basis: transferValue,
        tax: transferValue * 0.05,
      }),
      warning: "",
    };
  }
  if (key === "article31c-10") {
    const transitionalSevenPercent =
      transferDate >= MODERN_RATE_START &&
      transferDate < "2016-01-01" &&
      !lot.promiseNoticeBefore2014;
    const rate = transitionalSevenPercent ? 0.07 : 0.1;
    return {
      method: method({
        key,
        label: `${rate * 100}% Article 31C circumstances`,
        rule: "5A(5)(d)",
        rate,
        basis: transferValue,
        tax: transferValue * rate,
      }),
      warning: "",
    };
  }
  if (key === "group-exit") {
    const rate = acquisitionDate < PRE_2004_CUTOFF ? 0.1 : 0.08;
    return {
      method: method({
        key,
        label: `${rate * 100}% deemed group-exit transfer`,
        rule: "5A(12A)(e)",
        rate,
        basis: transferValue,
        tax: transferValue * rate,
        note: "The six-year group-exit and deemed transfer-value conditions were user-confirmed.",
      }),
      warning: "",
    };
  }
  if (key.startsWith("housing-")) {
    if (transferDate < HOUSING_RELIEF_START || !lot.housingCertificateConfirmed) {
      return {
        method: null,
        warning:
          "Housing Authority relief requires a transfer from 1 January 2022 and the prescribed Housing Authority certificate.",
      };
    }
    if (!normalMethod?.rate) {
      return {
        method: null,
        warning:
          "This Housing Authority relief needs a manual assessment because the underlying normal rate is not a flat transfer-value rate.",
      };
    }
    const firstBand = Math.min(200000, transferValue);
    const excess = Math.max(0, transferValue - firstBand);
    const tenantExemption = key === "housing-tenant-10";
    const firstBandRate = tenantExemption ? 0 : normalMethod.rate / 2;
    const tax = firstBand * firstBandRate + excess * normalMethod.rate;
    return {
      method: method({
        key,
        label: tenantExemption
          ? "Housing relief: first €200,000 exempt"
          : "Housing relief: half rate on first €200,000",
        rule: tenantExemption ? "5A(5)(i)(i)" : "5A(5)(i)(ii)–(iii)",
        rate: null,
        basis: transferValue,
        tax,
        note: `Underlying normal rate: ${normalMethod.rate * 100}%.`,
      }),
      warning: "",
    };
  }
  return { method: null, warning: "Choose a recognised Article 5A qualifying rate." };
}

function specialTreatmentResult(lot, base) {
  const treatment = ARTICLE_5A_SPECIAL_TREATMENTS.find(
    (item) => item.key && item.key === lot.article5ASpecialTreatment,
  );
  if (!treatment) return null;
  if (!lot.specialTreatmentConfirmed) {
    return {
      ...base,
      methods: [],
      selected: "",
      recommended: "",
      lowest: "",
      status: "incomplete",
      warning: `Confirm that the conditions for ${treatment.rule} have been checked.`,
      warnings: [treatment.note],
      appliedRule: treatment.rule,
    };
  }
  if (treatment.kind === "out-of-scope") {
    return {
      ...base,
      methods: [],
      selected: "",
      recommended: "",
      lowest: "",
      status: "out-of-scope",
      requiresManualReview: true,
      warning: `Article 5A final tax is not calculated. ${treatment.note}`,
      warnings: [],
      appliedRule: treatment.rule,
    };
  }
  if (treatment.kind === "manual-review") {
    return {
      ...base,
      methods: [],
      selected: "",
      recommended: "",
      lowest: "",
      status: "manual-review",
      requiresManualReview: true,
      warning: `No automatic figure has been included. ${treatment.note}`,
      warnings: [],
      appliedRule: treatment.rule,
    };
  }
  const exemptMethod = method({
    key: treatment.key,
    label: treatment.label,
    rule: treatment.rule,
    basis: base.transferValue,
    tax: 0,
    note: treatment.note,
  });
  return {
    ...base,
    methods: [exemptMethod],
    selected: exemptMethod.key,
    recommended: exemptMethod.key,
    lowest: exemptMethod.key,
    status: "exempt",
    warnings: [],
    appliedRule: treatment.rule,
  };
}

function finish(lot, base, methods, defaultKey, warnings = []) {
  const cleanWarnings = warnings.filter(Boolean);
  const lowest =
    methods.length > 0
      ? methods.reduce((best, item) => (item.tax < best.tax ? item : best)).key
      : "";
  const selected = methods.some((item) => item.key === lot.selectedTaxMethod)
    ? lot.selectedTaxMethod
    : defaultKey;
  const selectedMethod = methods.find((item) => item.key === selected);
  return {
    ...base,
    methods,
    selected,
    recommended: lowest,
    lowest,
    defaultMethod: defaultKey,
    status: methods.length ? "calculated" : "incomplete",
    warnings: cleanWarnings,
    warning: methods.length ? "" : cleanWarnings[0] || "",
    appliedRule: selectedMethod?.rule || "",
  };
}

export function assessArticle5ATransfer(lot = {}) {
  const values = article5ATransferValue(lot);
  const numerator = number(lot.shareNumerator);
  const denominator = number(lot.shareDenominator);
  const share = denominator > 0 ? numerator / denominator : 0;
  const declaredValue = number(lot.acquisitionValue);
  const acquisitionType = lot.acquisitionType || "inheritance";
  const acquisitionDate =
    acquisitionType === "inheritance"
      ? String(lot.inheritanceDate || lot.acquisitionDate || "")
      : String(lot.acquisitionDate || lot.inheritanceDate || "");
  const transferDate = String(lot.transferDate || "");
  const base = {
    ...values,
    declaredValue,
    acquisitionType,
    acquisitionDate,
    transferDate,
    share,
    increase: Math.max(0, values.transferValue - declaredValue),
  };

  if (!(numerator > 0) || !(denominator > 0)) {
    return {
      ...base,
      methods: [],
      selected: "",
      recommended: "",
      lowest: "",
      status: "incomplete",
      warnings: [],
      warning: "Enter the fraction covered by this tax lot.",
    };
  }
  if (!validDate(transferDate)) {
    return {
      ...base,
      methods: [],
      selected: "",
      recommended: "",
      lowest: "",
      status: "incomplete",
      warnings: [],
      warning: "Enter the transfer or intended deed date.",
    };
  }
  if (!(values.transferValue > 0)) {
    return {
      ...base,
      methods: [],
      selected: "",
      recommended: "",
      lowest: "",
      status: "incomplete",
      warnings: [],
      warning: "Enter the consideration or market value for this fraction.",
    };
  }
  if (transferDate < ARTICLE_5A_START) {
    return {
      ...base,
      methods: [],
      selected: "",
      recommended: "",
      lowest: "",
      status: "out-of-scope",
      requiresManualReview: true,
      warnings: [],
      warning: "Article 5A applies to transfers from 1 November 2005; assess the earlier regime.",
    };
  }

  const special = specialTreatmentResult(lot, base);
  if (special) return special;

  if (!validDate(acquisitionDate)) {
    return {
      ...base,
      methods: [],
      selected: "",
      recommended: "",
      lowest: "",
      status: "incomplete",
      warnings: [],
      warning:
        acquisitionType === "inheritance"
          ? "Enter the inheritance date."
          : "Enter the acquisition date.",
    };
  }
  if (acquisitionDate > transferDate) {
    return {
      ...base,
      methods: [],
      selected: "",
      recommended: "",
      lowest: "",
      status: "incomplete",
      warnings: [],
      warning: "The acquisition date cannot be after the transfer date.",
    };
  }

  if (lot.isJudicialSale && acquisitionType !== "inheritance") {
    return {
      ...base,
      methods: [],
      selected: "",
      recommended: "",
      lowest: "",
      status: "out-of-scope",
      requiresManualReview: true,
      warnings: [],
      appliedRule: "5A(3)(f)",
      warning:
        "This judicial sale is outside Article 5A; calculate any tax due under the applicable ordinary regime.",
    };
  }

  if (
    acquisitionType === "inheritance" &&
    (acquisitionDate < INHERITANCE_CAUSA_MORTIS_CUTOFF || lot.isJudicialSale)
  ) {
    const result = method({
      key: "inheritance-7",
      label: "7% of transfer value",
      rule: acquisitionDate < INHERITANCE_CAUSA_MORTIS_CUTOFF ? "5A(5)(c)(i)" : "5A(5)(c)(ii)",
      rate: 0.07,
      basis: values.transferValue,
      tax: values.transferValue * 0.07,
    });
    return finish(lot, base, [result], result.key);
  }

  let effectiveAcquisitionDate = acquisitionDate;
  const donationWithinFiveYears =
    acquisitionType === "donation" && noLaterThanYears(acquisitionDate, transferDate, 5);
  if (donationWithinFiveYears) {
    effectiveAcquisitionDate = String(lot.previousAcquisitionDate || "");
    if (!validDate(effectiveAcquisitionDate)) {
      return {
        ...base,
        methods: [],
        selected: "",
        recommended: "",
        lowest: "",
        status: "incomplete",
        warnings: [],
        appliedRule: "5A(5)(b), third proviso",
        warning:
          "For a donation made five years or less before transfer, enter the donor's preceding acquisition date.",
      };
    }
  }

  const normalMethod = normalFlatMethod(
    lot,
    effectiveAcquisitionDate,
    transferDate,
    values.transferValue,
  );
  const qualifying = qualifyingRateMethod(
    lot,
    effectiveAcquisitionDate,
    transferDate,
    values.transferValue,
    normalMethod,
  );
  if (lot.qualifyingRate && !qualifying.method)
    return finish(lot, base, [], "", [qualifying.warning]);

  const fiveYear = fiveYearMethod(
    lot,
    effectiveAcquisitionDate,
    transferDate,
    values.transferValue,
  );
  if (lot.qualifiesFiveYearRate && !fiveYear.method)
    return finish(lot, base, [], "", [fiveYear.warning]);

  const alternative = qualifying.method || fiveYear.method || normalMethod;
  const usesIncreaseMethod =
    (acquisitionType === "inheritance" && acquisitionDate >= INHERITANCE_CAUSA_MORTIS_CUTOFF) ||
    (acquisitionType === "donation" && !donationWithinFiveYears && !lot.isProject);

  if (usesIncreaseMethod) {
    if (lot.acquisitionValue === "" || lot.acquisitionValue === undefined) {
      return {
        ...base,
        methods: [],
        selected: "",
        recommended: "",
        lowest: "",
        status: "incomplete",
        warnings: [],
        warning:
          acquisitionType === "inheritance"
            ? "Enter the causa mortis acquisition value for this fraction."
            : "Enter the acquisition value for this donated fraction.",
      };
    }
    if (acquisitionType === "inheritance") {
      const basis = lot.acquisitionValueBasis || "";
      if (!["cm-declared", "market-at-inheritance", "final-assessment"].includes(basis)) {
        return {
          ...base,
          methods: [],
          selected: "",
          recommended: "",
          lowest: "",
          status: "incomplete",
          warnings: [],
          appliedRule: "5A(6)(b) and S.L. 123.92",
          warning:
            "Choose the legal basis for the inheritance acquisition value before applying the 12% method.",
        };
      }
      if (basis === "cm-declared" && !lot.cmValueEligibilityConfirmed) {
        const timing =
          acquisitionDate < "2003-11-25"
            ? "the declaration/adjustment notice was given by 30 June 2005"
            : "the declaration and notice satisfied the applicable six-month and filing deadlines";
        return {
          ...base,
          methods: [],
          selected: "",
          recommended: "",
          lowest: "",
          status: "incomplete",
          warnings: [],
          appliedRule: "5A(6)(b) and S.L. 123.92",
          warning: `Confirm that ${timing}, or use the market value at inheritance/final assessment instead.`,
        };
      }
    }
    const increaseMethod = method({
      key: "increase-12",
      label: "12% of transfer value less acquisition value",
      rule: acquisitionType === "inheritance" ? "5A(5)(b)(i)" : "5A(5)(b)(ii)",
      rate: 0.12,
      basis: base.increase,
      tax: base.increase * 0.12,
      note:
        acquisitionType === "inheritance"
          ? lot.acquisitionValueBasis === "cm-declared"
            ? "Acquisition value uses the eligible causa mortis declaration value."
            : lot.acquisitionValueBasis === "final-assessment"
              ? "Acquisition value uses the final and conclusive assessment."
              : "Acquisition value uses market value at inheritance."
          : "",
    });
    const electedAlternative = {
      ...alternative,
      key: `elected-${alternative.key}`,
      label: `${alternative.label} (election)`,
      requiresElection: true,
      note: [
        alternative.note,
        "The election must be declared to the notary and recorded in the deed.",
      ]
        .filter(Boolean)
        .join(" "),
    };
    return finish(
      lot,
      base,
      [increaseMethod, electedAlternative],
      increaseMethod.key,
      values.marketValueOverrides
        ? ["Market value is higher than consideration and is therefore the transfer value."]
        : [],
    );
  }

  return finish(
    lot,
    base,
    [alternative],
    alternative.key,
    values.marketValueOverrides
      ? ["Market value is higher than consideration and is therefore the transfer value."]
      : [],
  );
}
