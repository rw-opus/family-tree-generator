export function validateDeclaration(declaration) {
  const participants = declaration.participants || (declaration.heirIds || []).map((heirId) => ({ heirId, numerator: 0, denominator: 1, declaredValue: 0 }));
  if (!participants.length) return "Select at least one declarant.";
  if (new Set(participants.map((participant) => participant.heirId)).size !== participants.length) return "An heir can appear only once in the same declaration.";
  if (participants.some((participant) => !(Number(participant.numerator) > 0) || !(Number(participant.denominator) > 0))) return "Enter a valid positive ownership fraction for every declarant.";
  if (participants.some((participant) => Number(participant.declaredValue) < 0 || !Number.isFinite(Number(participant.declaredValue)))) return "Enter a valid declared value for every declarant.";
  if (declaration.status === "published" && !declaration.date) return "Enter the publication date.";
  if (declaration.status === "published" && !String(declaration.notaryName || "").trim()) return "Enter the notary's name.";
  return "";
}

export function declarationCoverage(heirs = [], declarations = []) {
  return heirs.map((heir) => {
    const records = declarations.filter((declaration) => {
      const participants = declaration.participants || (declaration.heirIds || []).map((heirId) => ({ heirId, numerator: 0, denominator: 1, declaredValue: 0 }));
      return participants.some((participant) => participant.heirId === heir.id);
    });
    const publishedParticipants = records.filter((record) => record.status === "published").flatMap((record) => record.participants || []).filter((participant) => participant.heirId === heir.id);
    return {
      heirId: heir.id,
      name: heir.name || "Unnamed heir",
      declarationCount: records.length,
      publishedCount: records.filter((record) => record.status === "published").length,
      declarationIds: records.map((record) => record.id),
      publishedFraction: publishedParticipants.reduce((sum, participant) => sum + Number(participant.numerator || 0) / Number(participant.denominator || 1), 0),
      publishedValue: publishedParticipants.reduce((sum, participant) => sum + Number(participant.declaredValue || 0), 0),
    };
  });
}
