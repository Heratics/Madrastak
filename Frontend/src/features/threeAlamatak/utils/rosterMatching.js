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
    const byId = roster.find((student) => String(student.id || '') === String(externalId));
    if (byId) return { item: byId, score: 1, mode: 'id' };
  }

  const normalized = normalizeImportedName(name);
  const exact = roster.filter((student) => normalizeImportedName(student.name) === normalized);
  if (exact.length === 1) return { item: exact[0], score: 1, mode: 'exact' };
  if (exact.length > 1) return { item: null, score: 1, mode: 'ambiguous-exact' };

  const scored = roster
    .map((student) => ({ item: student, score: importedNameScore(student.name, name) }))
    .sort((first, second) => second.score - first.score);
  if (!scored.length || scored[0].score < 0.9) return { item: null, score: scored[0]?.score || 0, mode: 'low-confidence' };
  if (scored[1] && scored[0].score - scored[1].score < 0.07) return { item: null, score: scored[0].score, mode: 'ambiguous-fuzzy' };
  return { item: scored[0].item, score: scored[0].score, mode: 'fuzzy' };
}
