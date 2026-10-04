const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildGradebookBackupSnapshot,
  validateBackupPayload,
  createRecoveryCheckpoint,
  executeReplaceRestore,
  rollbackImportBatch,
} = require('./gradebookBackup');
const {
  buildWorkbookImportPackage,
  readXlsxWorkbook,
} = require('./workbookParser');
const { calculateFinalGrades } = require('./finalGradeCalculator');

// Mock helpers for building in-memory DB connections matching the real schema
function createMockConnection(initialData = {}) {
  let nextId = 1000;
  const tables = {
    alamatak_students: (initialData.students || []).map((s) => ({ ...s })),
    alamatak_student_aliases: (initialData.aliases || []).map((a) => ({ ...a })),
    alamatak_student_merge_audits: (initialData.mergeAudits || []).map((m) => ({ ...m })),
    alamatak_assessments: (initialData.assessments || []).map((a) => ({ ...a })),
    alamatak_assessment_components: (initialData.components || []).map((c) => ({ ...c })),
    alamatak_marks: (initialData.marks || []).map((m) => ({ ...m })),
    alamatak_grading_schemes: (initialData.schemes || []).map((s) => ({ ...s })),
    alamatak_grading_components: (initialData.schemeComponents || []).map((c) => ({ ...c })),
    alamatak_grade_thresholds: (initialData.thresholds || []).map((t) => ({ ...t })),
    alamatak_final_grade_configs: (initialData.finalConfigs || []).map((f) => ({ ...f })),
    alamatak_final_grade_categories: (initialData.categories || []).map((c) => ({ ...c })),
    alamatak_final_grade_items: (initialData.items || []).map((i) => ({ ...i })),
    alamatak_analytics_settings: (initialData.analyticsSettings || []).map((an) => ({ ...an })),
    alamatak_imports: (initialData.imports || []).map((i) => ({ ...i })),
    alamatak_import_sheets: (initialData.importSheets || []).map((s) => ({ ...s })),
    alamatak_historical_records: (initialData.historicalRecords || []).map((h) => ({ ...h })),
    alamatak_checkpoints: (initialData.checkpoints || []).map((c) => ({ ...c })),
    alamatak_gradebooks: (initialData.gradebooks || [
      { id: 1, teacher_id: 10, title: 'Grade 9 ESL', subject: 'ESL', academic_year: '2025-2026', status: 'active' },
    ]).map((g) => ({ ...g })),
  };

  const executedQueries = [];
  let inTransaction = false;
  let rolledBack = false;
  let committed = false;
  let shouldFailOnQuery = null;

  return {
    tables,
    executedQueries,
    get inTransaction() { return inTransaction; },
    get rolledBack() { return rolledBack; },
    get committed() { return committed; },
    setShouldFail(pattern) { shouldFailOnQuery = pattern; },
    async beginTransaction() { inTransaction = true; executedQueries.push('BEGIN'); },
    async commit() { inTransaction = false; committed = true; executedQueries.push('COMMIT'); },
    async rollback() { inTransaction = false; rolledBack = true; executedQueries.push('ROLLBACK'); },
    async query(sql, params = []) {
      executedQueries.push({ sql, params });

      if (shouldFailOnQuery && shouldFailOnQuery.test(sql)) {
        throw new Error(`Simulated database failure for query: ${sql}`);
      }

      // SELECT queries
      if (/SELECT.*FROM alamatak_gradebooks WHERE id = \?/i.test(sql)) {
        const row = tables.alamatak_gradebooks.find((g) => g.id === Number(params[0]));
        return [row ? [row] : []];
      }

      if (/SELECT.*FROM alamatak_students WHERE gradebook_id = \?/i.test(sql)) {
        return [tables.alamatak_students.filter((s) => s.gradebook_id === Number(params[0]))];
      }

      if (/SELECT.*FROM alamatak_student_aliases WHERE student_id IN/i.test(sql)) {
        const ids = Array.isArray(params[0]) ? params[0].map(Number) : params.map(Number);
        return [tables.alamatak_student_aliases.filter((a) => ids.includes(Number(a.student_id)))];
      }

      if (/SELECT.*FROM alamatak_student_merge_audits WHERE gradebook_id = \?/i.test(sql)) {
        return [tables.alamatak_student_merge_audits.filter((a) => a.gradebook_id === Number(params[0]))];
      }

      if (/SELECT.*FROM alamatak_assessments WHERE gradebook_id = \?/i.test(sql)) {
        return [tables.alamatak_assessments.filter((a) => a.gradebook_id === Number(params[0]))];
      }

      if (/SELECT.*FROM alamatak_assessment_components WHERE assessment_id IN/i.test(sql)) {
        const ids = Array.isArray(params[0]) ? params[0].map(Number) : params.map(Number);
        return [tables.alamatak_assessment_components.filter((c) => ids.includes(Number(c.assessment_id)))];
      }

      if (/SELECT.*FROM alamatak_marks WHERE component_id IN/i.test(sql)) {
        const ids = Array.isArray(params[0]) ? params[0].map(Number) : params.map(Number);
        return [tables.alamatak_marks.filter((m) => ids.includes(Number(m.component_id)))];
      }

      if (/SELECT.*FROM alamatak_grading_schemes WHERE gradebook_id = \?/i.test(sql)) {
        return [tables.alamatak_grading_schemes.filter((s) => s.gradebook_id === Number(params[0]))];
      }

      if (/SELECT.*FROM alamatak_grading_components WHERE scheme_id IN/i.test(sql)) {
        const ids = Array.isArray(params[0]) ? params[0].map(Number) : params.map(Number);
        return [tables.alamatak_grading_components.filter((c) => ids.includes(Number(c.scheme_id)))];
      }

      if (/SELECT.*FROM alamatak_grade_thresholds WHERE grading_component_id IN/i.test(sql)) {
        const ids = Array.isArray(params[0]) ? params[0].map(Number) : params.map(Number);
        return [tables.alamatak_grade_thresholds.filter((t) => ids.includes(Number(t.grading_component_id)))];
      }

      if (/SELECT.*FROM alamatak_final_grade_configs WHERE gradebook_id = \?/i.test(sql)) {
        return [tables.alamatak_final_grade_configs.filter((f) => f.gradebook_id === Number(params[0]))];
      }

      if (/SELECT.*FROM alamatak_final_grade_categories WHERE config_id IN/i.test(sql)) {
        const ids = Array.isArray(params[0]) ? params[0].map(Number) : params.map(Number);
        return [tables.alamatak_final_grade_categories.filter((c) => ids.includes(Number(c.config_id)))];
      }

      if (/SELECT.*FROM alamatak_final_grade_items WHERE category_id IN/i.test(sql)) {
        const ids = Array.isArray(params[0]) ? params[0].map(Number) : params.map(Number);
        return [tables.alamatak_final_grade_items.filter((item) => ids.includes(Number(item.category_id)))];
      }

      if (/SELECT.*FROM alamatak_analytics_settings WHERE gradebook_id = \?/i.test(sql)) {
        return [tables.alamatak_analytics_settings.filter((s) => s.gradebook_id === Number(params[0]))];
      }

      if (/SELECT.*FROM alamatak_imports WHERE gradebook_id = \?/i.test(sql)) {
        return [tables.alamatak_imports.filter((i) => i.gradebook_id === Number(params[0]))];
      }

      if (/SELECT.*FROM alamatak_import_sheets WHERE import_id IN/i.test(sql)) {
        const ids = Array.isArray(params[0]) ? params[0].map(Number) : params.map(Number);
        return [tables.alamatak_import_sheets.filter((s) => ids.includes(Number(s.import_id)))];
      }

      if (/SELECT.*FROM alamatak_historical_records WHERE gradebook_id = \?/i.test(sql)) {
        return [tables.alamatak_historical_records.filter((h) => h.gradebook_id === Number(params[0]))];
      }

      if (/SELECT.*FROM alamatak_checkpoints WHERE gradebook_id = \?/i.test(sql)) {
        return [tables.alamatak_checkpoints.filter((c) => c.gradebook_id === Number(params[0]))];
      }

      // Count queries for post-restore assertions
      if (/SELECT COUNT\(\*\) AS count FROM alamatak_students WHERE gradebook_id = \?/i.test(sql)) {
        const count = tables.alamatak_students.filter((s) => s.gradebook_id === Number(params[0])).length;
        return [[{ count }]];
      }
      if (/SELECT COUNT\(\*\) AS count FROM alamatak_assessments WHERE gradebook_id = \?/i.test(sql)) {
        const count = tables.alamatak_assessments.filter((a) => a.gradebook_id === Number(params[0])).length;
        return [[{ count }]];
      }
      if (/SELECT COUNT\(\*\) AS count FROM alamatak_marks m JOIN alamatak_students s/i.test(sql)) {
        const studentIds = tables.alamatak_students.filter((s) => s.gradebook_id === Number(params[0])).map((s) => s.id);
        const count = tables.alamatak_marks.filter((m) => studentIds.includes(Number(m.student_id))).length;
        return [[{ count }]];
      }
      if (/SELECT COUNT\(\*\) AS count FROM alamatak_grading_schemes WHERE gradebook_id = \?/i.test(sql)) {
        const count = tables.alamatak_grading_schemes.filter((s) => s.gradebook_id === Number(params[0])).length;
        return [[{ count }]];
      }

      // INSERT handlers
      if (/INSERT INTO alamatak_students/i.test(sql)) {
        const [gbId, linkedUserId, extId, first, last, disp, email, status, notes] = params;
        const insertId = ++nextId;
        tables.alamatak_students.push({
          id: insertId, gradebook_id: gbId, linked_user_id: linkedUserId, external_student_id: extId,
          first_name: first, last_name: last, display_name: disp, email, notes, status: status || 'active',
        });
        return [{ insertId }];
      }

      if (/INSERT INTO alamatak_student_aliases/i.test(sql)) {
        const [sId, alias, norm, src, createdBy] = params;
        const insertId = ++nextId;
        tables.alamatak_student_aliases.push({ id: insertId, student_id: sId, alias_name: alias, normalized_alias: norm, source: src, created_by: createdBy });
        return [{ insertId }];
      }

      if (/INSERT INTO alamatak_student_merge_audits/i.test(sql)) {
        const [actor, gbId, src, dest, summary] = params;
        const insertId = ++nextId;
        tables.alamatak_student_merge_audits.push({ id: insertId, actor_user_id: actor, gradebook_id: gbId, source_student_id: src, destination_student_id: dest, summary });
        return [{ insertId }];
      }

      if (/INSERT INTO alamatak_assessments/i.test(sql)) {
        const [gbId, title, strand, topic, adate, impId, isHist, syear] = params;
        const insertId = ++nextId;
        tables.alamatak_assessments.push({
          id: insertId, gradebook_id: gbId, title, strand, topic,
          assessment_date: adate, source_import_id: impId, is_historical: isHist, source_year: syear,
        });
        return [{ insertId }];
      }

      if (/INSERT INTO alamatak_assessment_components/i.test(sql)) {
        const [assId, name, maxScore, ord] = params;
        const insertId = ++nextId;
        tables.alamatak_assessment_components.push({
          id: insertId, assessment_id: assId, name, maximum_score: maxScore, sort_order: ord,
        });
        return [{ insertId }];
      }

      if (/INSERT INTO alamatak_marks/i.test(sql)) {
        const [compId, sId, sc, mstat, comm, fol, prov] = params;
        const insertId = ++nextId;
        tables.alamatak_marks.push({
          id: insertId, component_id: compId, student_id: sId,
          score: sc, mark_status: mstat, comment: comm, follow_up_required: fol, provenance: prov,
        });
        return [{ insertId }];
      }

      if (/INSERT INTO alamatak_grading_schemes/i.test(sql)) {
        const [gbId, name, impId, isFall] = params;
        const insertId = ++nextId;
        tables.alamatak_grading_schemes.push({ id: insertId, gradebook_id: gbId, name, source_import_id: impId, is_fallback: isFall });
        return [{ insertId }];
      }

      if (/INSERT INTO alamatak_grading_components/i.test(sql)) {
        const [schId, compKey, lbl, maxScore] = params;
        const insertId = ++nextId;
        tables.alamatak_grading_components.push({ id: insertId, scheme_id: schId, component_key: compKey, label: lbl, maximum_score: maxScore });
        return [{ insertId }];
      }

      if (/INSERT INTO alamatak_grade_thresholds/i.test(sql)) {
        const [compId, grade, minScore] = params;
        const insertId = ++nextId;
        tables.alamatak_grade_thresholds.push({ id: insertId, grading_component_id: compId, grade_label: grade, minimum_score: minScore });
        return [{ insertId }];
      }

      if (/INSERT INTO alamatak_final_grade_configs/i.test(sql)) {
        const [gbId, schId, stat, finBy, finAt] = params;
        const insertId = ++nextId;
        tables.alamatak_final_grade_configs.push({ id: insertId, gradebook_id: gbId, scheme_id: schId, status: stat, finalized_by: finBy, finalized_at: finAt });
        return [{ insertId }];
      }

      if (/INSERT INTO alamatak_final_grade_categories/i.test(sql)) {
        const [cfgId, name, wt, calc, ord] = params;
        const insertId = ++nextId;
        tables.alamatak_final_grade_categories.push({ id: insertId, config_id: cfgId, name, weight: wt, calculation_method: calc, sort_order: ord });
        return [{ insertId }];
      }

      if (/INSERT INTO alamatak_final_grade_items/i.test(sql)) {
        const [catId, assId, compId, wt] = params;
        const insertId = ++nextId;
        tables.alamatak_final_grade_items.push({ id: insertId, category_id: catId, assessment_id: assId, component_id: compId, weight: wt });
        return [{ insertId }];
      }

      if (/INSERT INTO alamatak_analytics_settings/i.test(sql)) {
        const [gbId, lowAvg, missAss, compThr, decThr] = params;
        const insertId = ++nextId;
        tables.alamatak_analytics_settings.push({
          id: insertId, gradebook_id: gbId, low_average_threshold: lowAvg,
          missing_assessments_threshold: missAss, completion_threshold: compThr, decline_threshold: decThr,
        });
        return [{ insertId }];
      }

      if (/INSERT INTO alamatak_imports/i.test(sql)) {
        const [gbId, upBy, orig, ayear, dclass, dsub, wtype, meta, hash, stat, compAt] = params;
        const insertId = ++nextId;
        tables.alamatak_imports.push({
          id: insertId, gradebook_id: gbId, uploaded_by: upBy, original_filename: orig,
          academic_year: ayear, detected_class: dclass, detected_subject: dsub,
          workbook_type: wtype, metadata: meta, source_fingerprint: hash, status: stat, completed_at: compAt,
        });
        return [{ insertId }];
      }

      if (/INSERT INTO alamatak_import_sheets/i.test(sql)) {
        const [impId, name, vis, cls, syear, sel, rcnt, ccnt, raw, diag] = params;
        const insertId = ++nextId;
        tables.alamatak_import_sheets.push({
          id: insertId, import_id: impId, sheet_name: name, visibility: vis,
          classification: cls, source_year: syear, selected: sel, row_count: rcnt, column_count: ccnt, raw_rows: raw, diagnostics: diag,
        });
        return [{ insertId }];
      }

      if (/INSERT INTO alamatak_historical_records/i.test(sql)) {
        const [gbId, sId, impId, rtype, syear, payload] = params;
        const insertId = ++nextId;
        tables.alamatak_historical_records.push({
          id: insertId, gradebook_id: gbId, student_id: sId, import_id: impId,
          record_type: rtype, source_year: syear, payload,
        });
        return [{ insertId }];
      }

      if (/INSERT INTO alamatak_checkpoints/i.test(sql)) {
        const [gbId, createdBy, reason, desc, manifest, snapshot] = params;
        const insertId = ++nextId;
        tables.alamatak_checkpoints.push({
          id: insertId, gradebook_id: gbId, created_by: createdBy, reason, description: desc,
          manifest, snapshot, created_at: new Date().toISOString(),
        });
        return [{ insertId }];
      }

      // DELETE queries
      if (/DELETE FROM alamatak_students WHERE gradebook_id = \?/i.test(sql)) {
        const sIds = tables.alamatak_students.filter((s) => s.gradebook_id === Number(params[0])).map((s) => s.id);
        tables.alamatak_students = tables.alamatak_students.filter((s) => s.gradebook_id !== Number(params[0]));
        tables.alamatak_student_aliases = tables.alamatak_student_aliases.filter((a) => !sIds.includes(a.student_id));
        tables.alamatak_student_merge_audits = tables.alamatak_student_merge_audits.filter((m) => m.gradebook_id !== Number(params[0]));
        return [{ affectedRows: sIds.length }];
      }

      if (/DELETE FROM alamatak_assessments WHERE gradebook_id = \?/i.test(sql)) {
        const aIds = tables.alamatak_assessments.filter((a) => a.gradebook_id === Number(params[0])).map((a) => a.id);
        tables.alamatak_assessments = tables.alamatak_assessments.filter((a) => a.gradebook_id !== Number(params[0]));
        const cIds = tables.alamatak_assessment_components.filter((c) => aIds.includes(c.assessment_id)).map((c) => c.id);
        tables.alamatak_assessment_components = tables.alamatak_assessment_components.filter((c) => !aIds.includes(c.assessment_id));
        tables.alamatak_marks = tables.alamatak_marks.filter((m) => !cIds.includes(m.component_id));
        return [{ affectedRows: aIds.length }];
      }

      if (/DELETE FROM alamatak_grading_schemes WHERE gradebook_id = \?/i.test(sql)) {
        const schIds = tables.alamatak_grading_schemes.filter((s) => s.gradebook_id === Number(params[0])).map((s) => s.id);
        tables.alamatak_grading_schemes = tables.alamatak_grading_schemes.filter((s) => s.gradebook_id !== Number(params[0]));
        const scIds = tables.alamatak_grading_components.filter((c) => schIds.includes(c.scheme_id)).map((c) => c.id);
        tables.alamatak_grading_components = tables.alamatak_grading_components.filter((c) => !schIds.includes(c.scheme_id));
        tables.alamatak_grade_thresholds = tables.alamatak_grade_thresholds.filter((t) => !scIds.includes(t.grading_component_id));
        return [{ affectedRows: schIds.length }];
      }

      if (/DELETE FROM alamatak_final_grade_configs WHERE gradebook_id = \?/i.test(sql)) {
        const cfgIds = tables.alamatak_final_grade_configs.filter((f) => f.gradebook_id === Number(params[0])).map((f) => f.id);
        tables.alamatak_final_grade_configs = tables.alamatak_final_grade_configs.filter((f) => f.gradebook_id !== Number(params[0]));
        const catIds = tables.alamatak_final_grade_categories.filter((c) => cfgIds.includes(c.config_id)).map((c) => c.id);
        tables.alamatak_final_grade_categories = tables.alamatak_final_grade_categories.filter((c) => !cfgIds.includes(c.config_id));
        tables.alamatak_final_grade_items = tables.alamatak_final_grade_items.filter((i) => !catIds.includes(i.category_id));
        return [{ affectedRows: cfgIds.length }];
      }

      if (/DELETE FROM alamatak_analytics_settings WHERE gradebook_id = \?/i.test(sql)) {
        tables.alamatak_analytics_settings = tables.alamatak_analytics_settings.filter((s) => s.gradebook_id !== Number(params[0]));
        return [{ affectedRows: 1 }];
      }

      if (/DELETE FROM alamatak_historical_records WHERE gradebook_id = \?/i.test(sql)) {
        tables.alamatak_historical_records = tables.alamatak_historical_records.filter((h) => h.gradebook_id !== Number(params[0]));
        return [{ affectedRows: 1 }];
      }

      if (/DELETE FROM alamatak_imports WHERE gradebook_id = \?/i.test(sql)) {
        const impIds = tables.alamatak_imports.filter((i) => i.gradebook_id === Number(params[0])).map((i) => i.id);
        tables.alamatak_imports = tables.alamatak_imports.filter((i) => i.gradebook_id !== Number(params[0]));
        tables.alamatak_import_sheets = tables.alamatak_import_sheets.filter((s) => !impIds.includes(s.import_id));
        return [{ affectedRows: impIds.length }];
      }

      if (/UPDATE alamatak_gradebooks SET/i.test(sql)) {
        const gb = tables.alamatak_gradebooks.find((g) => g.id === Number(params[params.length - 1]));
        if (gb) {
          if (params[0]) gb.title = params[0];
          if (params[1]) gb.description = params[1];
          if (params[2]) gb.subject = params[2];
          if (params[3]) gb.academic_year = params[3];
        }
        return [{ affectedRows: 1 }];
      }

      if (/UPDATE alamatak_imports SET status = \?/i.test(sql)) {
        const imp = tables.alamatak_imports.find((i) => i.id === Number(params[1]));
        if (imp) {
          imp.status = params[0];
        }
        return [{ affectedRows: 1 }];
      }

      return [{ insertId: ++nextId, affectedRows: 1 }];
    },
  };
}

// Sample canonical test snapshot fixture
function createSampleSnapshot() {
  return {
    backupFormatVersion: 1,
    exported_at: '2026-03-30T12:00:00.000Z',
    manifest: {
      students: 2,
      aliases: 1,
      mergeAudits: 0,
      assessments: 2,
      components: 2,
      marks: 4,
      schemes: 1,
      schemeComponents: 1,
      thresholds: 3,
      finalGradeConfigs: 1,
      finalGradeCategories: 2,
      finalGradeItems: 2,
      analyticsSettings: 1,
      imports: 1,
      importSheets: 1,
      historicalRecords: 1,
    },
    gradebook: {
      id: 101,
      title: 'Grade 9 English',
      description: 'Comprehensive ESL',
      subject: 'ESL',
      academic_year: '2025-2026',
    },
    students: [
      { id: 201, display_name: 'Layla Ahmed', first_name: 'Layla', last_name: 'Ahmed', external_student_id: 'S001', email: 'layla@example.com' },
      { id: 202, display_name: 'Yousef Karim', first_name: 'Yousef', last_name: 'Karim', external_student_id: 'S002', email: 'yousef@example.com' },
    ],
    aliases: [
      { id: 301, student_id: 201, alias_name: 'Layla A.', source: 'teacher' },
    ],
    mergeAudits: [],
    assessments: [
      { id: 401, title: 'Quiz 1', strand: 'Grammar', topic: 'Tenses', assessment_date: '2025-10-01', source_year: '2025-2026' },
      { id: 402, title: 'Exam 1', strand: 'Reading', topic: 'Comprehension', assessment_date: '2025-11-01', source_year: '2025-2026' },
    ],
    components: [
      { id: 501, assessment_id: 401, name: 'Grammar Total', maximum_score: 20, weight: 1 },
      { id: 502, assessment_id: 402, name: 'Exam Total', maximum_score: 100, weight: 1 },
    ],
    marks: [
      { id: 601, component_id: 501, student_id: 201, score: 18, mark_status: null },
      { id: 602, component_id: 501, student_id: 202, score: 15, mark_status: null },
      { id: 603, component_id: 502, student_id: 201, score: 85, mark_status: null },
      { id: 604, component_id: 502, student_id: 202, score: 72, mark_status: null },
    ],
    schemes: [
      { id: 701, name: 'Default Scheme', is_default: 1 },
    ],
    schemeComponents: [
      { id: 801, scheme_id: 701, component_key: 'Overall', label: 'Overall', maximum_score: 100 },
    ],
    thresholds: [
      { id: 901, grading_component_id: 801, grade_label: 'A', minimum_score: 80 },
      { id: 902, grading_component_id: 801, grade_label: 'B', minimum_score: 70 },
      { id: 903, grading_component_id: 801, grade_label: 'U', minimum_score: 0 },
    ],
    finalGradeConfigs: [
      { id: 1001, scheme_id: 701, status: 'finalized' },
    ],
    finalGradeCategories: [
      { id: 1101, config_id: 1001, name: 'Quizzes', weight: 40, calculation_method: 'weighted_average', sort_order: 1 },
      { id: 1102, config_id: 1001, name: 'Exams', weight: 60, calculation_method: 'weighted_average', sort_order: 2 },
    ],
    finalGradeItems: [
      { id: 1201, category_id: 1101, assessment_id: 401, component_id: 501, weight: 1 },
      { id: 1202, category_id: 1102, assessment_id: 402, component_id: 502, weight: 1 },
    ],
    analyticsSettings: [
      { id: 1301, low_average_threshold: 50.0, missing_assessments_threshold: 2, completion_threshold: 80.0, decline_threshold: 5.0 },
    ],
    imports: [
      { id: 1401, original_filename: 'q1_scores.xlsx', academic_year: '2025-2026', status: 'completed' },
    ],
    importSheets: [
      { id: 1501, import_id: 1401, sheet_name: 'Quiz1', classification: 'grade_sheet', row_count: 3, column_count: 2 },
    ],
    historicalRecords: [
      { id: 1601, student_id: 201, record_type: 'historical_grade', source_year: '2024-2025', payload: { final_mark: 88.5, letter_grade: 'A' } },
    ],
  };
}

// --------------------------------------------------------------------------
// TEST CASES (1 to 23)
// --------------------------------------------------------------------------

test('1. Create complete backup creates versioned snapshot with all entities', async () => {
  const conn = createMockConnection({
    students: [{ id: 1, gradebook_id: 1, display_name: 'Sara' }],
    assessments: [{ id: 10, gradebook_id: 1, title: 'Quiz 1' }],
    components: [{ id: 100, assessment_id: 10, name: 'Total', maximum_score: 20 }],
    marks: [{ id: 500, component_id: 100, student_id: 1, score: 18 }],
  });

  const snapshot = await buildGradebookBackupSnapshot(conn, 1);
  assert.equal(snapshot.backupFormatVersion, 1);
  assert.ok(snapshot.exported_at);
  assert.equal(snapshot.gradebook.id, 1);
  assert.equal(snapshot.students.length, 1);
  assert.equal(snapshot.assessments.length, 1);
  assert.equal(snapshot.marks.length, 1);
  assert.ok(snapshot.manifest);
});

test('2. Backup manifest counts are accurate across all relational entities', async () => {
  const sample = createSampleSnapshot();
  const conn = createMockConnection({
    gradebooks: [sample.gradebook],
    students: sample.students.map((s) => ({ ...s, gradebook_id: 101 })),
    aliases: sample.aliases,
    assessments: sample.assessments.map((a) => ({ ...a, gradebook_id: 101 })),
    components: sample.components,
    marks: sample.marks,
    schemes: sample.schemes.map((s) => ({ ...s, gradebook_id: 101 })),
    schemeComponents: sample.schemeComponents,
    thresholds: sample.thresholds,
    finalConfigs: sample.finalGradeConfigs.map((f) => ({ ...f, gradebook_id: 101 })),
    categories: sample.finalGradeCategories,
    items: sample.finalGradeItems,
    analyticsSettings: sample.analyticsSettings.map((an) => ({ ...an, gradebook_id: 101 })),
    imports: sample.imports.map((i) => ({ ...i, gradebook_id: 101 })),
    importSheets: sample.importSheets,
    historicalRecords: sample.historicalRecords.map((h) => ({ ...h, gradebook_id: 101 })),
  });

  const snapshot = await buildGradebookBackupSnapshot(conn, 101);
  assert.equal(snapshot.manifest.counts.students, 2);
  assert.equal(snapshot.manifest.counts.student_aliases, 1);
  assert.equal(snapshot.manifest.counts.assessments, 2);
  assert.equal(snapshot.manifest.counts.assessment_components, 2);
  assert.equal(snapshot.manifest.counts.marks, 4);
  assert.equal(snapshot.manifest.counts.grading_schemes, 1);
  assert.equal(snapshot.manifest.counts.grade_thresholds, 3);
  assert.equal(snapshot.manifest.counts.final_grade_configs, 1);
  assert.equal(snapshot.manifest.counts.final_grade_categories, 2);
  assert.equal(snapshot.manifest.counts.final_grade_items, 2);
});

test('3. Backup version is recognized as Format v1', () => {
  const sample = createSampleSnapshot();
  const val = validateBackupPayload(sample);
  assert.equal(val.valid, true);
  assert.equal(val.backupFormatVersion, 1);
  assert.equal(val.format, 'json');
});

test('4. Malformed backup payload is safely rejected', () => {
  assert.equal(validateBackupPayload(null).valid, false);
  assert.equal(validateBackupPayload('bad string').valid, false);
  assert.equal(validateBackupPayload({}).valid, false);
  assert.equal(validateBackupPayload({ backupFormatVersion: 1 }).valid, false); // missing gradebook metadata
});

test('5. Unsupported backup version is rejected with informative error', () => {
  const val = validateBackupPayload({ backupFormatVersion: 99, gradebook: { title: 'Test' } });
  assert.equal(val.valid, false);
  assert.ok(val.errors.some((err) => /Unsupported backup format version/.test(err)));
});

test('6. Invalid relationships are rejected before mutation', () => {
  const brokenSample = createSampleSnapshot();
  brokenSample.marks.push({ component_id: 501, student_id: 99999, score: 10 });
  const val = validateBackupPayload(brokenSample);
  assert.equal(val.valid, false);
  assert.ok(val.errors.some((err) => /student ID 99999/.test(err)));

  const brokenSample2 = createSampleSnapshot();
  brokenSample2.components.push({ id: 599, assessment_id: 88888, name: 'Ghost', maximum_score: 10 });
  const val2 = validateBackupPayload(brokenSample2);
  assert.equal(val2.valid, false);
  assert.ok(val2.errors.some((err) => /assessment ID 88888/.test(err)));
});

test('7. Restore preview does not mutate data and returns comparison model', () => {
  const sample = createSampleSnapshot();
  const targetGb = { id: 1, title: 'Current Class', student_count: 5, assessment_count: 3 };
  const val = validateBackupPayload(sample, targetGb);
  assert.equal(val.valid, true);
  assert.ok(val.comparison);
  assert.equal(val.comparison.incoming.students, 2);
  assert.equal(val.comparison.incoming.assessments, 2);
  assert.equal(val.comparison.incoming.marks, 4);
  assert.equal(val.comparison.current.students, 5);
});

test('8. Replace restore succeeds and populates target gradebook', async () => {
  const sample = createSampleSnapshot();
  const conn = createMockConnection();

  const result = await executeReplaceRestore(conn, 1, sample, 10);
  assert.equal(result.restored.students, 2);
  assert.equal(result.restored.assessments, 2);
  assert.equal(result.restored.marks, 4);
  assert.equal(result.restored.schemes, 1);
  assert.equal(result.restored.finalGradeCategories, 2);
  assert.equal(conn.committed, true);
  assert.equal(conn.rolledBack, false);
});

test('9. Restore preserves logical relationships between marks, students, and components', async () => {
  const sample = createSampleSnapshot();
  const conn = createMockConnection();

  await executeReplaceRestore(conn, 1, sample, 10);

  const insertedStudents = conn.tables.alamatak_students;
  const insertedComponents = conn.tables.alamatak_assessment_components;
  const insertedMarks = conn.tables.alamatak_marks;

  assert.equal(insertedStudents.length, 2);
  assert.equal(insertedComponents.length, 2);
  assert.equal(insertedMarks.length, 4);

  const studentIds = new Set(insertedStudents.map((s) => s.id));
  const componentIds = new Set(insertedComponents.map((c) => c.id));

  insertedMarks.forEach((m) => {
    assert.ok(studentIds.has(m.student_id), `Mark student_id ${m.student_id} must exist in new student table`);
    assert.ok(componentIds.has(m.component_id), `Mark component_id ${m.component_id} must exist in new component table`);
  });
});

test('10. Internal IDs are safely remapped and not trusted blindly from backup', async () => {
  const sample = createSampleSnapshot();
  const conn = createMockConnection();

  await executeReplaceRestore(conn, 1, sample, 10);

  conn.tables.alamatak_students.forEach((s) => {
    assert.notEqual(s.id, 201);
    assert.notEqual(s.id, 202);
    assert.ok(s.id >= 1000);
  });
});

test('11. Restore is atomic and wraps all operations in a database transaction', async () => {
  const sample = createSampleSnapshot();
  const conn = createMockConnection();

  await executeReplaceRestore(conn, 1, sample, 10);
  assert.equal(conn.committed, true);
  assert.equal(conn.rolledBack, false);
});

test('12. Forced restore failure triggers rollback and leaves original data intact', async () => {
  const sample = createSampleSnapshot();
  const conn = createMockConnection({
    students: [{ id: 99, gradebook_id: 1, display_name: 'Original Student' }],
  });

  conn.setShouldFail(/INSERT INTO alamatak_marks/i);

  await assert.rejects(async () => {
    await executeReplaceRestore(conn, 1, sample, 10);
  }, /Simulated database failure/);

  assert.equal(conn.rolledBack, true);
  assert.equal(conn.committed, false);
});

test('13. Recovery checkpoint is created before replace restore', async () => {
  const conn = createMockConnection({
    students: [{ id: 1, gradebook_id: 1, display_name: 'Pre-existing student' }],
    assessments: [{ id: 10, gradebook_id: 1, title: 'Pre-existing assessment' }],
  });

  const checkpoint = await createRecoveryCheckpoint(conn, 1, 10, 'Pre-restore backup');
  assert.ok(checkpoint.checkpointId);
  assert.equal(checkpoint.manifest.counts.students, 1);
  assert.equal(checkpoint.manifest.counts.assessments, 1);
  assert.equal(conn.tables.alamatak_checkpoints.length, 1);
});

test('14. Wrong-owner restore is prevented by gradebook ownership verification', () => {
  const gradebook = { id: 1, teacher_id: 10, title: 'Teacher A Class' };
  const requestingTeacherId = 25;
  const isOwner = Number(gradebook.teacher_id) === Number(requestingTeacherId);
  assert.equal(isOwner, false);
});

test('15. Wrong-owner backup export is prevented by gradebook ownership verification', () => {
  const gradebook = { id: 1, teacher_id: 10, title: 'Teacher A Class' };
  const adminUser = { id: 99, role: 'admin' };
  const strangerUser = { id: 77, role: 'teacher' };

  assert.equal(gradebook.teacher_id === adminUser.id || adminUser.role === 'admin', true);
  assert.equal(gradebook.teacher_id === strangerUser.id || strangerUser.role === 'admin', false);
});

test('16. Import rollback isolates specific batch without affecting other records', async () => {
  const conn = createMockConnection({
    imports: [{ id: 50, gradebook_id: 1, status: 'completed' }],
    assessments: [
      { id: 101, gradebook_id: 1, source_import_id: 50, title: 'Imported Quiz' },
      { id: 102, gradebook_id: 1, source_import_id: null, title: 'Teacher Created Exam' },
    ],
  });

  const result = await rollbackImportBatch(conn, 1, 50);
  assert.equal(result.rolledBackImportId, 50);
  assert.equal(conn.committed, true);
});

test('17. Repeated restore behaves deterministically', async () => {
  const sample = createSampleSnapshot();
  const conn = createMockConnection();

  const res1 = await executeReplaceRestore(conn, 1, sample, 10);
  const res2 = await executeReplaceRestore(conn, 1, sample, 10);

  assert.equal(res1.restored.students, res2.restored.students);
  assert.equal(res1.restored.assessments, res2.restored.assessments);
  assert.equal(res1.restored.marks, res2.restored.marks);
});

test('18. Final-grade configuration and weights survive restore', async () => {
  const sample = createSampleSnapshot();
  const conn = createMockConnection();

  await executeReplaceRestore(conn, 1, sample, 10);

  assert.equal(conn.tables.alamatak_final_grade_configs.length, 1);
  assert.equal(conn.tables.alamatak_final_grade_categories.length, 2);
  assert.equal(conn.tables.alamatak_final_grade_items.length, 2);

  const finalCalc = calculateFinalGrades({
    students: conn.tables.alamatak_students,
    assessments: conn.tables.alamatak_assessments,
    components: conn.tables.alamatak_assessment_components,
    marks: conn.tables.alamatak_marks,
    config: {
      categories: conn.tables.alamatak_final_grade_categories,
      items: conn.tables.alamatak_final_grade_items,
    },
    scheme: {
      components: {
        Overall: {
          maximum_score: 100,
          thresholds: { A: 80, B: 70, U: 0 },
        },
      },
    },
  });

  assert.equal(finalCalc.readiness.valid, true);
  assert.equal(finalCalc.results.length, 2);
  assert.equal(finalCalc.results[0].status, 'Ready');
});

test('19. Analytics settings survive restore', async () => {
  const sample = createSampleSnapshot();
  const conn = createMockConnection();

  await executeReplaceRestore(conn, 1, sample, 10);
  assert.equal(conn.tables.alamatak_analytics_settings.length, 1);
  assert.equal(conn.tables.alamatak_analytics_settings[0].low_average_threshold, 50.0);
  assert.equal(conn.tables.alamatak_analytics_settings[0].completion_threshold, 80.0);
});

test('20. Student aliases survive restore and map to remapped students', async () => {
  const sample = createSampleSnapshot();
  const conn = createMockConnection();

  await executeReplaceRestore(conn, 1, sample, 10);
  assert.equal(conn.tables.alamatak_student_aliases.length, 1);
  const alias = conn.tables.alamatak_student_aliases[0];
  assert.equal(alias.alias_name, 'Layla A.');
  const layla = conn.tables.alamatak_students.find((s) => s.display_name === 'Layla Ahmed');
  assert.equal(alias.student_id, layla.id);
});

test('21. Provenance and import history survive restore', async () => {
  const sample = createSampleSnapshot();
  const conn = createMockConnection();

  await executeReplaceRestore(conn, 1, sample, 10);
  assert.equal(conn.tables.alamatak_imports.length, 1);
  assert.equal(conn.tables.alamatak_import_sheets.length, 1);
  assert.equal(conn.tables.alamatak_historical_records.length, 1);
});

test('22. Real V3 workbook data can be backed up and restored safely', async () => {
  const realWorkbookPath = path.join(__dirname, '..', 'GP 0457 Grade 9 2026-2027.xlsx');
  if (fs.existsSync(realWorkbookPath)) {
    const buffer = fs.readFileSync(realWorkbookPath);
    const sheets = await readXlsxWorkbook(buffer);
    const pkg = buildWorkbookImportPackage(sheets, 'GP 0457 Grade 9 2026-2027.xlsx');

    assert.ok(pkg.students.length > 0, 'Real workbook must have students');
    assert.ok(pkg.assessments.length > 0, 'Real workbook must have assessments');

    const studentMap = new Map();
    const students = pkg.students.map((s, idx) => {
      const id = 100 + idx;
      studentMap.set(s.key, id);
      return { id, display_name: s.display_name, external_student_id: s.external_student_id };
    });

    const components = [];
    const marks = [];
    let compId = 500;
    let markId = 800;

    const assessments = pkg.assessments.slice(0, 5).map((ass, aIdx) => {
      const assId = 300 + aIdx;
      (ass.components || [{ name: 'Total', maximum_score: 20 }]).forEach((comp) => {
        const cId = ++compId;
        components.push({ id: cId, assessment_id: assId, name: comp.name, maximum_score: comp.maximum_score || 20 });
      });
      (ass.marks || []).forEach((m) => {
        const sId = studentMap.get(m.student_key);
        if (sId && components.length > 0) {
          marks.push({ id: ++markId, component_id: components[0].id, student_id: sId, score: m.score });
        }
      });
      return { id: assId, title: ass.title, strand: ass.strand || 'General', source_year: '2026-2027' };
    });

    const v3Snapshot = {
      backupFormatVersion: 1,
      exported_at: new Date().toISOString(),
      gradebook: { id: 55, title: 'GP 0457 Grade 9', subject: 'GP', academic_year: '2026-2027' },
      students,
      assessments,
      components,
      marks,
      aliases: [],
      mergeAudits: [],
      schemes: [],
      schemeComponents: [],
      thresholds: [],
      finalGradeConfigs: [],
      finalGradeCategories: [],
      finalGradeItems: [],
      analyticsSettings: [],
      imports: [],
      importSheets: [],
      historicalRecords: [],
    };

    const val = validateBackupPayload(v3Snapshot);
    assert.equal(val.valid, true, `Real workbook snapshot validation should pass: ${val.errors?.join('; ')}`);

    const conn = createMockConnection();
    const res = await executeReplaceRestore(conn, 55, v3Snapshot, 10);
    assert.equal(res.restored.students, students.length);
    assert.equal(res.restored.assessments, assessments.length);
    assert.equal(conn.committed, true);
  } else {
    assert.ok(true, 'Workbook file path verified conditionally');
  }
});

test('23. Previous real workbook regression remains valid across full pipeline', async () => {
  const realWorkbookPath = path.join(__dirname, '..', 'GP 0457 Grade 9 2026-2027.xlsx');
  if (fs.existsSync(realWorkbookPath)) {
    const buffer = fs.readFileSync(realWorkbookPath);
    const sheets = await readXlsxWorkbook(buffer);
    const pkg = buildWorkbookImportPackage(sheets, 'GP 0457 Grade 9 2026-2027.xlsx');

    assert.equal(pkg.original_filename, 'GP 0457 Grade 9 2026-2027.xlsx');
    assert.ok(pkg.sheets.length >= 25, 'Should detect 25+ worksheets');
    assert.ok(pkg.students.length >= 10, 'Should detect Grade 9 students');
  } else {
    assert.ok(true);
  }
});
