import { isoDateToDisplay } from "./dateFormat.js";
import { displayNotaryName } from "./notary.js";
import { approximateFraction } from "./ownership.js";

const EXCEL_XML_MIME = "application/vnd.ms-excel;charset=utf-8";

const escapeXml = (value) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const fractionLabel = (share, exactFraction = null) => {
  const fraction = exactFraction?.denominator ? exactFraction : approximateFraction(share);
  return `${fraction.numerator}/${fraction.denominator}`;
};

const stringCell = (value, styleId = "Text") =>
  `<Cell ss:StyleID="${styleId}"><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;

const numberCell = (value, styleId = "Money") =>
  value == null || !Number.isFinite(Number(value))
    ? stringCell("")
    : `<Cell ss:StyleID="${styleId}"><Data ss:Type="Number">${Number(value)}</Data></Cell>`;

const percentageCell = (value) =>
  value == null ? stringCell("") : numberCell(value, "Percentage");

const mergedCell = (value, mergeAcross, styleId = "Text") =>
  `<Cell ss:StyleID="${styleId}" ss:MergeAcross="${mergeAcross}"><Data ss:Type="String">${escapeXml(
    value,
  )}</Data></Cell>`;

const rowXml = (cells, styleId) =>
  `<Row${styleId ? ` ss:StyleID="${styleId}"` : ""}>${cells.join("")}</Row>`;

const declarationSummary = (declaration) =>
  `${isoDateToDisplay(declaration.date) || declaration.date || "Undated"}${
    declaration.notaryName ? ` · ${displayNotaryName(declaration.notaryName)}` : ""
  }: EUR ${Number(declaration.declaredValue || 0).toFixed(2)}`;

const taxChoiceRows = (report) =>
  report.vendors.flatMap((vendor) =>
    vendor.rows.flatMap((row) => {
      const methods = row.methods.length ? row.methods : [null];
      const declarations = row.declarations.length
        ? row.declarations.map(declarationSummary).join("; ")
        : "";

      return methods.map((method) => {
        const tax = method?.tax ?? row.tax ?? null;
        const net = tax == null ? null : row.attributedSaleValue - tax;
        const applied = Boolean(
          method && row.selectedMethod && method.key === row.selectedMethod.key,
        );
        const choiceStatus = method ? (applied ? "Applied" : "Alternative") : "Incomplete";

        return rowXml([
          stringCell(vendor.name),
          stringCell(fractionLabel(vendor.share, vendor.shareFraction), "CenteredText"),
          numberCell(vendor.attributedSaleValue),
          numberCell(vendor.tax),
          stringCell(row.provenance),
          stringCell(isoDateToDisplay(row.inheritanceDate) || row.inheritanceDate || ""),
          stringCell(fractionLabel(row.share, row.shareFraction), "CenteredText"),
          stringCell(declarations),
          numberCell(row.declaredValue),
          numberCell(row.attributedSaleValue),
          numberCell(row.difference),
          stringCell(method?.label || row.warning || "Incomplete"),
          stringCell(choiceStatus, applied ? "AppliedText" : "Text"),
          stringCell(method?.requiresElection ? "Yes" : method ? "No" : ""),
          percentageCell(method?.rate),
          numberCell(method?.basis ?? null),
          numberCell(tax),
          numberCell(net),
        ]);
      });
    }),
  );

const successionHistoryRows = (events = []) =>
  events.length
    ? events.map((event, index) =>
        rowXml([
          numberCell(index + 1, "Integer"),
          stringCell(isoDateToDisplay(event.date) || event.date || "Undated"),
          stringCell(event.title || "Ownership event"),
          mergedCell(event.description || "", 14),
        ]),
      )
    : [rowXml([mergedCell("No succession or ownership events are available.", 17)])];

export function vendorTaxSpreadsheetXml(report, property = {}, historyEvents = []) {
  const headers = [
    "Vendor",
    "Total ownership fraction",
    "Vendor selling-price allocation",
    "Vendor selected Final Withholding Tax",
    "Provenance",
    "Source date",
    "Source fraction",
    "Relevant Declaration Causa Mortis records",
    "Declaration Causa Mortis declared value",
    "Attributed selling price",
    "Difference",
    "Tax choice",
    "Choice status",
    "Election required",
    "Rate",
    "Tax basis",
    "Tax under this choice",
    "Net under this choice",
  ];
  const title = `${property.address || "Property"} — Tax Calculation`;
  const historyRows = successionHistoryRows(historyEvents);
  const taxRows = taxChoiceRows(report);
  const expandedRowCount = historyRows.length + taxRows.length + 8;

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Title>${escapeXml(title)}</Title>
 </DocumentProperties>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Top"/><Font ss:FontName="Arial" ss:Size="10"/></Style>
  <Style ss:ID="Title"><Font ss:FontName="Arial" ss:Size="14" ss:Bold="1" ss:Color="#004225"/></Style>
  <Style ss:ID="Header"><Alignment ss:Vertical="Center" ss:WrapText="1"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#004225" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Text"><Alignment ss:Vertical="Top" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8E4DE"/></Borders></Style>
  <Style ss:ID="CenteredText" ss:Parent="Text"><Alignment ss:Horizontal="Center" ss:Vertical="Top"/></Style>
  <Style ss:ID="Money" ss:Parent="Text"><Alignment ss:Horizontal="Right" ss:Vertical="Top"/><NumberFormat ss:Format="€#,##0.00"/></Style>
  <Style ss:ID="Percentage" ss:Parent="Text"><Alignment ss:Horizontal="Right" ss:Vertical="Top"/><NumberFormat ss:Format="0.00%"/></Style>
  <Style ss:ID="Integer" ss:Parent="Text"><Alignment ss:Horizontal="Right" ss:Vertical="Top"/><NumberFormat ss:Format="0"/></Style>
  <Style ss:ID="AppliedText" ss:Parent="Text"><Alignment ss:Horizontal="Center" ss:Vertical="Top"/><Font ss:Bold="1" ss:Color="#004225"/><Interior ss:Color="#E8F4EC" ss:Pattern="Solid"/></Style>
 </Styles>
 <Worksheet ss:Name="Tax Calculation">
  <Table ss:ExpandedColumnCount="18" ss:ExpandedRowCount="${expandedRowCount}" x:FullColumns="1" x:FullRows="1">
   <Column ss:Width="105"/><Column ss:Width="70"/><Column ss:Width="95"/><Column ss:Width="95"/>
   <Column ss:Width="155"/><Column ss:Width="70"/><Column ss:Width="65"/><Column ss:Width="210"/>
   <Column ss:Width="90"/><Column ss:Width="90"/><Column ss:Width="80"/><Column ss:Width="160"/>
   <Column ss:Width="70"/><Column ss:Width="70"/><Column ss:Width="55"/><Column ss:Width="85"/>
   <Column ss:Width="90"/><Column ss:Width="90"/>
   ${rowXml([mergedCell(title, 17, "Title")])}
   ${rowXml([
     stringCell("Property", "Header"),
     mergedCell(property.address || "Unnamed property", 6),
     stringCell("Selling price", "Header"),
     numberCell(property.saleValue),
   ])}
   ${rowXml([])}
   ${rowXml([mergedCell("Full succession and ownership history", 17, "Title")])}
   ${rowXml([
     stringCell("Event", "Header"),
     stringCell("Date", "Header"),
     stringCell("Event type", "Header"),
     mergedCell("Full descendancy and ownership movement", 14, "Header"),
   ])}
   ${historyRows.join("\n   ")}
   ${rowXml([])}
   ${rowXml([mergedCell("Vendor tax workings and available choices", 17, "Title")])}
   ${rowXml(
     headers.map((header) => stringCell(header, "Header")),
     "Header",
   )}
   ${taxRows.join("\n   ")}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;
}

export function downloadVendorTaxSpreadsheet(report, property = {}, historyEvents = []) {
  const xml = vendorTaxSpreadsheetXml(report, property, historyEvents);
  const blob = new Blob([xml], { type: EXCEL_XML_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const baseName = String(property.address || "tax-calculation")
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  link.href = url;
  link.download = `${baseName || "tax-calculation"}-tax-calculation.xls`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
