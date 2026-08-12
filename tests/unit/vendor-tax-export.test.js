import { describe, expect, it } from "vitest";
import { vendorTaxSpreadsheetXml } from "../../src/domain/vendorTaxExport.js";

describe("vendor tax Excel export", () => {
  it("creates a typed Excel workbook with each source, CM value, tax and net balance", () => {
    const xml = vendorTaxSpreadsheetXml(
      {
        vendors: [
          {
            id: "vendor",
            name: "Maria Borg",
            share: 0.25,
            rows: [
              {
                provenance: "Inherited from Joseph Borg",
                inheritanceDate: "2020-01-02",
                share: 0.25,
                declarations: [
                  {
                    date: "2020-01-02",
                    declaredShare: 0.25,
                    declaredShareFraction: { numerator: 1, denominator: 4 },
                    declaredValue: 100,
                    notaryName: "A. Notary",
                  },
                ],
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
                  {
                    key: "elected-whole-8",
                    label: "8% of selling price",
                    rate: 0.08,
                    basis: 120,
                    tax: 9.6,
                    requiresElection: true,
                  },
                ],
                selectedMethod: { key: "increase-12" },
              },
            ],
            attributedSaleValue: 120,
            tax: 2.4,
          },
        ],
      },
      { address: "1 Republic Street" },
      [
        {
          id: "initial-owner",
          date: "",
          title: "Initial ownership",
          description: "Joseph Borg starts with the whole property.",
        },
        {
          id: "succession-joseph",
          date: "2020-01-02",
          title: "Succession of Joseph Borg",
          description: "Maria Borg receives one quarter by inheritance.",
        },
      ],
    );

    expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(xml).toContain('<Worksheet ss:Name="Tax Calculation">');
    expect(xml).toContain("Maria Borg");
    expect(xml).toContain("1/4");
    expect(xml).toContain("Inherited from Joseph Borg");
    expect(xml).toContain("02/01/2020 · Not. A. Notary: CM fraction 1/4; EUR 100.00");
    expect(xml).toContain("12% of difference");
    expect(xml).toContain("8% of selling price");
    expect(xml).toContain("Applied");
    expect(xml).toContain("Alternative");
    expect(xml).toContain("Election required");
    expect(xml).toContain("Full succession and ownership history");
    expect(xml).toContain("Succession of Joseph Borg");
    expect(xml).toContain("Maria Borg receives one quarter by inheritance.");
    expect(xml).toContain('<Data ss:Type="Number">117.6</Data>');
    expect(xml).toContain("1 Republic Street");
    expect(xml).toContain('<NumberFormat ss:Format="0.00%"/>');
    expect(xml.match(/<Worksheet ss:Name=/g) || []).toHaveLength(1);
    const declaredRowCount = Number(xml.match(/ss:ExpandedRowCount="(\d+)"/)?.[1]);
    expect(declaredRowCount).toBe((xml.match(/<Row(?:\s|>)/g) || []).length);
  });

  it("keeps negative sale-to-declaration differences visible in the workings", () => {
    const xml = vendorTaxSpreadsheetXml({
      vendors: [
        {
          id: "vendor",
          name: "Maria Borg",
          share: 1,
          attributedSaleValue: 90,
          tax: 0,
          rows: [
            {
              provenance: "Inherited from Joseph Borg",
              share: 1,
              declarations: [],
              declaredValue: 100,
              attributedSaleValue: 90,
              difference: -10,
              methods: [],
              warning: "Incomplete",
            },
          ],
        },
      ],
    });

    expect(xml).toContain('<Data ss:Type="Number">-10</Data>');
  });

  it("escapes workbook text and strips invalid XML controls", () => {
    const xml = vendorTaxSpreadsheetXml(
      {
        vendors: [
          {
            id: "vendor",
            name: '<script>alert("x")</script>\u0000',
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

    expect(xml).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(xml).not.toContain("<script>");
    expect(xml).not.toContain("\u0000");
  });
});
