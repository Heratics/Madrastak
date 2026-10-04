const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { buildWorkbookImportPackage, readXlsxWorkbook, matchImportedRoster } = require('./workbookParser');
const { buildUniqueStudents, persistImportPackage, persistImportTransaction } = require('./importPersistence');
const { filterGradebooksForList } = require('./gradebookAccess');

test('archive list filter hides archived gradebooks while preserving admin all view', () => {
  const gradebooks = [{ id: 1, status: 'active' }, { id: 2, status: 'archived' }];
  assert.deepEqual(filterGradebooksForList(gradebooks), [{ id: 1, status: 'active' }]);
  assert.deepEqual(filterGradebooksForList(gradebooks, { includeArchived: true }), gradebooks);
});

test('canonical roster and duplicate prevention are deterministic', () => {
  const pkg = buildWorkbookImportPackage([
    { name: 'Sheet3', rows: [['Aisha Noor'], ['Omar Saleh']] },
    { name: 'Grades', rows: [['Student Name', 'Quiz'], ['Aisha Noor', '9'], ['History-only', '8']] },
  ]);
  assert.equal(pkg.students.length, 2);
  assert.equal(buildUniqueStudents([...pkg.students, pkg.students[0]]).length, 2);
});

test('teacher-defined aliases resolve exactly without fuzzy alias creation', () => {
  const matched = matchImportedRoster([{ id: 7, display_name: 'Oweis Alzayed', aliases: [{ alias_name: 'Oweis Omar Alzayed' }] }], [{ key: 'Oweis Omar Alzayed', display_name: 'Oweis Omar Alzayed' }]);
  assert.equal(matched[0].mode, 'alias');
  assert.equal(matched[0].matchedStudent.id, 7);
  assert.equal(matchImportedRoster([{ id: 7, display_name: 'Oweis Alzayed' }], [{ key: 'Oweis Omar Alzayed', display_name: 'Oweis Omar Alzayed' }])[0].mode, 'fuzzy');
});

test('worksheet diagnostics retain source-year warnings and review counts', () => {
  const pkg = buildWorkbookImportPackage([
    { name: '2026-2027 Grades', rows: [['Student Name', 'Quiz'], ['Aisha Noor', '9']] },
    { name: 'Sheet3', rows: [['Aisha Noor']] },
  ], 'workbook.xlsx', { academicYear: '2025-2026' });
  const sheet = pkg.sheets.find((item) => item.name === '2026-2027 Grades');
  assert.ok(sheet.diagnostics);
  assert.equal(sheet.diagnostics.warning, 'Source year 2026-2027 differs from selected gradebook year 2025-2026.');
  assert.ok(Array.isArray(pkg.warnings));
});

test('persistImportPackage batches writes and persistImportTransaction rolls back on failure', async () => {
  const calls = [];
  let nextId = 10;
  const connection = {
    async query(sql, params) {
      calls.push(sql);
      if (/INSERT INTO alamatak_imports/.test(sql)) return [{ insertId: nextId++ }];
      if (/SELECT id, external_student_id, display_name FROM alamatak_students/.test(sql)) return [[], []];
      if (/INSERT INTO/.test(sql)) return [{ insertId: nextId++ }];
      return [[], []];
    },
  };
  const payload = {
    original_filename: 'test.xlsx', academic_year: '2026-2027', sheets: [],
    students: [{ key: 'A', display_name: 'Aisha Noor' }, { key: 'A-duplicate', display_name: 'Aisha Noor' }],
    assessments: [], schemes: [], historical_records: [],
  };
  const result = await persistImportPackage(connection, { gradebookId: 1, uploadedBy: 2, payload });
  assert.equal(result.students, 1);
  assert.ok(calls.length < 10);
  assert.equal(calls.filter((sql) => /INSERT INTO alamatak_students/.test(sql)).length, 1);
  let rolledBack = false;
  const transactional = {
    beginTransaction: async () => {},
    rollback: async () => { rolledBack = true; },
    commit: async () => {},
    release: () => {},
    query: async () => { throw new Error('forced import failure'); },
  };
  await assert.rejects(() => persistImportTransaction(transactional, { gradebookId: 1, uploadedBy: 2, payload }), /forced import failure/);
  assert.equal(rolledBack, true);
});

test('repeating the same source workbook is idempotent', async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push(sql);
      if (/SELECT id, metadata FROM alamatak_imports/.test(sql)) {
        return [[{ id: 44, metadata: JSON.stringify({ source_hash: 'same-workbook' }) }]];
      }
      throw new Error('A repeated import must return before writing new rows.');
    },
  };
  const result = await persistImportPackage(connection, {
    gradebookId: 1,
    uploadedBy: 2,
    payload: { original_filename: 'GP 0457 Grade 9 2026-2027.xlsx', metadata: { source_hash: 'same-workbook' } },
  });
  assert.equal(result.idempotent, true);
  assert.equal(result.importId, 44);
  assert.equal(calls.length, 1);
});

test('real V3 workbook preserves class sections, raw components, statuses, projects, and aliases', async (t) => {
  const file = 'E:/Documents/DAD WORK/Manastak/GP 0457 Grade 9 2026-2027 V3.xlsx';
  if (!fs.existsSync(file)) {
    t.skip('Real V3 workbook is not available in this environment.');
    return;
  }
  const sheets = await readXlsxWorkbook(fs.readFileSync(file));
  const pkg = buildWorkbookImportPackage(sheets, 'GP 0457 Grade 9 2026-2027 V3.xlsx', { academicYear: '2026-2027' });
  assert.deepEqual(sheets.map((sheet) => sheet.name), ['TP Groups', 'Sheet2', '9 A', '9 B', 'RP', 'TP', 'IR']);
  assert.equal(pkg.students.length, 38);
  assert.equal(pkg.assessments.length, 1);
  assert.deepEqual(pkg.assessments[0].components.map((component) => component.maximum_score), [1, 1, 2, 6, 8]);
  assert.equal(pkg.assessments[0].marks.length, 170);
  assert.equal(pkg.assessments[0].marks.filter((mark) => mark.mark_status === 'NA').length, 8);
  assert.equal(pkg.diagnostics.orphan_marks.filter((mark) => mark.mark_status === 'ABSENT').length, 1);
  assert.equal(pkg.historical_records.length, 7);
  assert.equal(pkg.diagnostics.unresolved_references.length, 0);
  assert.ok(pkg.diagnostics.matches.some((match) => match.original_name === 'Oweis Omar Alzayed' && match.canonical_name === 'Oweis Alzayed'));
});
