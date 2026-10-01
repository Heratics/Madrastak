import { normalizeImportedName } from './rosterMatching.js';

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

function cellText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function isNameHeader(value) {
  return /^(student\s*(name|names)?|name|learner|pupil|full\s*name|اسم الطالب|الاسم)$/i.test(cellText(value));
}

function hasNameBlock(rows) {
  return rows.slice(0, 10).some((row) => row.some((value) => isNameHeader(value)));
}

function nonEmptyCount(rows) {
  return rows.flat().filter((value) => cellText(value) !== '').length;
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
      if (!('DecompressionStream' in window)) throw new Error('This browser cannot decompress XLSX files.');
      const stream = new DecompressionStream('deflate-raw');
      data = new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(stream)).arrayBuffer());
    } else throw new Error('Unsupported XLSX compression method.');
    result.set(name, data);
    position += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

export { normalizeImportedName };
