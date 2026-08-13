import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import "./LegalNotice.css";

export const LEGAL_NOTICE_LAST_UPDATED = "04/08/2026";
// Change this value whenever the notice changes so every user must accept it again.
export const TERMS_VERSION = "2026-08-04-family-tax-v1";

export const TAX_CALCULATION_DISCLAIMER =
  "Every succession, ownership and tax result is an indicative estimate based only on the information entered and the assumptions encoded in the System. It is not legal, tax, notarial, financial or other professional advice, an official assessment, a tax return or a payment instruction. The User must independently verify the facts, the applicable law, every available election or exemption and the final calculation before acting, signing a deed, filing a return or making a payment.";

const LEGAL_NOTICE_INTRO =
  'This software application (the "System") is a family-tree, property-succession and tax-calculation aid made available to account holders and their authorised staff (each, a "User"). By accessing or using the System, the User acknowledges and accepts the terms below. If the User does not accept them, the User must not use the System. In this notice, "operator" means the publisher and licensor of the System.';

export const LEGAL_NOTICE_SECTIONS = [
  {
    h: "1. No legal, tax, notarial, financial or professional advice",
    p: "The System and every family relationship, succession proposal, ownership fraction, property value, tax option, report, spreadsheet or other output it produces are provided for general administrative and informational purposes only. The System does not replace advice from a suitably qualified professional or a determination by any competent authority.",
  },
  {
    h: "2. Professional responsibility remains with the User",
    p: "The System helps the User organise and test the User's own information. The User remains solely responsible for establishing identity, kinship, status, testamentary and intestate rights, dates, values, ownership, declarations causa mortis, tax treatment and every other fact or legal conclusion relevant to a matter, and for complying with all applicable laws, professional duties, filing duties and payment deadlines.",
  },
  {
    h: "3. Accuracy and completeness of information",
    p: "Information shown in the System is entered, imported, inferred or maintained by the User. The operator does not verify source documents, civil-status records, wills, deeds, valuations, ownership or tax data and gives no warranty that any stored or displayed information is accurate, complete, current or fit for a particular purpose. The User must resolve warnings and check every output against the underlying records.",
  },
  {
    h: "4. Succession, ownership and tax calculations are indicative only",
    p: TAX_CALCULATION_DISCLAIMER,
  },
  {
    h: '5. Provided "as is" and "as available"',
    p: 'The System is provided on an "as is" and "as available" basis, without warranties of any kind, whether express or implied, including warranties of accuracy, satisfactory quality, fitness for a particular purpose, non-infringement, uninterrupted or error-free operation, security or freedom from bugs, viruses or technical errors.',
  },
  {
    h: "6. Data, storage and backups",
    p: "The User is responsible for downloading and securely retaining independent backups of information the User considers important. To the maximum extent permitted by law, the operator accepts no liability for loss, corruption, deletion, unauthorised alteration or inaccessibility of data, howsoever caused.",
  },
  {
    h: "7. Security, access credentials and devices",
    p: "Reasonable measures are used to protect the System, but no method of electronic storage or transmission is completely secure. The User is responsible for keeping credentials confidential, securing devices, restricting account access and supervising activity carried out through the User's account. The operator accepts no liability for loss arising from compromised accounts, shared credentials or insecure devices to the extent permitted by law.",
  },
  {
    h: "8. Data protection, lawful use and professional secrecy",
    p: "The User is and remains the controller of personal data the User enters about clients, family members, heirs, vendors, notaries and other persons. The User is responsible for complying with the General Data Protection Regulation (Regulation (EU) 2016/679), the Data Protection Act (Chapter 586 of the Laws of Malta), applicable professional-secrecy and retention duties, and for having an appropriate lawful basis and providing any required notices before processing that data in the System. The operator acts as a service provider and, where applicable, processor acting on the User's instructions.",
  },
  {
    h: "9. Third-party services",
    p: "The System relies on or may interact with third-party hosting, database, authentication, payment, monitoring and connectivity services, including Supabase, Railway, Stripe and any monitoring provider configured by the operator. The operator does not control those providers and accepts no liability for their acts, omissions, availability, security, API changes, outages, delays or failures to the maximum extent permitted by law.",
  },
  {
    h: "10. Limitation of liability",
    p: "To the maximum extent permitted by applicable law, the operator and its owners, employees, contractors, suppliers and partners shall not be liable for any direct, indirect, incidental, special, consequential, punitive or exemplary loss or damage; loss of profit, revenue, business, goodwill, data or anticipated savings; business interruption; security breach; system failure; incorrect succession or ownership allocation; incorrect tax calculation; or any third-party claim arising out of use of, reliance on or inability to use the System. Where liability cannot be wholly excluded, it is limited to the maximum extent the law allows and, where a monetary cap is permitted, shall not exceed the fees paid by the User for the System in the twelve months preceding the event giving rise to the claim.",
  },
  {
    h: "11. Intellectual property and licence",
    p: "The software code, interface, layouts, workflows, calculation logic, reports, documentation and branding forming part of the System are the intellectual property of the operator or its licensors. Access grants only a limited, non-transferable, revocable licence for the User's own authorised work. The User must not copy, reverse engineer, resell, sublicense, redistribute or create a competing product from the System except to the extent expressly permitted by law.",
  },
  {
    h: "12. Indemnity",
    p: "The User agrees to indemnify and hold the operator harmless against claims, losses, liabilities, costs and expenses arising from the User's data, use of the System, professional work, or breach of these terms or applicable law, to the extent such an indemnity is lawful.",
  },
  {
    h: "13. Liabilities that cannot be excluded",
    p: "Nothing in this notice excludes or limits liability that applicable law does not permit to be excluded or limited, including liability for fraud or fraudulent misrepresentation and, where applicable, death or personal injury caused by negligence.",
  },
  {
    h: "14. Changes to the System and this notice",
    p: "The operator may modify, suspend or discontinue the System or update this notice. A material notice change will use a new acceptance version and the User will be asked to accept it before continuing.",
  },
  {
    h: "15. Governing law and jurisdiction",
    p: "This notice and any dispute arising out of or in connection with the System are governed by the laws of Malta, and the User submits to the exclusive jurisdiction of the courts of Malta.",
  },
  {
    h: "16. Acceptance",
    p: "By accepting this notice and continuing to use the System, the User confirms that the User has read, understood and accepted these terms.",
  },
];

export const PRIVACY_NOTICE_SECTIONS = [
  {
    h: "1. Roles",
    p: "For family, property, succession and tax data entered for a client or matter, the User is the data controller and the operator acts as a service provider and, where applicable, processor. For account, licence, payment-status, security and Terms-acceptance records, the operator is the controller.",
  },
  {
    h: "2. What is stored",
    p: "The System stores the account email address and authentication records; family trees and relationship data; names, dates of death, wills, notaries, declarations causa mortis, property details, values, ownership and tax figures entered by the User; tree-credit and payment-status records; acceptance of the Terms; and technical logs required for security and reliability. Stripe processes payment-card details and the System stores only the identifiers and status needed to reconcile a purchase. The System does not use advertising trackers or analytics cookies.",
  },
  {
    h: "3. Purpose and legal basis",
    p: "Data is processed to provide, secure, support and administer the family-tree and property-calculation service, enforce the tree allowance and reconcile payments. The operator does not sell it, disclose it to third parties for their own marketing or use it to train artificial-intelligence models. Processing rests on the contract with the User and, for security and reliability logs, the operator's legitimate interests.",
  },
  {
    h: "4. Access, isolation and service providers",
    p: "Database-level row access rules isolate each account's family trees. Family-tree records are stored in an EU-region Supabase project. Railway hosts the web application, Stripe processes payments, and optional error monitoring receives deliberately reduced technical error details with names, free text, account details and page context removed. These providers operate under their own contractual terms and retention arrangements.",
  },
  {
    h: "5. Retention, backups and account deletion",
    p: "Family-tree data remains until the User deletes a tree or the account is closed. A User may download a workspace backup at any time. On a verified written request, the operator can close the account and delete its active Supabase records after allowing a reasonable export period, subject to provider backup-retention periods and any payment, tax, fraud-prevention or other legal records that must be retained separately. Deletion from an active database does not promise immediate removal from immutable provider backups.",
  },
  {
    h: "6. Data-subject rights",
    p: "Individuals whose data a User records in the System should direct access, rectification, restriction, objection or erasure requests to that User, who decides the request as controller subject to applicable legal and professional retention duties. The operator will reasonably assist the User. Account holders may contact the operator directly about their own account data and may lodge a complaint with the competent supervisory authority.",
  },
  {
    h: "7. Contact",
    p: "Privacy enquiries, account-deletion requests and requests concerning account data should be sent to the operator through the contact details supplied with the licence. The requester may be asked to verify control of the account before a destructive request is carried out.",
  },
];

function NoticeSections({ sections }) {
  return sections.map((section) => (
    <section className="legal-notice-section" key={section.h}>
      <h2>{section.h}</h2>
      <p>{section.p}</p>
    </section>
  ));
}

export function LegalNoticeContent() {
  return (
    <>
      <p className="legal-notice-intro">{LEGAL_NOTICE_INTRO}</p>
      <NoticeSections sections={LEGAL_NOTICE_SECTIONS} />
      <p className="legal-template-warning">
        Last updated: {LEGAL_NOTICE_LAST_UPDATED}. This notice is a product template and is not
        legal advice. It should receive final Maltese legal review before public commercial launch.
      </p>
    </>
  );
}

export function PrivacyNoticeContent() {
  return (
    <>
      <NoticeSections sections={PRIVACY_NOTICE_SECTIONS} />
      <p className="legal-template-warning">
        Last updated: {LEGAL_NOTICE_LAST_UPDATED}. This notice is a product template and should be
        checked against the operator&apos;s final contracts, provider settings and data-processing
        arrangements before launch.
      </p>
    </>
  );
}

export function PublicLegalPage({ page }) {
  const privacy = page === "privacy";
  return (
    <main className="legal-page">
      <div className="legal-page-card">
        <nav className="legal-page-navigation" aria-label="Legal page navigation">
          <a className="library-secondary-button legal-back-link" href="/">
            <ArrowLeft size={16} aria-hidden="true" /> Back to Family Tree Generator
          </a>
        </nav>
        <p className="library-kicker">Family Tree Generator</p>
        <h1>{privacy ? "Privacy Notice" : "Terms, Disclaimer and Limitation of Liability"}</h1>
        <p className="legal-page-subtitle">
          {privacy
            ? "How account, family, property and calculation data is handled."
            : "The conditions and professional safeguards that apply when using the System."}
        </p>
        <div className="legal-page-content">
          {privacy ? <PrivacyNoticeContent /> : <LegalNoticeContent />}
        </div>
        <a className="library-primary-button legal-home-link" href="/">
          <ArrowLeft size={16} aria-hidden="true" /> Back to Family Tree Generator
        </a>
      </div>
    </main>
  );
}

export function TermsGate({ localOnlyMode, onAccept, onSignOut }) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      await onAccept();
    } catch {
      setError("Your acceptance could not be recorded. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="legal-page legal-gate-page">
      <div className="legal-page-card">
        <p className="library-kicker">Before you continue</p>
        <h1>Terms, Tax Disclaimer and Privacy Responsibilities</h1>
        <p className="legal-page-subtitle">
          Please read this notice carefully. The calculations are aids and must be independently
          checked before they are used professionally.
        </p>
        <div className="legal-page-content legal-gate-scroll">
          <LegalNoticeContent />
        </div>
        <label className="legal-acceptance-check">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
          />
          <span>
            I have read, understood and agree to the Terms, Disclaimer and Limitation of Liability
            set out above.
          </span>
        </label>
        {error && (
          <p className="commercial-auth-message error" role="alert">
            {error}
          </p>
        )}
        <div className="legal-gate-actions">
          <button
            type="button"
            className="library-primary-button"
            disabled={!agreed || busy}
            onClick={accept}
          >
            {busy ? "Please wait..." : "Accept and continue"}
          </button>
          {!localOnlyMode && (
            <button type="button" className="library-secondary-button" onClick={onSignOut}>
              Sign out
            </button>
          )}
          <a href="/?legal=privacy" className="commercial-auth-link">
            Read the Privacy Notice
          </a>
        </div>
      </div>
    </main>
  );
}
