export function normalizeImportedName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[-–—]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const aliases = {
  mohd: 'mohammad',
  mohammed: 'mohammad',
  mohammad: 'mohammad',
  osamah: 'osama',
  osama: 'osama',
  zaiton: 'zaitoun',
  eraj: 'oraij',
  oraij: 'oraij',
};

function tokens(value) {
  return normalizeImportedName(value).split(' ').filter(Boolean).map((token) => aliases[token] || token);
}

export function tokenSimilarity(first, second) {
  if (!first || !second) return 0;
  if (first === second) return 1;
  let previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let row = 1; row <= first.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= second.length; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (first[row - 1] === second[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return Math.max(0, 1 - previous[second.length] / Math.max(first.length, second.length));
}

export function importedNameScore(firstName, secondName) {
  const first = tokens(firstName);
  const second = tokens(secondName);
  if (!first.length || !second.length) return 0;
  if (first.join(' ') === second.join(' ')) return 1;
  if ([...first].sort().join(' ') === [...second].sort().join(' ')) return 0.98;
  const sharedTokens = first.filter((token) => second.includes(token));
  const shorter = Math.min(first.length, second.length);
  if (shorter >= 2 && sharedTokens.length === shorter) return 0.92 + Math.min(0.06, sharedTokens.length / Math.max(first.length, second.length) * 0.06);
  if (first.length >= 2 && second.length >= 2 && first[0] === second[0]) {
    const surnameSimilarity = tokenSimilarity(first.at(-1), second.at(-1));
    if (first[0].length >= 5 && surnameSimilarity >= 0.7 && first.at(-1).slice(0, 3) === second.at(-1).slice(0, 3)) return 0.9 + Math.min(0.07, surnameSimilarity * 0.07);
  }

  const firstSimilarity = tokenSimilarity(first[0], second[0]);
  const lastSimilarity = tokenSimilarity(first.at(-1), second.at(-1));
  const common = first.filter((token) => second.includes(token)).length / Math.max(first.length, second.length);
  const ordered = Math.min(first.length, second.length) >= 2
    ? first.slice(0, Math.min(first.length, second.length)).reduce((sum, token, index) => sum + (token === second[index] ? 1 : 0), 0) / Math.min(first.length, second.length)
    : 0;
  return Math.min(1, Math.max(
    common * 0.35 + lastSimilarity * 0.35 + firstSimilarity * 0.2 + ordered * 0.08,
    lastSimilarity * 0.48 + firstSimilarity * 0.3 + common * 0.08,
  ));
}

export function findConfidentNameMatch(roster, name, externalId = '') {
  if (externalId) {
    const byId = roster.find((student) => String(student.external_student_id || student.id || '') === String(externalId));
    if (byId) return { item: byId, score: 1, mode: 'id' };
  }

  const normalized = normalizeImportedName(name);
  const exact = roster.filter((student) => normalizeImportedName(student.display_name || student.name) === normalized);
  if (exact.length === 1) return { item: exact[0], score: 1, mode: 'exact' };
  if (exact.length > 1) return { item: null, score: 1, mode: 'ambiguous-exact' };
  const inputTokens = tokens(name);
  if (inputTokens.length === 1) {
    const tokenMatches = roster.filter((student) => tokens(student.display_name || student.name).includes(inputTokens[0]));
    if (tokenMatches.length === 1) return { item: tokenMatches[0], score: 0.93, mode: 'unique-token' };
    if (tokenMatches.length > 1) return { item: null, score: 0.75, mode: 'ambiguous-token' };
  }

  const scored = roster
    .map((student) => ({ item: student, score: importedNameScore(student.display_name || student.name, name) }))
    .sort((first, second) => second.score - first.score);
  if (!scored.length || scored[0].score < 0.9) return { item: null, score: scored[0]?.score || 0, mode: 'low-confidence' };
  if (scored[1] && scored[0].score - scored[1].score < 0.07) return { item: null, score: scored[0].score, mode: 'ambiguous-fuzzy' };
  return { item: scored[0].item, score: scored[0].score, mode: 'fuzzy' };
}

export function matchImportedRoster(existingStudents = [], importedStudents = []) {
  return importedStudents.map((imported) => {
    const importedName = imported.display_name || imported.name || '';
    const externalId = imported.external_student_id || '';

    // ID match
    if (externalId) {
      const byId = existingStudents.find((s) => s.external_student_id && String(s.external_student_id) === String(externalId));
      if (byId) {
        return {
          ...imported,
          status: 'exact',
          mode: 'id',
          matchedStudent: byId,
          score: 1,
          candidates: [byId],
          resolution: String(byId.id),
          include: true,
        };
      }
    }

    // Exact name match
    const norm = normalizeImportedName(importedName);
    const aliasMatches = existingStudents.filter((s) => (s.aliases || []).some((alias) => normalizeImportedName(alias.alias_name || alias) === norm));
    if (aliasMatches.length === 1) return { ...imported, status: 'exact', mode: 'alias', matchedStudent: aliasMatches[0], score: 1, candidates: aliasMatches, resolution: String(aliasMatches[0].id), include: true };
    if (aliasMatches.length > 1) return { ...imported, status: 'ambiguous', mode: 'ambiguous-alias', matchedStudent: null, score: 1, candidates: aliasMatches, resolution: '', include: true };
    const exact = existingStudents.filter((s) => normalizeImportedName(s.display_name || s.name) === norm);
    if (exact.length === 1) {
      return {
        ...imported,
        status: 'exact',
        mode: 'exact',
        matchedStudent: exact[0],
        score: 1,
        candidates: exact,
        resolution: String(exact[0].id),
        include: true,
      };
    }
    if (exact.length > 1) {
      return {
        ...imported,
        status: 'ambiguous',
        mode: 'ambiguous-exact',
        matchedStudent: null,
        score: 1,
        candidates: exact,
        resolution: '', // requires teacher selection
        include: true,
      };
    }

    const inputTokens = tokens(importedName);
    if (inputTokens.length === 1) {
      const tokenMatches = existingStudents.filter((student) => tokens(student.display_name || student.name).includes(inputTokens[0]));
      if (tokenMatches.length === 1) return { ...imported, status: 'fuzzy', mode: 'unique-token', matchedStudent: tokenMatches[0], score: 0.93, candidates: [tokenMatches[0]], resolution: String(tokenMatches[0].id), include: true };
      if (tokenMatches.length > 1) return { ...imported, status: 'ambiguous', mode: 'ambiguous-token', matchedStudent: null, score: 0.75, candidates: tokenMatches, resolution: '', include: true };
    }

    // Fuzzy matching
    const scored = existingStudents
      .map((s) => ({ student: s, score: importedNameScore(s.display_name || s.name, importedName) }))
      .sort((a, b) => b.score - a.score);

    if (scored.length && scored[0].score >= 0.88 && (!scored[1] || scored[0].score - scored[1].score >= 0.07)) {
      return {
        ...imported,
        status: 'fuzzy',
        mode: 'fuzzy',
        matchedStudent: scored[0].student,
        score: scored[0].score,
        candidates: [scored[0].student],
        resolution: String(scored[0].student.id),
        include: true,
      };
    }

    const ambiguousCandidates = scored.filter((c) => c.score >= 0.70);
    if (ambiguousCandidates.length >= 2 || (scored.length && scored[0].score >= 0.75)) {
      return {
        ...imported,
        status: 'ambiguous',
        mode: 'ambiguous-fuzzy',
        matchedStudent: null,
        score: scored[0]?.score || 0,
        candidates: ambiguousCandidates.map((c) => c.student),
        resolution: '', // requires teacher selection
        include: true,
      };
    }

    // Unmatched / New student
    return {
      ...imported,
      status: 'unmatched',
      mode: 'new',
      matchedStudent: null,
      score: 0,
      candidates: [],
      resolution: 'new',
      include: true,
    };
  });
}

