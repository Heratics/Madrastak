const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkbookImportPackage } = require('./workbookParser');
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
