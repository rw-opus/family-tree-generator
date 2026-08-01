const COVERAGE_EPSILON = 1e-10;

function participantsOf(declaration = {}) {
  if (Array.isArray(declaration.participants)) {
    return { participants: declaration.participants, legacyUnquantified: false };
  }
  return {
    participants: (declaration.heirIds || []).map((heirId) => ({ heirId })),
    legacyUnquantified: Boolean((declaration.heirIds || []).length),
  };
}

function participantValues(participant = {}) {
  return {
    numerator: Number(participant.numerator),
    denominator: Number(participant.denominator),
    declaredValue: Number(participant.declaredValue),
  };
}

function isUsableParticipant(participant = {}) {
  const { numerator, denominator, declaredValue } = participantValues(participant);
  return (
    Boolean(participant.heirId) &&
    Number.isFinite(numerator) &&
    numerator > 0 &&
    Number.isFinite(denominator) &&
    denominator > 0 &&
    Number.isFinite(declaredValue) &&
    declaredValue > 0
  );
}

function expectedShare(heir = {}) {
  if (
    heir.share !== undefined &&
    heir.share !== null &&
    heir.share !== "" &&
    Number.isFinite(Number(heir.share))
  ) {
    return Math.max(0, Number(heir.share));
  }
  if (
    heir.sharePercent !== undefined &&
    heir.sharePercent !== null &&
    heir.sharePercent !== "" &&
    Number.isFinite(Number(heir.sharePercent))
  ) {
    return Math.max(0, Number(heir.sharePercent)) / 100;
  }
  return 0;
}

export function validateDeclaration(declaration) {
  const { participants, legacyUnquantified } = participantsOf(declaration);
  if (!participants.length) return "Select at least one declarant.";
  if (legacyUnquantified) {
    return "This legacy declaration needs an ownership fraction and declared value for every declarant.";
  }
  if (new Set(participants.map((participant) => participant.heirId)).size !== participants.length)
    return "An heir can appear only once in the same declaration.";
  if (
    participants.some(
      (participant) =>
        !(Number(participant.numerator) > 0) || !(Number(participant.denominator) > 0),
    )
  )
    return "Enter a valid positive ownership fraction for every declarant.";
  if (participants.some((participant) => !(Number(participant.declaredValue) > 0)))
    return "Enter a positive declared value for every declarant.";
  if (!declaration.date) return "Enter the date of the Declaration Causa Mortis.";
  if (!String(declaration.notaryName || "").trim()) return "Enter the notary's name.";
  return "";
}

export function declarationCoverage(heirs = [], declarations = []) {
  return heirs.map((heir) => {
    const records = declarations.filter((declaration) => {
      const { participants } = participantsOf(declaration);
      return participants.some((participant) => participant.heirId === heir.id);
    });
    const declarationParticipants = records.flatMap((record) => {
      const { participants, legacyUnquantified } = participantsOf(record);
      return participants
        .filter((participant) => participant.heirId === heir.id)
        .map((participant) => ({ participant, legacyUnquantified }));
    });
    const usableParticipants = declarationParticipants.filter(
      ({ participant, legacyUnquantified }) =>
        !legacyUnquantified && isUsableParticipant(participant),
    );
    const unusableDeclarationCount = declarationParticipants.length - usableParticipants.length;
    const declaredFraction = usableParticipants.reduce((sum, { participant }) => {
      const { numerator, denominator } = participantValues(participant);
      return sum + numerator / denominator;
    }, 0);
    const declaredValue = usableParticipants.reduce(
      (sum, { participant }) => sum + participantValues(participant).declaredValue,
      0,
    );
    const requiredFraction = expectedShare(heir);
    const difference = declaredFraction - requiredFraction;
    const status = unusableDeclarationCount
      ? "invalid"
      : Math.abs(difference) <= COVERAGE_EPSILON
        ? "complete"
        : difference < 0
          ? "under"
          : "over";
    const hasUsableDeclaredValues =
      records.length > 0 &&
      unusableDeclarationCount === 0 &&
      declaredFraction > COVERAGE_EPSILON &&
      declaredValue > 0 &&
      status !== "over";
    return {
      heirId: heir.id,
      name: heir.name || "Unnamed heir",
      declarationCount: records.length,
      usableDeclarationCount: records.length,
      declarationIds: records.map((record) => record.id),
      declaredFraction,
      declaredValue,
      requiredFraction,
      difference,
      status,
      unusableDeclarationCount,
      hasUsableDeclaredValues,
      // Compatibility aliases for existing saved tax lots and integrations.
      // DCM status is deliberately ignored; every recorded declaration is counted.
      publishedCount: records.length,
      publishedFraction: declaredFraction,
      publishedValue: declaredValue,
      unusablePublishedCount: unusableDeclarationCount,
      hasUsablePublishedValues: hasUsableDeclaredValues,
    };
  });
}
