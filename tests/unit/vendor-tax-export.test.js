import { describe, expect, it } from "vitest";
import { vendorTaxSpreadsheetHtml } from "../../src/domain/vendorTaxExport.js";

describe("vendor tax Excel export", () => {
  it("includes each vendor source, CM value, tax alternative and net balance", () => {
    const html = vendorTaxSpreadsheetHtml(
      {
        vendors: [
          {
            id: "vendor",
            name: "Maria Borg",
            share: 0.25,
            rows: [
              {
                provenance: "Inherited from Joseph Borg",
                share: 0.25,
                declarations: [{ date: "2020-01-02", declaredValue: 100, notaryName: "A. Notary" }],
                declaredValue: 100,
                attributedSaleValue: 120,
                difference: 20,
                methods: [
                  {
                    key: "increase-12",
                    label: "12% of difference",
                    rate: 0.12,
                    basis: 20,
                    tax: 2.4,
                  },
                ],
              },
            ],
          },
        ],
      },
      { address: "1 Republic Street" },
    );

    expect(html).toContain("Maria Borg");
    expect(html).toContain("1/4");
    expect(html).toContain("Inherited from Joseph Borg");
    expect(html).toContain("02-01-2020: EUR 100.00");
    expect(html).toContain("12% of difference");
    expect(html).toContain("117.60");
    expect(html).toContain("1 Republic Street");
  });

  it("escapes workbook cell text", () => {
    const html = vendorTaxSpreadsheetHtml(
      {
        vendors: [
          {
            id: "vendor",
            name: "<script>alert(1)</script>",
            share: 1,
            rows: [
              {
                provenance: "Initial ownership",
                share: 1,
                declarations: [],
                declaredValue: 0,
                attributedSaleValue: 0,
                difference: 0,
                methods: [],
                warning: "Incomplete",
              },
            ],
          },
        ],
      },
      {},
    );

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
