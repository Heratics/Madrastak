import { normalizeImportedName, matchImportedRoster, findConfidentNameMatch, importedNameScore } from './rosterMatching.js';

export function parseDelimited(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter((line) => line.trim());
  if (!lines.length) return [];
  const separator = lines[0].includes('\t') ? '\t' : ',';
  return lines.map((line) => {
    const values = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"') {
        if (quoted && line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else quoted = !quoted;
      } else if (character === separator && !quoted) {
        values.push(current);
        current = '';
      } else current += character;
    }
    values.push(current);
    return values;
  });
}

export function cellText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

export function parseImportedNumeric(value) {
  if (value === null || value === undefined || value === '') return { type: 'empty', value: null };
  if (typeof value === 'number' && Number.isFinite(value)) return { type: 'number', value };
  const text = String(value).trim();
  if (!text) return { type: 'empty', value: null };
  if (/^(-?\d+(?:\.\d+)?)$/.test(text)) return { type: 'number', value: Number(text) };
  if (/^(AB|Absent|NA|NS|P)$/i.test(text)) return { type: 'status', value: text.toUpperCase() };
  return { type: 'text', value: text };
}

export function importedDate(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && value > 25000 && value < 70000) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    const [, y, m, d] = match;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const matchSlash = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (matchSlash) {
    const [, d, m, y] = matchSlash;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return text;
}

export function isNameHeader(value) {
  return /^(student\s*(name|names)?|name|learner|pupil|full\s*name|all\s+students?|group\s+members?|اسم الطالب|الاسم)$/i.test(cellText(value));
}

export function isIdHeader(value) {
  return /^(student\s*(number|no\.?|id)|candidate\s*(number|no\.?|id)|admission\s*(number|no\.?|id)|number|num|id|الرقم التسلسلي|الرقم)$/i.test(cellText(value));
}

export function isMetricLabel(value) {
  return /^(average|mean|median|min|max|minimum|maximum|questions?|mark|marks|total|score|grade|grid level|date|due date|student name|student|class|subject|topic|team|leader|member|members|action plan|progress|issue|aim|assessment|assignment|project|semester|paper|candidate|centre|session|explanation|criteria|criterion|level|component|description|status)$/i.test(cellText(value));
}

export function isAggregateLabel(value) {
  return /^(total|total marks?|out of|score|grade|grid level|average|mean|min|max|pioneer|first\s+month\s+assessment|first\s+month|derived|scaled)/i.test(cellText(value));
}

const NON_STUDENT_EXACT = new Set([
  'student name', 'student names', 'name', 'names', 'student', 'topic', 'topics',
  'issue', 'aim', 'action plan', 'progress', 'average', 'total', 'score', 'grade',
  'assessment', 'assignment', 'project', 'team', 'members', 'leader', 'date', 'status',
  'candidate number', 'question paper', 'grid level', 'first semester', 'second semester'
]);

export function isPlausiblePersonName(value) {
  const text = cellText(value);
  if (!text || text.length < 3 || text.length > 90) return false;
  const norm = normalizeImportedName(text);
  if (!norm || NON_STUDENT_EXACT.has(norm) || isMetricLabel(text)) return false;
  if (/\d/.test(text)) return false;
  if (/[\/%:;=@]/.test(text)) return false;
  if (/^(?:yes|no|true|false|pass|fail|p|ab|absent|na|ns)$/i.test(text)) return false;
  const tokens = norm.split(' ').filter(Boolean);
  if (tokens.length < 2 || tokens.length > 7) return false;
  return true;
}

function isStudentCell(value, row = [], nameCol = -1) {
  if (isPlausiblePersonName(value)) return true;
  const text = cellText(value);
  if (!text || text.length < 2 || text.length > 50 || /\d|[\/%:;=@]/.test(text)) return false;
  if (/^(?:name|student|all students?|level|mark|marks|total|absent|na|ns|p)$/i.test(text)) return false;
  return row.some((cell, index) => index !== nameCol && ['number', 'status'].includes(parseImportedNumeric(cell).type));
}

export function findNameBlocks(rows, options = {}) {
  const blocks = [];
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    for (let c = 0; c < (rows[r]?.length || 0); c++) {
      if (isNameHeader(rows[r][c])) {
        let idCol = -1;
        for (let k = 0; k < (rows[r]?.length || 0); k++) {
          if (isIdHeader(rows[r][k])) { idCol = k; break; }
        }
        blocks.push({ headerRow: r, nameCol: c, idCol });
      }
    }
  }
  if (blocks.length) return blocks;

  if (options.allowStructural !== false) {
    const maxCols = Math.min(20, Math.max(0, ...rows.map((r) => r.length || 0)));
    for (let c = 0; c < maxCols; c += 1) {
      const candidates = [];
      for (let r = 0; r < Math.min(rows.length, 35); r += 1) {
        const row = rows[r] || [];
        if (isStudentCell(row[c], row, c) && row.some((cell, index) => index !== c && parseImportedNumeric(cell).type !== 'empty')) candidates.push(r);
      }
      if (candidates.length >= 3) {
        blocks.push({ headerRow: Math.max(0, candidates[0] - 2), nameCol: c, idCol: -1, fallback: true, dataStart: candidates[0] });
        return blocks;
      }
    }
  }

  // Fallback: look for a column with runs of person names
  const maxCols = Math.min(8, Math.max(0, ...rows.map((r) => r.length || 0)));
  for (let c = 0; c < maxCols; c++) {
    for (let r = 0; r < Math.min(rows.length, 20); r++) {
      let run = 0;
      for (let rr = r; rr < Math.min(rows.length, r + 12); rr++) {
        const v = cellText(rows[rr]?.[c]);
        if (isPlausiblePersonName(v)) run += 1;
        else if (run >= 3) break;
        else if (v) run = 0;
      }
      if (run >= 4) {
        blocks.push({ headerRow: Math.max(0, r - 1), nameCol: c, idCol: -1, fallback: true, dataStart: r });
        return blocks;
      }
    }
  }
  return [];
}

export function inferRowsForBlock(rows, block, nextNameCol) {
  const start = block.headerRow;
  const end = nextNameCol ?? Math.min(Math.max(...rows.map((r) => r.length), 0), 120);
  let markRow = -1;
  for (let r = start + 1; r < Math.min(rows.length, start + 7); r++) {
    const slice = (rows[r] || []).slice(block.nameCol, end).map(cellText).join(' ');
    if (/^(?:mark|total mark)\b/i.test(cellText(rows[r]?.[block.nameCol])) || /\bmark\b/i.test(slice) || /\btotal mark\b/i.test(slice)) {
      markRow = r;
      break;
    }
  }
  let dataStart = block.dataStart ?? (markRow >= 0 ? markRow + 1 : start + 1);
  while (dataStart < rows.length) {
    const v = cellText(rows[dataStart]?.[block.nameCol]);
    if (v && !isNameHeader(v) && !isMetricLabel(v)) break;
    dataStart += 1;
  }
  let questionRow = -1;
  for (let r = start; r <= Math.max(start, markRow); r++) {
    const txt = (rows[r] || []).slice(block.nameCol, end).map(cellText).join(' ');
    if (/questions?|topic discussed|assignment|submitted/i.test(txt)) {
      questionRow = r;
      break;
    }
  }
  if (questionRow < 0) questionRow = Math.max(start, markRow - 1);
  return { markRow, dataStart, questionRow, end };
}

export function blockTitle(rows, block, end, sheetName, index) {
  for (let r = 0; r <= Math.min(block.headerRow, 4); r++) {
    const vals = [];
    for (let c = Math.max(0, block.nameCol - 1); c < Math.min(end, block.nameCol + 12); c++) {
      const t = cellText(rows[r]?.[c]);
      if (t && /(assessment|exam|assignment|paper|semester|month|test|quiz)/i.test(t)) vals.push(t);
    }
    if (vals.length) return vals[0];
  }
  const first = cellText(rows[0]?.[block.nameCol]);
  if (first && !isNameHeader(first) && !isMetricLabel(first)) return first;
  return `${sheetName} · Assessment ${index + 1}`;
}

export function inferAssessmentTopic(sheetName, title) {
  const text = String(`${sheetName} ${title}`).toLowerCase();
  const pairs = [
    ['reading', 'Reading'],
    ['writing', 'Writing'],
    ['listening', 'Listening'],
    ['speaking', 'Speaking'],
    ['coursework', 'Coursework'],
    ['mock', 'Mock Exam'],
    ['written exam', 'Written Exam'],
    ['exam', 'Exam'],
    ['team project', 'Team Project'],
    ['individual report', 'Individual Report'],
    ['presentation', 'Presentation'],
    ['social', 'Social'],
    ['global perspectives', 'Global Perspectives'],
    ['gp ', 'Global Perspectives'],
    ['rp ', 'Research Project'],
    ['tp ', 'Team Project'],
    ['ir ', 'Individual Report'],
  ];
  for (const [k, v] of pairs) {
    if (text.includes(k)) return v;
  }
  return sheetName || 'General';
}

function nonEmptyCount(rows) {
  return rows.flat().filter((value) => cellText(value) !== '').length;
}

function hasNameBlock(rows) {
  return rows.slice(0, 10).some((row) => row.some((value) => isNameHeader(value)));
}

export function classifyWorksheet(sheet) {
  const name = String(sheet.name || '').trim();
  const lowerName = name.toLowerCase();
  const rows = sheet.rows || [];
  const preview = rows.slice(0, 10).flat().map(cellText).join(' ');
  const numericCount = rows.slice(0, 100).flat().filter((value) => /^-?\d+(\.\d+)?$/.test(cellText(value))).length;

  if (!nonEmptyCount(rows)) return { type: 'ignore', label: 'Empty / skip', selected: false };
  if (/pioneer|2024[\s-]*2025|historical|archive/i.test(name)) return { type: 'historical', label: 'Historical Data', selected: false };
  if (/^conduct$/i.test(name)) return { type: 'behavior', label: 'Behavior / Conduct', selected: true };
  if (/^social$/i.test(name)) return { type: 'mixed', label: 'Grades + Behavior', selected: true };
  if (/^(list of teams|gp projects 2026)$/i.test(name)) return { type: 'team-projects', label: 'Team Projects', selected: true };
  if (/^tp groups$/i.test(name)) return { type: 'team-projects', label: 'Team Projects / Groups', selected: true };
  if (/^ir submission$/i.test(name)) return { type: 'assignments', label: 'Assignments / Submission Tracker', selected: true };
  if (/grade.?threshold/i.test(lowerName)) return { type: 'threshold', label: 'Grade Threshold Scheme', selected: true };
  if (/criteria|email list/i.test(lowerName)) return { type: 'reference', label: 'Reference / Criteria', selected: false };
  // Explicit roster sheets are the only source allowed to create students.
  if (/^sheet1$/i.test(name) || /^sheet3$/i.test(name)) return { type: 'students', label: 'Students / Roster', selected: true };
  if (rows.some((row) => row.some((value) => /all\s+students?|group\s+members?/i.test(cellText(value))))) return { type: 'students', label: 'Students / Roster / Groups', selected: !sheet.hidden };
  if (findNameBlocks(rows, { allowStructural: true }).length && (numericCount >= 3 || /assessment|exam|marks?|grade|score|question|semester|paper|class|section/i.test(`${name} ${preview}`))) return { type: 'grades', label: 'Grades / Assessments', selected: !sheet.hidden };
  return { type: 'reference', label: 'Reference / view only', selected: false };
}

function rosterPlanScore(plan) {
  const rows = plan.rows || [];
  const nonEmptyRows = rows.filter((row) => row.some((cell) => cellText(cell))).length;
  const hasEmail = rows.some((row) => row.some((cell) => /@/.test(cellText(cell))));
  const singleColumn = rows.length > 0 && rows.every((row) => row.filter((cell) => cellText(cell)).length <= 1);
  return (singleColumn ? 5 : 2) + (hasEmail ? 1 : 0) + (nonEmptyRows ? 1 : 0) + (/sheet3/i.test(plan.name) ? 1 : 0) + ((rows[0] || []).length === 1 ? 1 : 0);
}

function identifyCanonicalRosterPlans(plans) {
  const candidates = plans.filter((plan) => plan.type === 'students' && (plan.rows || []).length);
  if (!candidates.length) return [];
  const bestScore = Math.max(...candidates.map(rosterPlanScore));
  return candidates.filter((plan) => rosterPlanScore(plan) === bestScore);
}

function canonicalRosterFromPlans(plans) {
  const candidates = identifyCanonicalRosterPlans(plans);
  const rosterPlans = candidates.length ? candidates : plans.filter((plan) => plan.selected && plan.type === 'grades');
  const byId = new Map();
  const byName = new Map();
  for (const plan of rosterPlans) {
    const sourceRows = plan.type === 'students'
      ? (() => {
        const header = (plan.rows || []).findIndex((row) => row.some((cell) => isNameHeader(cell)));
        if (header >= 0) {
          const nameCol = (plan.rows[header] || []).findIndex((cell) => isNameHeader(cell));
          return (plan.rows || []).slice(header + 1).map((row) => [row[nameCol]]);
        }
        return plan.rows || [];
      })()
      : findNameBlocks(plan.rows || [], { allowStructural: true }).flatMap((block) => {
        const info = inferRowsForBlock(plan.rows || [], block);
        return (plan.rows || []).slice(info.dataStart).map((row) => [row[block.nameCol], block.idCol >= 0 ? row[block.idCol] : null]);
      });
    for (const row of sourceRows) {
      const cells = row.map(cellText);
      const name = cells.length === 1 ? cells[0] : cells[0] || cells.find((cell) => cell && !/@/.test(cell) && !/^\w[-\w]+$/.test(cell)) || '';
      if (!name || !isStudentCell(name, cells, 0)) continue;
      const externalId = cells.find((cell) => cell && /^\w[-\w]+$/.test(cell) && !/@/.test(cell)) || null;
      const email = cells.find((cell) => /@/.test(cell)) || null;
      const candidate = {
        key: name,
        display_name: name,
        first_name: name.split(/\s+/)[0] || '',
        last_name: name.split(/\s+/).slice(1).join(' '),
        external_student_id: externalId,
        email,
      };
      const normalized = normalizeImportedName(name);
      const duplicate = (externalId && byId.get(String(externalId))) || byName.get(normalized) ||
        Array.from(byName.values()).find((item) => importedNameScore(item.display_name, name) >= 0.95);
      if (duplicate) {
        if (!duplicate.external_student_id && externalId) duplicate.external_student_id = externalId;
        if (!duplicate.email && email) duplicate.email = email;
        continue;
      }
      byName.set(normalized, candidate);
      if (externalId) byId.set(String(externalId), candidate);
    }
  }
  return Array.from(byName.values());
}

function resolvePackageReferences(roster, assessments, historicalRecords) {
  const unresolved = [];
  const resolve = (reference) => {
    const match = findConfidentNameMatch(roster, reference.payload?.student_name || reference.display_name || reference.student_key || '', reference.external_student_id || '');
    if (match.item) return { ...reference, student_key: match.item.key };
    unresolved.push({ student_key: reference.student_key, mode: match.mode, score: match.score });
    return { ...reference, student_key: null };
  };
  return {
    assessments: assessments.map((assessment) => ({ ...assessment, marks: (assessment.marks || []).map(resolve) })),
    historicalRecords: historicalRecords.map(resolve),
    unresolved,
  };
}

export function canonicalAssessmentIdentity(assessment) {
  const title = normalizeImportedName(assessment.title)
    .replace(/\bquastion\b/g, 'question')
    .replace(/[^a-z0-9]+/g, '');
  const components = (assessment.components || [])
    .map((component) => `${normalizeImportedName(component.name).replace(/[^a-z0-9]+/g, '')}:${Number(component.maximum_score)}`)
    .join('|');
  return `${title}|${assessment.assessment_date || ''}|${assessment.source_year || ''}|${components}`;
}

export function deduplicateAssessments(assessments) {
  const byIdentity = new Map();
  for (const assessment of assessments || []) {
    const identity = canonicalAssessmentIdentity(assessment);
    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, { ...assessment, source_sheets: [...new Set(assessment.source_sheets || [assessment.source_sheet].filter(Boolean))] });
      continue;
    }
    const marks = new Map((existing.marks || []).map((mark) => [`${mark.student_key || ''}:${mark.component_index}`, mark]));
    for (const mark of assessment.marks || []) {
      const key = `${mark.student_key || ''}:${mark.component_index}`;
      if (!marks.has(key) || (marks.get(key).score == null && mark.score != null)) marks.set(key, mark);
    }
    existing.marks = [...marks.values()];
    existing.source_sheets = [...new Set([...(existing.source_sheets || []), ...(assessment.source_sheets || []), assessment.source_sheet].filter(Boolean))];
  }
  return [...byIdentity.values()];
}

export function classifyWorkbook(sheets, fileName = '') {
  const plans = sheets.map((sheet) => ({
    name: sheet.name,
    hidden: Boolean(sheet.hidden || sheet.state === 'hidden'),
    rows: sheet.rows || [],
    ...classifyWorksheet(sheet),
  }));
  const useful = plans.filter((plan) => !['reference', 'ignore', 'historical'].includes(plan.type));
  return {
    fileName,
    sheets: plans,
    workbookType: useful.length > 1 ? 'complete' : (useful[0]?.type || 'reference'),
  };
}

export function parseGradeThresholdSheet(sheet) {
  const rows = sheet?.rows || [];
  if (!rows.length) return null;
  let headerRow = -1;
  const gradeCols = {};
  let grades = [];
  const known = /^(A\*|A|B|C|D|E|F|G|U)$/i;

  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    const cols = {};
    (rows[r] || []).forEach((v, i) => {
      const t = cellText(v);
      if (known.test(t)) cols[t.toUpperCase()] = i;
    });
    if (Object.keys(cols).length >= 3) {
      headerRow = r;
      Object.assign(gradeCols, cols);
      grades = Object.keys(cols);
      break;
    }
  }
  if (headerRow < 0) return null;

  const order = ['A*', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'U'];
  grades.sort((a, b) => order.indexOf(a) - order.indexOf(b));

  const components = {};
  const componentOrder = [];

  for (let r = headerRow + 1; r < Math.min(rows.length, 40); r++) {
    const label = cellText(rows[r]?.[0]);
    if (!label) continue;
    const isComponent = /^component\s*\d+/i.test(label);
    const isAx = /^AX(?:\s*\(|\b)/i.test(label);
    const isOverall = /^overall$/i.test(label);
    if (isComponent || isAx || isOverall || /^(paper|exam|coursework|project)/i.test(label)) {
      const key = isAx ? 'AX' : isOverall ? 'Overall' : label.trim();
      const thresholds = {};
      grades.forEach((g) => {
        const v = parseImportedNumeric(rows[r]?.[gradeCols[g]]);
        if (v.type === 'number') thresholds[g] = v.value;
      });
      if (Object.keys(thresholds).length) {
        components[key] = { label, thresholds, maximum_score: null };
        componentOrder.push(key);
      }
    }
  }
  if (!componentOrder.length) return null;

  for (let r = headerRow + 1; r < Math.min(rows.length, 40); r++) {
    const row = rows[r] || [];
    const first = cellText(row[0]);
    if (!/^component\s*\d+|^AX(?:\s*\(|\b)|^overall$/i.test(first)) {
      const numericAfterLabel = row.slice(1).map(parseImportedNumeric).filter((x) => x.type === 'number').map((x) => x.value);
      if (numericAfterLabel.length >= componentOrder.length) {
        componentOrder.forEach((k, i) => {
          if (components[k]) components[k].maximum_score = numericAfterLabel[i];
        });
        break;
      }
    }
  }

  return {
    name: sheet.name || 'Grade Threshold Scheme',
    sourceSheet: sheet.name,
    grades,
    components,
    componentOrder,
  };
}

export function extractAssessmentBlocks(sheet, roster = [], unmatched = new Set(), year = '') {
  const rows = sheet?.rows || [];
  const blocks = findNameBlocks(rows);
  if (!blocks.length) return [];
  const results = [];

  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    const nextCol = blocks.filter((x) => x.nameCol > b.nameCol).map((x) => x.nameCol).sort((a, c) => a - c)[0];
    const info = inferRowsForBlock(rows, b, nextCol);
    const end = info.end;
    const title = blockTitle(rows, b, end, sheet.name, bi);
    const componentDefs = [];

    for (let c = b.nameCol + 1; c < end; c++) {
      let label = cellText(rows[info.questionRow]?.[c]);
      if (!label) {
        for (let r = info.questionRow; r >= b.headerRow && r >= 0; r--) {
          label = cellText(rows[r]?.[c]);
          if (label) break;
        }
      }
      const maxVal = info.markRow >= 0 ? parseImportedNumeric(rows[info.markRow]?.[c]).value : null;
      if (isAggregateLabel(label) || !label) continue;

      const hasMax = typeof maxVal === 'number' && maxVal > 0;
      let numericCount = 0;
      for (let r = info.dataStart; r < Math.min(rows.length, info.dataStart + 80); r++) {
        if (parseImportedNumeric(rows[r]?.[c]).type === 'number') numericCount += 1;
      }

      if (hasMax || numericCount >= 1) {
        componentDefs.push({
          col: c,
          name: label,
          maximum_score: hasMax ? maxVal : 100,
        });
      }
    }

    if (!componentDefs.length) continue;

    const topic = inferAssessmentTopic(sheet.name, title);
    const marks = [];

    for (let r = info.dataStart; r < rows.length; r++) {
      const rawName = cellText(rows[r]?.[b.nameCol]);
      if (!rawName) continue;
      if (!isStudentCell(rawName, rows[r] || [], b.nameCol)) continue;
      const externalId = b.idCol >= 0 ? cellText(rows[r]?.[b.idCol]) : '';

      componentDefs.forEach((def, compIndex) => {
        const parsed = parseImportedNumeric(rows[r]?.[def.col]);
        if (parsed.type === 'number' || parsed.type === 'status') {
          marks.push({
            student_key: rawName,
            external_student_id: externalId || null,
            display_name: rawName,
            component_index: compIndex,
            score: parsed.type === 'number' ? parsed.value : null,
            mark_status: parsed.type === 'status' ? parsed.value : null,
          });
        }
      });
    }

    results.push({
      title,
      source_sheet: sheet.name,
      strand: /social/i.test(sheet.name) ? 'Social' : (/team project|gp project/i.test(title) ? 'Team Project' : 'General'),
      topic,
      assessment_date: null,
      source_year: year || null,
      components: componentDefs.map((def) => ({ name: def.name, maximum_score: def.maximum_score })),
      marks,
    });
  }

  return results;
}

export function parseBehaviorRecords(sheet, roster = [], unmatched = new Set()) {
  const rows = sheet?.rows || [];
  const records = [];
  const name = sheet?.name || '';

  if (/^conduct$/i.test(name)) {
    const dateRow = rows[1] || [];
    for (let r = 3; r < rows.length; r++) {
      const studentName = cellText(rows[r]?.[0]);
      if (!studentName || !isPlausiblePersonName(studentName)) continue;
      for (let c = 1; c < (rows[r]?.length || 0); c++) {
        const raw = cellText(rows[r]?.[c]);
        if (!raw) continue;
        records.push({
          record_type: 'behavior',
          source_year: '2025-2026',
          student_key: studentName,
          payload: {
            student_name: studentName,
            category: c >= 12 ? 'Global Perspectives Conduct' : 'Social Conduct',
            date: importedDate(dateRow[c]),
            note: raw,
            source_sheet: name,
          },
        });
      }
    }
  } else if (/^social$/i.test(name)) {
    const dateRow = rows[1] || [];
    for (let r = 4; r < rows.length; r++) {
      const studentName = cellText(rows[r]?.[0]);
      if (!studentName || !isPlausiblePersonName(studentName)) continue;
      for (let c = 5; c < (rows[r]?.length || 0); c++) {
        const raw = cellText(rows[r]?.[c]);
        if (!raw || parseImportedNumeric(raw).type === 'number') continue;
        if (/misbehaviour|refused|talk|respond|distract|moving|plays|giggles|disrespect|answer/i.test(raw) || /^(AB|NS|P)$/i.test(raw)) {
          records.push({
            record_type: 'behavior',
            source_year: '2025-2026',
            student_key: studentName,
            payload: {
              student_name: studentName,
              category: 'Social Conduct',
              date: importedDate(dateRow[c]),
              note: raw,
              source_sheet: name,
            },
          });
        }
      }
    }
  }

  return records;
}

export function parseSubmissionTracker(sheet) {
  const rows = sheet?.rows || [];
  if (!rows[0] || !rows[0].length) return [];
  const headers = rows[0];
  const nameCols = [];
  for (let c = 2; c < headers.length; c++) {
    const n = cellText(headers[c]);
    if (n && isPlausiblePersonName(n)) nameCols.push({ col: c, name: n });
  }

  const tasks = [];
  for (let r = 2; r < rows.length; r++) {
    const title = cellText(rows[r]?.[0]);
    if (!title || /^task$/i.test(title)) continue;
    const dueDate = importedDate(rows[r]?.[1]);
    nameCols.forEach((col) => {
      const status = cellText(rows[r]?.[col.col]);
      if (status) {
        tasks.push({
          record_type: 'assignment',
          source_year: '2025-2026',
          student_key: col.name,
          payload: {
            student_name: col.name,
            title,
            due_date: dueDate,
            status,
            source_sheet: sheet.name,
          },
        });
      }
    });
  }
  return tasks;
}

export function parseTeamProjectsSheet(sheet) {
  const rows = sheet?.rows || [];
  if (!rows.length) return [];
  const name = sheet.name;
  const projects = [];

  if (/^list of teams$/i.test(name)) {
    let cur = null;
    for (let r = 1; r < rows.length; r++) {
      const team = cellText(rows[r]?.[0]);
      if (team && /^\d+$/.test(team)) {
        if (cur) projects.push(cur);
        cur = {
          team_number: team,
          topic: cellText(rows[r]?.[1]),
          leader: '',
          members: [],
          action_plan: cellText(rows[r]?.[4]),
          progress: cellText(rows[r]?.[5]),
          source_sheet: name,
        };
      }
      if (cur) {
        const member = cellText(rows[r]?.[2]);
        if (member && !/^members?$/i.test(member) && !/^team$/i.test(member) && isPlausiblePersonName(member)) {
          cur.members.push(member);
        }
      }
    }
    if (cur) projects.push(cur);
  } else if (/^gp projects 2026$/i.test(name)) {
    let cur = null;
    for (let r = 1; r < rows.length; r++) {
      const first = cellText(rows[r]?.[0]);
      if (/^team$/i.test(first) && cur) break;
      if (first && /^\d+$/.test(first)) {
        if (cur) projects.push(cur);
        cur = {
          team_number: first,
          topic: cellText(rows[r]?.[3]),
          issue: cellText(rows[r]?.[4]),
          aim: cellText(rows[r]?.[5]),
          action_plan: cellText(rows[r]?.[6]),
          leader: cellText(rows[r]?.[2]),
          members: [],
          timeline: cellText(rows[r]?.[9]),
          date_submitted: importedDate(rows[r]?.[10]),
          source_sheet: name,
        };
      }
      if (cur) {
        const member = cellText(rows[r]?.[1]);
        if (member && !/^group members$/i.test(member) && !/^team$/i.test(member) && isPlausiblePersonName(member)) {
          cur.members.push(member);
        }
      }
    }
    if (cur) projects.push(cur);
  }

  return projects.flatMap((p) => {
    const list = p.members.length ? p.members : [p.leader].filter(Boolean);
    return list.map((m) => ({
      record_type: 'team_project',
      source_year: '2025-2026',
      student_key: m,
      payload: {
        ...p,
        student_name: m,
      },
    }));
  });
}

export function buildWorkbookImportPackage(sheets, fileName = '', options = {}) {
  const existingStudents = options.existingStudents || [];
  const academicYear = options.academicYear || '2025-2026';
  const plans = sheets.map((sheet) => ({
    name: sheet.name,
    hidden: Boolean(sheet.hidden || sheet.state === 'hidden'),
    rows: sheet.rows || [],
    ...classifyWorksheet(sheet),
    ...(sheet.selected !== undefined ? { selected: sheet.selected } : {}),
  }));

  const selectedPlans = plans.filter((p) => p.selected);

  // Build the roster before parsing any assessment or history sheet. Those
  // sheets may reference students, but never have authority to create them.
  const extractedStudents = canonicalRosterFromPlans(plans);
  const matchedStudents = matchImportedRoster(existingStudents, extractedStudents);

  // Detect grade threshold schemes
  const schemes = [];
  const thresholdPlan = selectedPlans.find((p) => p.type === 'threshold');
  if (thresholdPlan) {
    const scheme = parseGradeThresholdSheet(thresholdPlan);
    if (scheme) schemes.push(scheme);
  }

  // Extract assessments & marks
  const assessments = [];
  selectedPlans.filter((p) => p.type === 'grades' || p.type === 'mixed').forEach((plan) => {
    const blocks = extractAssessmentBlocks(plan, extractedStudents, new Set(), academicYear);
    assessments.push(...blocks);
  });

  // Extract historical records (behavior, assignments, teams, historical sheets)
  const historicalRecords = [];
  selectedPlans.forEach((plan) => {
    if (plan.type === 'behavior' || plan.type === 'mixed') {
      historicalRecords.push(...parseBehaviorRecords(plan, extractedStudents));
    }
    if (plan.type === 'assignments') {
      historicalRecords.push(...parseSubmissionTracker(plan));
    }
    if (plan.type === 'team-projects') {
      historicalRecords.push(...parseTeamProjectsSheet(plan));
    }
    if (plan.type === 'historical') {
      historicalRecords.push({
        record_type: 'historical',
        source_year: '2024-2025',
        payload: {
          sheet_name: plan.name,
          row_count: plan.rows.length,
          preview: plan.rows.slice(0, 5),
        },
      });
    }
  });

  const resolved = resolvePackageReferences(extractedStudents, deduplicateAssessments(assessments), historicalRecords);

  return {
    original_filename: fileName || 'workbook.xlsx',
    academic_year: academicYear,
    detected_class: fileName ? fileName.replace(/\.[^.]+$/, '') : '',
    detected_subject: '',
    workbook_type: plans.filter((p) => p.selected).length > 1 ? 'complete' : (plans.find((p) => p.selected)?.type || 'grades'),
    sheets: plans,
    students: extractedStudents,
    matched_students: matchedStudents,
    schemes,
    assessments: resolved.assessments,
    historical_records: resolved.historicalRecords,
    diagnostics: { unresolved_references: resolved.unresolved },
    summary: {
      totalSheets: plans.length,
      selectedSheets: selectedPlans.length,
      studentsCount: extractedStudents.length,
      assessmentsCount: assessments.length,
      schemesCount: schemes.length,
      historicalCount: historicalRecords.length,
    },
  };
}

// ==========================================
// XML Export & Restore
// ==========================================
export function exportGradebookToXml(gradebookData) {
  const json = JSON.stringify(gradebookData, null, 2);
  const safeJson = json.replace(/]]>/g, ']]]]><![CDATA[>');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<threealamatak version="1.0" exportedAt="${new Date().toISOString()}">\n  <json><![CDATA[${safeJson}]]></json>\n</threealamatak>\n`;
}

export function parseGradebookXml(xmlString) {
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(xmlString, 'application/xml');
    const node = doc.querySelector('json');
    if (node && node.textContent) {
      return JSON.parse(node.textContent);
    }
  }
  const match = xmlString.match(/<json>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/json>/i);
  if (!match) throw new Error('No 3alamatak JSON payload found in XML.');
  const jsonText = match[1] !== undefined ? match[1] : match[2];
  return JSON.parse(jsonText);
}

// ==========================================
// Self-Contained HTML Export & Restore
// ==========================================
export function exportGradebookToHtml(gradebookData) {
  const json = JSON.stringify(gradebookData);
  const title = gradebookData?.gradebook?.title || '3alamatak Gradebook';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - 3alamatak Report</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 30px; color: #0f172a; background: #f8fafc; }
    .card { background: white; border-radius: 12px; border: 1px solid #e2e8f0; padding: 24px; max-width: 900px; margin: 0 auto; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05); }
    h1 { margin-top: 0; color: #0f766e; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: left; }
    th { background: #f1f5f9; font-weight: 700; color: #475569; }
    .footer { margin-top: 30px; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 16px; }
    @media print {
      body { background: white; margin: 0; }
      .card { border: none; box-shadow: none; padding: 0; max-width: 100%; }
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>Academic Year: <strong>${gradebookData?.gradebook?.academic_year || 'N/A'}</strong> · Subject: <strong>${gradebookData?.gradebook?.subject || 'General'}</strong></p>
    <p>Exported: ${new Date().toLocaleString()}</p>
    <h2>Students (${gradebookData?.students?.length || 0})</h2>
    <table>
      <thead>
        <tr><th>ID</th><th>Student Name</th><th>Email</th><th>Status</th></tr>
      </thead>
      <tbody>
        ${(gradebookData?.students || []).map((s) => `<tr><td>${s.external_student_id || s.id}</td><td><strong>${s.display_name}</strong></td><td>${s.email || '—'}</td><td>${s.status}</td></tr>`).join('\n        ')}
      </tbody>
    </table>
    <h2>Assessments (${gradebookData?.assessments?.length || 0})</h2>
    <table>
      <thead>
        <tr><th>Title</th><th>Strand</th><th>Date</th></tr>
      </thead>
      <tbody>
        ${(gradebookData?.assessments || []).map((a) => `<tr><td><strong>${a.title}</strong></td><td>${a.strand || '—'}</td><td>${a.assessment_date || '—'}</td></tr>`).join('\n        ')}
      </tbody>
    </table>
    <div class="footer">
      Generated by 3alamatak for Madrastak. This self-contained HTML file can be restored into 3alamatak at any time.
    </div>
  </div>
  <script>window.__EMBEDDED_MARKBOOK__ = ${json};</script>
</body>
</html>`;
}

export function parseGradebookHtml(htmlString) {
  const match = htmlString.match(/window\.__EMBEDDED_MARKBOOK__\s*=\s*([\s\S]*?);<\/script>/);
  if (!match) throw new Error('No embedded 3alamatak markbook found in HTML file.');
  return JSON.parse(match[1]);
}

function normalizeZipPath(path) {
  const parts = String(path || '').split('/');
  const result = [];
  parts.forEach((part) => {
    if (!part || part === '.') return;
    if (part === '..') result.pop();
    else result.push(part);
  });
  return result.join('/');
}

function parseSharedStringsFast(xml) {
  const strings = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let siMatch;
  while ((siMatch = siRegex.exec(xml)) !== null) {
    const siContent = siMatch[1];
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
    let tMatch;
    let str = '';
    while ((tMatch = tRegex.exec(siContent)) !== null) {
      str += tMatch[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
    }
    strings.push(str);
  }
  return strings;
}

function colRefToIdx(ref) {
  let col = 0;
  for (let i = 0; i < ref.length; i++) {
    col = col * 26 + ref.charCodeAt(i) - 64;
  }
  return col - 1;
}

function worksheetToRowsFast(xml, sharedStrings) {
  const rows = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const rowContent = rowMatch[1];
    const cells = [];
    let maxCol = 0;
    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
    let cMatch;
    while ((cMatch = cellRegex.exec(rowContent)) !== null) {
      const attrs = cMatch[1];
      const body = cMatch[2];
      const rMatch = attrs.match(/\br="([A-Z]+)\d+"/i);
      const col = rMatch ? colRefToIdx(rMatch[1].toUpperCase()) : cells.length;
      maxCol = Math.max(maxCol, col);

      const tMatch = attrs.match(/\bt="([^"]+)"/i);
      const type = tMatch ? tMatch[1] : '';

      let val = '';
      if (type === 'inlineStr') {
        const isMatch = body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/i);
        val = isMatch ? isMatch[1] : '';
      } else {
        const vMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
        val = vMatch ? vMatch[1] : '';
        if (type === 's') {
          val = sharedStrings[Number(val)] ?? '';
        } else if (type === 'b') {
          val = val === '1' ? 'TRUE' : 'FALSE';
        }
      }
      val = val
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      cells[col] = val;
    }
    while (cells.length <= maxCol) cells.push('');
    rows.push(cells.map((c) => c ?? ''));
  }
  return rows;
}

export async function readXlsxWorkbook(input) {
  let bytes;
  if (input instanceof Uint8Array) {
    bytes = input;
  } else if (input && typeof input.arrayBuffer === 'function') {
    bytes = new Uint8Array(await input.arrayBuffer());
  } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(input)) {
    bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  } else {
    throw new Error('Unsupported workbook input format.');
  }

  const entries = await unzipEntries(bytes);
  const sharedBytes = entries.get('xl/sharedStrings.xml');
  const sharedStrings = sharedBytes ? parseSharedStringsFast(new TextDecoder().decode(sharedBytes)) : [];

  const relsXml = new TextDecoder().decode(entries.get('xl/_rels/workbook.xml.rels') || new Uint8Array());
  const relationMap = {};
  const relRegex = /<Relationship\b([^>]*)\/?>/gi;
  let relMatch;
  while ((relMatch = relRegex.exec(relsXml)) !== null) {
    const idMatch = relMatch[1].match(/\bId="([^"]+)"/i);
    const targetMatch = relMatch[1].match(/\bTarget="([^"]+)"/i);
    if (idMatch && targetMatch) {
      relationMap[idMatch[1]] = targetMatch[1];
    }
  }

  const wbXml = new TextDecoder().decode(entries.get('xl/workbook.xml') || new Uint8Array());
  const sheetRegex = /<sheet\b([^>]*)\/?>/gi;
  let sMatch;
  const sheets = [];
  while ((sMatch = sheetRegex.exec(wbXml)) !== null) {
    const attrs = sMatch[1];
    const nameMatch = attrs.match(/\bname="([^"]+)"/i);
    const rIdMatch = attrs.match(/\b(?:r:id|id)="([^"]+)"/i);
    const stateMatch = attrs.match(/\bstate="([^"]+)"/i);
    const name = nameMatch ? nameMatch[1] : 'Sheet';
    const rId = rIdMatch ? rIdMatch[1] : '';
    const state = stateMatch ? stateMatch[1] : 'visible';
    const target = relationMap[rId];
    if (target) {
      const cleanTarget = target.replace(/^\/+/, '').replace(/^xl\//, '');
      const path = `xl/${cleanTarget}`;
      const sheetBytes = entries.get(path);
      if (sheetBytes) {
        const rows = worksheetToRowsFast(new TextDecoder().decode(sheetBytes), sharedStrings);
        sheets.push({ name, state, hidden: state !== 'visible', rows });
      }
    }
  }

  return sheets;
}

async function unzipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOfCentralDirectory = -1;
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) { endOfCentralDirectory = index; break; }
  }
  if (endOfCentralDirectory < 0) throw new Error('Invalid ZIP/XLSX file.');
  const directorySize = view.getUint32(endOfCentralDirectory + 12, true);
  const directoryOffset = view.getUint32(endOfCentralDirectory + 16, true);
  const result = new Map();
  let position = directoryOffset;

  while (position < directoryOffset + directorySize) {
    if (view.getUint32(position, true) !== 0x02014b50) break;
    const method = view.getUint16(position + 10, true);
    const compressedSize = view.getUint32(position + 20, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const localOffset = view.getUint32(position + 42, true);
    const name = new TextDecoder().decode(bytes.slice(position + 46, position + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(start, start + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) {
      if (!('DecompressionStream' in globalThis)) throw new Error('This runtime cannot decompress XLSX files.');
      const stream = new DecompressionStream('deflate-raw');
      data = new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(stream)).arrayBuffer());
    } else throw new Error('Unsupported XLSX compression method.');
    result.set(name, data);
    position += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

export { normalizeImportedName };
