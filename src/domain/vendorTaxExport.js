import { isoDateToDisplay } from "./dateFormat.js";
import { displayNotaryName } from "./notary.js";
import { approximateFraction } from "./ownership.js";
import { buildPersonDataExport } from "./personDataExport.js";

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

const hasNumericValue = (value) =>
  value !== null &&
  value !== undefined &&
  !(typeof value === "string" && value.trim() === "") &&
  Number.isFinite(Number(value));

const numberCell = (value, styleId = "Money") =>
  !hasNumericValue(value)
    ? stringCell("")
    : `<Cell ss:StyleID="${styleId}"><Data ss:Type="Number">${Number(value)}</Data></Cell>`;

const percentageCell = (value) => numberCell(value, "Percentage");

const calculatedMoneyCell = (value, calculationAvailable) =>
  calculationAvailable ? numberCell(value) : stringCell("Not calculated");

const mergedCell = (value, mergeAcross, styleId = "Text") =>
  `<Cell ss:StyleID="${styleId}" ss:MergeAcross="${mergeAcross}"><Data ss:Type="String">${escapeXml(
    value,
  )}</Data></Cell>`;

const rowXml = (cells, styleId) =>
  `<Row${styleId ? ` ss:StyleID="${styleId}"` : ""}>${cells.join("")}</Row>`;

const declarationSummary = (declaration) => {
  const declaredValue = hasNumericValue(declaration.declaredValue)
    ? `EUR ${Number(declaration.declaredValue).toFixed(2)}`
    : "declared value not recorded";
  return `${isoDateToDisplay(declaration.date) || declaration.date || "Undated"}${
    declaration.notaryName ? ` · ${displayNotaryName(declaration.notaryName)}` : ""
  }: CM fraction ${fractionLabel(
    declaration.declaredShare,
    declaration.declaredShareFraction,
  )}; ${declaredValue}`;
};

const taxChoiceRows = (report, { sellingPriceAvailable = false } = {}) =>
  report.vendors.flatMap((vendor) =>
    vendor.rows.flatMap((row) => {
      const methods = row.methods.length ? row.methods : [null];
      const declarations = row.declarations.length
        ? row.declarations.map(declarationSummary).join("; ")
        : "";

      return methods.map((method) => {
        const tax = method?.tax ?? row.tax ?? null;
        const net =
          tax == null || !hasNumericValue(row.attributedSaleValue)
            ? null
            : Number(row.attributedSaleValue) - Number(tax);
        const applied = Boolean(
          method && row.selectedMethod && method.key === row.selectedMethod.key,
        );
        const choiceStatus = method ? (applied ? "Applied" : "Alternative") : "Incomplete";

        return rowXml([
          stringCell(vendor.name),
          stringCell(fractionLabel(vendor.share, vendor.shareFraction), "CenteredText"),
          calculatedMoneyCell(vendor.attributedSaleValue, sellingPriceAvailable),
          calculatedMoneyCell(vendor.tax, sellingPriceAvailable && vendor.tax != null),
          stringCell(row.provenance),
          stringCell(isoDateToDisplay(row.inheritanceDate) || row.inheritanceDate || ""),
          stringCell(fractionLabel(row.share, row.shareFraction), "CenteredText"),
          stringCell(declarations),
          numberCell(row.declaredValue),
          calculatedMoneyCell(row.attributedSaleValue, sellingPriceAvailable),
          calculatedMoneyCell(row.difference, sellingPriceAvailable),
          stringCell(method?.label || row.warning || "Incomplete"),
          stringCell(choiceStatus, applied ? "AppliedText" : "Text"),
          stringCell(method?.requiresElection ? "Yes" : method ? "No" : ""),
          percentageCell(method?.rate),
          calculatedMoneyCell(method?.basis ?? null, sellingPriceAvailable && Boolean(method)),
          calculatedMoneyCell(tax, sellingPriceAvailable && tax != null),
          calculatedMoneyCell(net, sellingPriceAvailable && net != null),
        ]);
      });
    }),
  );

const successionHistoryRows = (events = []) =>
  events.length
    ? events.map((event, index) => {
        const description = [event.description, ...(event.warnings || [])]
          .filter(Boolean)
          .join(" ");
        return rowXml([
          numberCell(index + 1, "Integer"),
          stringCell(isoDateToDisplay(event.date) || event.date || "Undated"),
          stringCell(event.title || "Ownership event"),
          mergedCell(description, 14),
        ]);
      })
    : [rowXml([mergedCell("No succession or ownership events are available.", 17)])];

const personDataColumns = [
  ["Surname", "surname", 90],
  ["Name", "name", 105],
  ["Parents' names", "parents", 185],
  ["Date of death", "dateOfDeath", 120],
  ["Succession basis", "succession", 105],
  ["Will date", "willDate", 75],
  ["Will notary", "willNotary", 110],
  ["Will description", "willDescription", 150],
  ["Data status", "dataStatus", 100],
  ["Family tree status", "familyTreeStatus", 190],
  ["Missing data", "missingData", 190],
  ["Available data", "availableData", 220],
  ["Surname at birth", "surnameAtBirth", 100],
  ["Sex", "sex", 60],
  ["Date of birth", "dateOfBirth", 75],
  ["Father", "father", 120],
  ["Mother", "mother", 120],
  ["Spouses / partners", "spouses", 190],
  ["Children", "children", 180],
  ["Siblings", "siblings", 180],
  ["Designations", "designations", 120],
  ["Marital status at death", "maritalStatusAtDeath", 130],
  ["Other recorded wills", "otherWills", 210],
  ["Will beneficiaries", "willBeneficiaries", 210],
  ["Will beneficiaries confirmed", "willBeneficiariesConfirmed", 130],
  ["Recorded intestate heirs", "intestateHeirs", 210],
  ["Intestate heirs confirmed", "intestateHeirsConfirmed", 125],
  ["Survival status", "survivalStatus", 115],
  ["Declaration Causa Mortis", "causaMortis", 260],
  ["Initial ownership", "initialOwnership", 180],
  ["Lifetime property transfers", "transfers", 230],
  ["Tax position", "taxPosition", 150],
  ["GEDCOM birth source", "gedcomBirthDate", 110],
  ["GEDCOM death source", "gedcomDeathDate", 110],
  ["GEDCOM ID", "gedcomId", 90],
  ["Notes", "notes", 240],
  ["Person ID", "personId", 130],
];

const personDataWorksheet = (personExport, property = {}) => {
  const personRows = personExport.rows.length
    ? personExport.rows.map((person) =>
        rowXml(
          personDataColumns.map(([, key]) =>
            stringCell(
              person[key],
              key === "dataStatus" ? (person.missingData ? "MissingText" : "CompleteText") : "Text",
            ),
          ),
        ),
      )
    : [rowXml([mergedCell("No family-tree people are available.", personDataColumns.length - 1)])];
  const title = `${property.address || "Property"} — Person data register`;
  const expandedRowCount = personRows.length + 2;

  return `<Worksheet ss:Name="Person Data">
  <Table ss:ExpandedColumnCount="${personDataColumns.length}" ss:ExpandedRowCount="${expandedRowCount}" x:FullColumns="1" x:FullRows="1">
   ${personDataColumns.map(([, , width]) => `<Column ss:Width="${width}"/>`).join("")}
   ${rowXml([mergedCell(title, personDataColumns.length - 1, "Title")])}
   ${rowXml(
     personDataColumns.map(([header]) => stringCell(header, "Header")),
     "Header",
   )}
   ${personRows.join("\n   ")}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <FreezePanes/><FrozenNoSplit/><SplitHorizontal>2</SplitHorizontal><TopRowBottomPane>2</TopRowBottomPane>
   <ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios>
  </WorksheetOptions>
 </Worksheet>`;
};

const missingDataWorksheet = (personExport, property = {}) => {
  const columns = [
    ["Surname", "surname", 90],
    ["Name", "name", 105],
    ["Parents' names", "parents", 185],
    ["Family tree status", "familyTreeStatus", 190],
    ["Missing field", "field", 135],
    ["Category", "category", 120],
    ["What is needed", "detail", 300],
    ["Person ID", "personId", 130],
  ];
  const missingRows = personExport.missingRows.length
    ? personExport.missingRows.map((entry) =>
        rowXml(columns.map(([, key]) => stringCell(entry[key], "MissingText"))),
      )
    : [rowXml([mergedCell("No missing person-card data was identified.", columns.length - 1)])];
  const title = `${property.address || "Property"} — Missing person-card data`;
  const expandedRowCount = missingRows.length + 2;

  return `<Worksheet ss:Name="Missing Data">
  <Table ss:ExpandedColumnCount="${columns.length}" ss:ExpandedRowCount="${expandedRowCount}" x:FullColumns="1" x:FullRows="1">
   ${columns.map(([, , width]) => `<Column ss:Width="${width}"/>`).join("")}
   ${rowXml([mergedCell(title, columns.length - 1, "Title")])}
   ${rowXml(
     columns.map(([header]) => stringCell(header, "Header")),
     "Header",
   )}
   ${missingRows.join("\n   ")}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <FreezePanes/><FrozenNoSplit/><SplitHorizontal>2</SplitHorizontal><TopRowBottomPane>2</TopRowBottomPane>
   <ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios>
  </WorksheetOptions>
 </Worksheet>`;
};

export function vendorTaxSpreadsheetXml(report, property = {}, historyEvents = [], caseData = {}) {
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
  const taxRows = taxChoiceRows(report, {
    sellingPriceAvailable: hasNumericValue(property.saleValue),
  });
  const ignoredLegacyWarnings = (report.vendors || []).flatMap((vendor) =>
    (vendor.ignoredStoredTaxLots || []).map(
      (ignoredLot) => `${vendor.name}: saved legacy tax lot not used. ${ignoredLot.reason}`,
    ),
  );
  const ignoredLegacyRows = ignoredLegacyWarnings.length
    ? [
        rowXml([mergedCell("Review warnings", 17, "Title")]),
        ...ignoredLegacyWarnings.map((warning) => rowXml([mergedCell(warning, 17)])),
        rowXml([]),
      ]
    : [];
  const expandedRowCount = historyRows.length + taxRows.length + ignoredLegacyRows.length + 8;
  const personExport = buildPersonDataExport({
    people: caseData.people,
    outsideParties: caseData.outsideParties,
    property,
    propertyReport: caseData.propertyReport,
    taxCalculationReport: report,
    readinessIssuesByPerson: caseData.readinessIssuesByPerson,
    familyPersonIds: caseData.familyPersonIds,
  });

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
  <Style ss:ID="CompleteText" ss:Parent="Text"><Font ss:Bold="1" ss:Color="#004225"/><Interior ss:Color="#E8F4EC" ss:Pattern="Solid"/></Style>
  <Style ss:ID="MissingText" ss:Parent="Text"><Font ss:Color="#7A271A"/><Interior ss:Color="#FDECEA" ss:Pattern="Solid"/></Style>
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
   ${ignoredLegacyRows.join("\n   ")}
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
 ${personDataWorksheet(personExport, property)}
 ${missingDataWorksheet(personExport, property)}
</Workbook>`;
}

export function downloadVendorTaxSpreadsheet(
  report,
  property = {},
  historyEvents = [],
  caseData = {},
) {
  const xml = vendorTaxSpreadsheetXml(report, property, historyEvents, caseData);
  const blob = new Blob([xml], { type: EXCEL_XML_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const baseName = String(property.address || "tax-calculation")
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  link.href = url;
  link.download = `${baseName || "family-tree"}-case-workbook.xls`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
