import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  LEGAL_NOTICE_SECTIONS,
  PRIVACY_NOTICE_SECTIONS,
  LegalNoticeContent,
  PublicLegalPage,
  PrivacyNoticeContent,
  TAX_CALCULATION_DISCLAIMER,
  TERMS_VERSION,
} from "../../src/components/LegalNotice.jsx";

describe("legal and privacy notices", () => {
  it("keeps a versioned and complete legal notice", () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}-.+/);
    expect(LEGAL_NOTICE_SECTIONS).toHaveLength(16);
    expect(new Set(LEGAL_NOTICE_SECTIONS.map((section) => section.h)).size).toBe(16);
    const html = renderToStaticMarkup(<LegalNoticeContent />);
    expect(html).toContain("Professional responsibility remains with the User");
    expect(html).toContain("Governing law and jurisdiction");
    expect(html).toContain(TAX_CALCULATION_DISCLAIMER);
  });

  it("states the privacy roles, deletion path and monitoring limits", () => {
    expect(PRIVACY_NOTICE_SECTIONS).toHaveLength(7);
    const html = renderToStaticMarkup(<PrivacyNoticeContent />);
    expect(html).toContain("the User is the data controller");
    expect(html).toContain("account-deletion requests");
    expect(html).toContain("technical error details");
  });

  it("provides an immediately visible route back from every public legal page", () => {
    const termsHtml = renderToStaticMarkup(<PublicLegalPage page="terms" />);
    const privacyHtml = renderToStaticMarkup(<PublicLegalPage page="privacy" />);

    for (const html of [termsHtml, privacyHtml]) {
      expect(html).toContain('aria-label="Legal page navigation"');
      expect(html).toContain('href="/"');
      expect(html).toContain("Back to Family Tree Generator");
    }
  });
});
