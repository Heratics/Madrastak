import { normalizeImportedName, matchImportedRoster, findConfidentNameMatch } from './rosterMatching.js';

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
  return /^(student\s*(name|names)?|name|learner|pupil|full\s*name|اسم الطالب|الاسم)$/i.test(cellText(value));
}

export function isIdHeader(value) {
  return /^(student\s*(number|no\.?|id)|candidate\s*(number|no\.?|id)|admission\s*(number|no\.?|id)|number|num|id|الرقم التسلسلي|الرقم)$/i.test(cellText(value));
}

export function isMetricLabel(value) {
  return /^(average|mean|median|min|max|minimum|maximum|questions?|mark|marks|total|score|grade|grid level|date|due date|student name|student|class|subject|topic|team|leader|member|members|action plan|progress|issue|aim|assessment|assignment|project|semester|paper|candidate|centre|session|explanation|criteria|criterion|level|component|description|status)$/i.test(cellText(value));
}

export function isAggregateLabel(value) {
  return /^(total|total marks?|out of|score|grade|grid level|average|mean|min|max)$/i.test(cellText(value));
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

export function findNameBlocks(rows) {
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
  if (/^ir submission$/i.test(name)) return { type: 'assignments', label: 'Assignments / Submission Tracker', selected: true };
  if (/grade.?threshold/i.test(lowerName)) return { type: 'threshold', label: 'Grade Threshold Scheme', selected: true };
  if (/criteria|email list/i.test(lowerName)) return { type: 'reference', label: 'Reference / Criteria', selected: false };
  if (/^sheet1$/i.test(name) || /^sheet3$/i.test(name)) return { type: 'students', label: 'Students / Roster', selected: !sheet.hidden };
  if (hasNameBlock(rows) && (numericCount >= 3 || /assessment|exam|marks?|grade|score|question|semester|paper/i.test(`${name} ${preview}`))) {
    return { type: 'grades', label: 'Grades / Assessments', selected: !sheet.hidden };
  }
  return { type: 'reference', label: 'Reference / view only', selected: false };
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
      if (!isPlausiblePersonName(rawName)) continue;
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

  // Extract raw student names across selected sheets
  const rawStudentMap = new Map();
  selectedPlans.forEach((plan) => {
    const rows = plan.rows || [];
    const blocks = findNameBlocks(rows);
    if (blocks.length) {
      blocks.forEach((b) => {
        const info = inferRowsForBlock(rows, b);
        for (let r = info.dataStart; r < rows.length; r++) {
          const rawName = cellText(rows[r]?.[b.nameCol]);
          if (!rawName || !isPlausiblePersonName(rawName)) continue;
          const extId = b.idCol >= 0 ? cellText(rows[r]?.[b.idCol]) : null;
          const norm = normalizeImportedName(rawName);
          if (!rawStudentMap.has(norm)) {
            const parts = rawName.split(/\s+/);
            rawStudentMap.set(norm, {
              key: rawName,
              display_name: rawName,
              first_name: parts[0] || '',
              last_name: parts.slice(1).join(' ') || '',
              external_student_id: extId || null,
              email: null,
            });
          }
        }
      });
    } else if (plan.type === 'students') {
      rows.slice(1).forEach((row) => {
        const name = cellText(row[0]) || cellText(row.slice(0, 2).filter(Boolean).join(' '));
        if (name && isPlausiblePersonName(name)) {
          const norm = normalizeImportedName(name);
          if (!rawStudentMap.has(norm)) {
            const parts = name.split(/\s+/);
            rawStudentMap.set(norm, {
              key: name,
              display_name: name,
              first_name: parts[0] || '',
              last_name: parts.slice(1).join(' ') || '',
              external_student_id: row[1] && /^\w[-\w]+$/.test(cellText(row[1])) ? cellText(row[1]) : null,
              email: row.find((c) => /@/.test(cellText(c))) || null,
            });
          }
        }
      });
    }
  });

  const extractedStudents = Array.from(rawStudentMap.values());
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
    assessments,
    historical_records: historicalRecords,
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

function parseSharedStrings(xml) {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  return [...document.querySelectorAll('si')]
    .map((item) => [...item.querySelectorAll('t')].map((text) => text.textContent || '').join(''));
}

function worksheetToRows(xml, sharedStrings) {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const rows = [];
  document.querySelectorAll('sheetData > row').forEach((row) => {
    const cells = [];
    let maximumColumn = 0;
    row.querySelectorAll(':scope > c').forEach((cell) => {
      const reference = cell.getAttribute('r') || '';
      const match = reference.match(/([A-Z]+)\d+/i);
      let column = 0;
      if (match) [...match[1].toUpperCase()].forEach((character) => { column = column * 26 + character.charCodeAt(0) - 64; });
      column -= 1;
      maximumColumn = Math.max(maximumColumn, column);
      const type = cell.getAttribute('t');
      const raw = cell.querySelector('v')?.textContent ?? '';
      let value = raw;
      if (type === 's') value = sharedStrings[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = [...cell.querySelectorAll('t')].map((text) => text.textContent || '').join('');
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      cells[column] = value;
    });
    while (cells.length <= maximumColumn) cells.push('');
    rows.push(cells.map((value) => value ?? ''));
  });
  return rows;
}

export async function readXlsxWorkbook(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = await unzipEntries(bytes);
  const workbookXml = entries.get('xl/workbook.xml');
  const relationshipsXml = entries.get('xl/_rels/workbook.xml.rels');
  if (!workbookXml || !relationshipsXml) throw new Error('This XLSX file is missing workbook metadata.');

  const workbook = new DOMParser().parseFromString(new TextDecoder().decode(workbookXml), 'application/xml');
  const relationships = new DOMParser().parseFromString(new TextDecoder().decode(relationshipsXml), 'application/xml');
  const relationMap = {};
  relationships.querySelectorAll('Relationship').forEach((relationship) => {
    relationMap[relationship.getAttribute('Id')] = relationship.getAttribute('Target');
  });
  const sharedBytes = entries.get('xl/sharedStrings.xml');
  const sharedStrings = sharedBytes ? parseSharedStrings(new TextDecoder().decode(sharedBytes)) : [];
  return [...workbook.querySelectorAll('sheet')].map((sheet) => {
    const target = relationMap[sheet.getAttribute('r:id') || sheet.getAttribute('id')];
    const path = normalizeZipPath(`xl/${String(target || '').replace(/^\/+|^xl\//, '')}`);
    const worksheet = entries.get(path);
    if (!worksheet) return null;
    const state = sheet.getAttribute('state') || 'visible';
    return { name: sheet.getAttribute('name') || 'Sheet', state, hidden: state !== 'visible', rows: worksheetToRows(new TextDecoder().decode(worksheet), sharedStrings) };
  }).filter(Boolean);
}

async function unzipEntries(bytes) {
  const view = new DataView(bytes.buffer);
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
