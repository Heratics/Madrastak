const { normalizeImportedName } = require('./workbookParser');

function chunked(values, size = 500) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

async function insertRows(connection, sqlPrefix, columns, rows, sqlSuffix = '') {
  if (!rows.length) return null;
  const placeholders = `(${columns.map(() => '?').join(', ')})`;
  let firstResult = null;
  for (const chunk of chunked(rows)) {
    const [result] = await connection.query(
      `${sqlPrefix} (${columns.join(', ')}) VALUES ${chunk.map(() => placeholders).join(', ')} ${sqlSuffix}`,
      chunk.flat()
    );
    if (!firstResult) firstResult = result;
  }
  return firstResult;
}

function packageStudentKey(student) {
  return String(student.key || student.external_student_id || student.display_name || '').trim();
}

function buildUniqueStudents(students) {
  const result = [];
  const byExternalId = new Map();
  const byName = new Map();
  for (const student of students || []) {
    const displayName = String(student.display_name || student.name || '').trim();
    if (!displayName) continue;
    const externalId = student.external_student_id ? String(student.external_student_id).trim() : null;
    const nameKey = normalizeImportedName(displayName);
    const duplicate = (externalId && byExternalId.get(externalId)) || byName.get(nameKey);
    if (duplicate) {
      if (!duplicate.external_student_id && externalId) duplicate.external_student_id = externalId;
      continue;
    }
    const normalized = {
      ...student,
      key: packageStudentKey(student),
      display_name: displayName,
      first_name: student.first_name || displayName.split(/\s+/)[0] || '',
      last_name: student.last_name || displayName.split(/\s+/).slice(1).join(' '),
      external_student_id: externalId,
    };
    result.push(normalized);
    byName.set(nameKey, normalized);
    if (externalId) byExternalId.set(externalId, normalized);
  }
  return result;
}

async function persistImportPackage(connection, { gradebookId, uploadedBy, payload }) {
  const sourceHash = payload.metadata?.source_hash;
  if (sourceHash) {
    const [priorImports] = await connection.query(
      'SELECT id, metadata FROM alamatak_imports WHERE gradebook_id = ? ORDER BY id DESC',
      [gradebookId]
    );
    const prior = priorImports.find((item) => {
      try {
        const metadata = typeof item.metadata === 'string' ? JSON.parse(item.metadata || '{}') : (item.metadata || {});
        return metadata.source_hash === sourceHash;
      } catch (_) { return false; }
    });
    if (prior) return { importId: prior.id, idempotent: true, students: 0, assessments: 0, marks: 0, history: 0 };
  }
  const students = buildUniqueStudents(payload.students);
  const [importResult] = await connection.query(
    `INSERT INTO alamatak_imports
     (gradebook_id, uploaded_by, original_filename, academic_year, detected_class, detected_subject, workbook_type, metadata, source_fingerprint, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [gradebookId, uploadedBy, String(payload.original_filename).slice(0, 512), payload.academic_year || null,
      payload.detected_class || null, payload.detected_subject || null, payload.workbook_type || null,
      JSON.stringify({ ...(payload.metadata || {}), diagnostics: payload.diagnostics || {} }), sourceHash || null]
  );
  const importId = importResult.insertId;

  const sheetRows = (payload.sheets || []).map((sheet) => {
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    return [importId, String(sheet.name || 'Sheet').slice(0, 255), sheet.hidden ? 'hidden' : 'visible',
      sheet.type || 'reference', sheet.source_year || null, Boolean(sheet.selected), rows.length,
      Math.max(0, ...rows.map((row) => row.length)), JSON.stringify(rows), JSON.stringify(sheet.diagnostics || [])];
  });
  await insertRows(connection, 'INSERT INTO alamatak_import_sheets',
    ['import_id', 'sheet_name', 'visibility', 'classification', 'source_year', 'selected', 'row_count', 'column_count', 'raw_rows', 'diagnostics'], sheetRows);

  const [existingRows] = await connection.query(
    'SELECT id, external_student_id, display_name FROM alamatak_students WHERE gradebook_id = ?', [gradebookId]
  );
  const existingByExternalId = new Map(existingRows.filter((row) => row.external_student_id).map((row) => [String(row.external_student_id), row]));
  const existingByName = new Map(existingRows.map((row) => [normalizeImportedName(row.display_name), row]));
  const newStudents = students.filter((student) => !((student.external_student_id && existingByExternalId.get(student.external_student_id)) || existingByName.get(normalizeImportedName(student.display_name))));
  await insertRows(connection, 'INSERT INTO alamatak_students',
    ['gradebook_id', 'linked_user_id', 'external_student_id', 'first_name', 'last_name', 'display_name', 'email', 'notes', 'source_import_id'],
    newStudents.map((student) => [gradebookId, null, student.external_student_id, student.first_name, student.last_name, student.display_name, student.email || null, student.notes || null, importId]));
  const [allStudents] = await connection.query('SELECT id, external_student_id, display_name FROM alamatak_students WHERE gradebook_id = ?', [gradebookId]);
  const studentMap = new Map();
  for (const student of students) {
    const row = (student.external_student_id && allStudents.find((candidate) => String(candidate.external_student_id) === student.external_student_id)) ||
      allStudents.find((candidate) => normalizeImportedName(candidate.display_name) === normalizeImportedName(student.display_name));
    if (row) studentMap.set(student.key, row.id);
  }

  const validAssessments = (payload.assessments || []).map((assessment) => ({
    ...assessment,
    components: Array.isArray(assessment.components) ? assessment.components.filter((component) => component.name && Number.isFinite(Number(component.maximum_score))) : [],
  })).filter((assessment) => assessment.title && assessment.components.length);
  const assessmentRows = validAssessments.map((assessment) => [gradebookId, assessment.title, assessment.strand || null, assessment.topic || null, assessment.assessment_date || null, importId, Boolean(assessment.is_historical), assessment.source_year || null]);
  const assessmentInsert = await insertRows(connection, 'INSERT INTO alamatak_assessments',
    ['gradebook_id', 'title', 'strand', 'topic', 'assessment_date', 'source_import_id', 'is_historical', 'source_year'], assessmentRows);
  const assessmentIds = validAssessments.map((_, index) => Number(assessmentInsert.insertId) + index);

  const componentRows = [];
  validAssessments.forEach((assessment, assessmentIndex) => assessment.components.forEach((component, componentIndex) => {
    componentRows.push([assessmentIds[assessmentIndex], component.name, Number(component.maximum_score), component.sort_order ?? componentIndex]);
  }));
  const componentInsert = await insertRows(connection, 'INSERT INTO alamatak_assessment_components', ['assessment_id', 'name', 'maximum_score', 'sort_order'], componentRows);
  const componentIds = componentRows.map((_, index) => Number(componentInsert.insertId) + index);
  const marks = [];
  let componentOffset = 0;
  validAssessments.forEach((assessment) => {
    (assessment.marks || []).forEach((mark) => {
      const studentId = studentMap.get(mark.student_key);
      const componentId = componentIds[componentOffset + Number(mark.component_index)];
      if (studentId && componentId) marks.push([componentId, studentId, mark.score ?? null, mark.mark_status || null, mark.comment || null, Boolean(mark.follow_up_required), JSON.stringify({
        source_import_id: importId,
        source_sheet: mark.source_sheet || null,
        source_row: mark.source_row || null,
        original_name: mark.display_name || mark.student_key || null,
      })]);
    });
    componentOffset += assessment.components.length;
  });
  await insertRows(connection, 'INSERT INTO alamatak_marks', ['component_id', 'student_id', 'score', 'mark_status', 'comment', 'follow_up_required', 'provenance'], marks,
    'ON DUPLICATE KEY UPDATE score = VALUES(score), mark_status = VALUES(mark_status), comment = VALUES(comment), follow_up_required = VALUES(follow_up_required)');

  for (const scheme of payload.schemes || []) {
    const [schemeResult] = await connection.query(
      `INSERT INTO alamatak_grading_schemes (gradebook_id, name, source_import_id, is_fallback) VALUES (?, ?, ?, ?)`,
      [gradebookId, scheme.name, importId, Boolean(scheme.is_fallback)]
    );
    const gradingComponents = Object.entries(scheme.components || {}).filter(([, component]) => component);
    await insertRows(connection, 'INSERT INTO alamatak_grading_components', ['scheme_id', 'component_key', 'label', 'maximum_score'], gradingComponents.map(([key, component]) => [schemeResult.insertId, key, component.label || key, component.maximum_score != null ? Number(component.maximum_score) : null]));
    const [componentRowsForScheme] = await connection.query('SELECT id, component_key FROM alamatak_grading_components WHERE scheme_id = ?', [schemeResult.insertId]);
    const thresholds = [];
    for (const [key, component] of gradingComponents) {
      const componentRow = componentRowsForScheme.find((row) => row.component_key === key);
      for (const [gradeLabel, minScore] of Object.entries(component.thresholds || {})) if (componentRow && minScore !== null && minScore !== undefined && Number.isFinite(Number(minScore))) thresholds.push([componentRow.id, gradeLabel, Number(minScore)]);
    }
    await insertRows(connection, 'INSERT INTO alamatak_grade_thresholds', ['grading_component_id', 'grade_label', 'minimum_score'], thresholds);
  }

  const historyRows = (payload.historical_records || []).map((record) => [gradebookId, record.student_key ? (studentMap.get(record.student_key) || null) : null, importId, record.record_type || 'imported', record.source_year || payload.academic_year || 'unknown', JSON.stringify(record.payload || record)]);
  await insertRows(connection, 'INSERT INTO alamatak_historical_records', ['gradebook_id', 'student_id', 'import_id', 'record_type', 'source_year', 'payload'], historyRows);
  return { importId, students: students.length, assessments: validAssessments.length, marks: marks.length, history: historyRows.length };
}

async function persistImportTransaction(connection, args) {
  await connection.beginTransaction();
  try {
    const result = await persistImportPackage(connection, args);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { buildUniqueStudents, persistImportPackage, persistImportTransaction };
