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

  it("states the privacy roles, feedback logging and explicit retention period", () => {
    expect(PRIVACY_NOTICE_SECTIONS).toHaveLength(7);
    const html = renderToStaticMarkup(<PrivacyNoticeContent />);
    expect(html).toContain("the User is the data controller");
    expect(html).toContain("account-deletion requests");
    expect(html).toContain("technical error details");
    expect(html).toContain(
      "feedback row does not contain the sender&#x27;s account ID or email address",
    );
    expect(html).toContain("Supabase service logs may record the authenticated user ID");
    expect(html).toContain("must not include client names");
    expect(html).toContain("per-account counters used solely to limit feedback abuse");
    expect(html).toContain("ordinarily retained for up to 24 months from submission");
    expect(html).toContain("deleted the next time feedback is submitted");
    expect(html).toContain("if the service is dormant");
    expect(html).toContain("rate-limit counters are ordinarily retained for up to 24 hours");
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
