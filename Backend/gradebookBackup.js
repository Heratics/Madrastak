/**
 * 3alamatak Canonical Backup, Validation, and Transactional Restore Engine
 * 
 * Provides:
 * 1. Canonical versioned gradebook backup snapshot generation with manifest
 * 2. Pre-restore validation without database mutation
 * 3. Atomic, transactional replace restore with safe ID remapping
 * 4. Automatic recovery checkpointing with sensible retention
 * 5. Post-restore verification assertions
 */

function normalizeEntityArray(value) {
  return Array.isArray(value) ? value : [];
}

async function buildGradebookBackupSnapshot(db, gradebookId) {
  const [gradebookRowsRaw] = (await db.query(
    'SELECT id, owner_user_id, madrastak_class_id, title, description, subject, academic_year, status, created_at, updated_at FROM alamatak_gradebooks WHERE id = ?',
    [gradebookId]
  )) || [];
  const gradebookRows = gradebookRowsRaw || [];
  if (!gradebookRows.length) return null;
  const gradebook = gradebookRows[0];

  const [studentsRaw] = (await db.query(
    'SELECT id, gradebook_id, linked_user_id, external_student_id, first_name, last_name, display_name, email, status, notes, source_import_id, created_at, updated_at FROM alamatak_students WHERE gradebook_id = ? ORDER BY id',
    [gradebookId]
  )) || [];
  const students = studentsRaw || [];

  const studentIds = students.map((s) => s.id);
  let studentAliases = [];
  if (studentIds.length) {
    const [aliasesRaw] = (await db.query(
      'SELECT id, student_id, alias_name, normalized_alias, source, created_by, created_at FROM alamatak_student_aliases WHERE student_id IN (?) ORDER BY id',
      [studentIds]
    )) || [];
    studentAliases = aliasesRaw || [];
  }

  const [mergeAuditsRaw] = (await db.query(
    'SELECT id, actor_user_id, gradebook_id, source_student_id, destination_student_id, summary, created_at FROM alamatak_student_merge_audits WHERE gradebook_id = ? ORDER BY id',
    [gradebookId]
  )) || [];
  const mergeAudits = mergeAuditsRaw || [];

  const [assessmentsRaw] = (await db.query(
    'SELECT id, gradebook_id, title, strand, topic, assessment_date, source_import_id, is_historical, source_year, created_at, updated_at FROM alamatak_assessments WHERE gradebook_id = ? ORDER BY id',
    [gradebookId]
  )) || [];
  const assessments = assessmentsRaw || [];

  const assessmentIds = assessments.map((a) => a.id);
  let components = [];
  let marks = [];
  if (assessmentIds.length) {
    const [componentsRaw] = (await db.query(
      'SELECT id, assessment_id, name, maximum_score, sort_order, component_type, calculation_type, source_component_ids, formula_definition FROM alamatak_assessment_components WHERE assessment_id IN (?) ORDER BY assessment_id, sort_order, id',
      [assessmentIds]
    )) || [];
    components = componentsRaw || [];
    const componentIds = components.map((c) => c.id);
    if (componentIds.length) {
      const [marksRaw] = (await db.query(
        'SELECT id, component_id, student_id, score, mark_status, comment, follow_up_required, provenance, updated_at FROM alamatak_marks WHERE component_id IN (?) ORDER BY id',
        [componentIds]
      )) || [];
      marks = marksRaw || [];
    }
  }

  const [schemesRaw] = (await db.query(
    'SELECT id, gradebook_id, name, source_import_id, is_fallback, created_at, updated_at FROM alamatak_grading_schemes WHERE gradebook_id = ? ORDER BY id',
    [gradebookId]
  )) || [];
  const schemes = schemesRaw || [];

  const schemeIds = schemes.map((s) => s.id);
  let schemeComponents = [];
  let thresholds = [];
  if (schemeIds.length) {
    const [schemeComponentsRaw] = (await db.query(
      'SELECT id, scheme_id, component_key, label, maximum_score FROM alamatak_grading_components WHERE scheme_id IN (?) ORDER BY id',
      [schemeIds]
    )) || [];
    schemeComponents = schemeComponentsRaw || [];
    const schemeCompIds = schemeComponents.map((c) => c.id);
    if (schemeCompIds.length) {
      const [thresholdsRaw] = (await db.query(
        'SELECT id, grading_component_id, grade_label, minimum_score FROM alamatak_grade_thresholds WHERE grading_component_id IN (?) ORDER BY id',
        [schemeCompIds]
      )) || [];
      thresholds = thresholdsRaw || [];
    }
  }

  const [finalConfigsRaw] = (await db.query(
    'SELECT id, gradebook_id, scheme_id, status, finalized_by, finalized_at, created_at, updated_at FROM alamatak_final_grade_configs WHERE gradebook_id = ?',
    [gradebookId]
  )) || [];
  const finalConfigs = finalConfigsRaw || [];

  let finalCategories = [];
  let finalItems = [];
  if (finalConfigs.length) {
    const configIds = finalConfigs.map((c) => c.id);
    const [categoriesRaw] = (await db.query(
      'SELECT id, config_id, name, weight, calculation_method, sort_order FROM alamatak_final_grade_categories WHERE config_id IN (?) ORDER BY sort_order, id',
      [configIds]
    )) || [];
    finalCategories = categoriesRaw || [];
    const categoryIds = finalCategories.map((cat) => cat.id);
    if (categoryIds.length) {
      const [itemsRaw] = (await db.query(
        'SELECT id, category_id, assessment_id, component_id, weight FROM alamatak_final_grade_items WHERE category_id IN (?) ORDER BY id',
        [categoryIds]
      )) || [];
      finalItems = itemsRaw || [];
    }
  }

  const [analyticsRowsRaw] = (await db.query(
    'SELECT id, gradebook_id, low_average_threshold, missing_assessments_threshold, completion_threshold, decline_threshold, created_at, updated_at FROM alamatak_analytics_settings WHERE gradebook_id = ?',
    [gradebookId]
  )) || [];
  const analyticsRows = analyticsRowsRaw || [];

  const [importsRaw] = (await db.query(
    'SELECT id, gradebook_id, uploaded_by, original_filename, academic_year, detected_class, detected_subject, workbook_type, metadata, source_fingerprint, status, completed_at, rolled_back_at, created_at FROM alamatak_imports WHERE gradebook_id = ? ORDER BY id',
    [gradebookId]
  )) || [];
  const imports = importsRaw || [];

  const importIds = imports.map((i) => i.id);
  let importSheets = [];
  if (importIds.length) {
    const [importSheetsRaw] = (await db.query(
      'SELECT id, import_id, sheet_name, visibility, classification, source_year, selected, row_count, column_count, raw_rows, diagnostics FROM alamatak_import_sheets WHERE import_id IN (?) ORDER BY id',
      [importIds]
    )) || [];
    importSheets = importSheetsRaw || [];
  }

  const [historicalRecordsRaw] = (await db.query(
    'SELECT id, gradebook_id, student_id, import_id, record_type, source_year, payload, created_at FROM alamatak_historical_records WHERE gradebook_id = ? ORDER BY id',
    [gradebookId]
  )) || [];
  const historicalRecords = historicalRecordsRaw || [];

  const timestamp = new Date().toISOString();
  const manifest = {
    backupFormatVersion: 1,
    version: 1,
    createdAt: timestamp,
    application: '3alamatak / Madrastak',
    sourceGradebook: {
      id: gradebook.id,
      title: gradebook.title,
      subject: gradebook.subject,
      academicYear: gradebook.academic_year,
      description: gradebook.description,
      status: gradebook.status,
    },
    counts: {
      students: students.length,
      student_aliases: studentAliases.length,
      assessments: assessments.length,
      assessment_components: components.length,
      marks: marks.length,
      grading_schemes: schemes.length,
      grading_components: schemeComponents.length,
      grade_thresholds: thresholds.length,
      final_grade_configs: finalConfigs.length,
      final_grade_categories: finalCategories.length,
      final_grade_items: finalItems.length,
      analytics_settings: analyticsRows.length ? 1 : 0,
      imports: imports.length,
      import_sheets: importSheets.length,
      historical_records: historicalRecords.length,
      student_merge_audits: mergeAudits.length,
    },
    sections: [
      'gradebook',
      'students',
      'student_aliases',
      'assessments',
      'components',
      'marks',
      'schemes',
      'scheme_components',
      'thresholds',
      'final_grade_configs',
      'final_grade_categories',
      'final_grade_items',
      'analytics_settings',
      'imports',
      'import_sheets',
      'historical_records',
      'student_merge_audits',
    ],
  };

  return {
    backupFormatVersion: 1,
    version: 1,
    createdAt: timestamp,
    exported_at: timestamp,
    application: '3alamatak / Madrastak',
    manifest,
    gradebook,
    students,
    student_aliases: studentAliases,
    assessments,
    components,
    assessment_components: components,
    marks,
    schemes,
    grading_schemes: schemes,
    scheme_components: schemeComponents,
    grading_components: schemeComponents,
    thresholds,
    grade_thresholds: thresholds,
    final_grade_configs: finalConfigs,
    final_grade_categories: finalCategories,
    final_grade_items: finalItems,
    analytics_settings: analyticsRows[0] || null,
    imports,
    import_sheets: importSheets,
    historical_records: historicalRecords,
    student_merge_audits: mergeAudits,
  };
}

function validateBackupPayload(payload, targetGradebook = null) {
  const errors = [];
  const warnings = [];

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      valid: false,
      errors: ['Invalid backup file: Payload must be a valid JSON object.'],
      warnings: [],
      counts: null,
    };
  }

  // Version check (must support version 1)
  const formatVersion = Number(payload.backupFormatVersion ?? payload.version);
  if (!formatVersion || formatVersion !== 1) {
    return {
      valid: false,
      errors: [
        `Unsupported backup format version (${payload.backupFormatVersion ?? payload.version ?? 'none'}). Only backupFormatVersion: 1 is supported.`,
      ],
      warnings: [],
      counts: null,
    };
  }

  if (!payload.gradebook || typeof payload.gradebook !== 'object') {
    errors.push('Backup payload is missing gradebook metadata.');
  }

  const students = normalizeEntityArray(payload.students);
  const assessments = normalizeEntityArray(payload.assessments);
  const components = normalizeEntityArray(payload.components || payload.assessment_components);
  const marks = normalizeEntityArray(payload.marks);
  const aliases = normalizeEntityArray(payload.aliases || payload.student_aliases);
  const schemes = normalizeEntityArray(payload.schemes || payload.grading_schemes);
  const schemeComponents = normalizeEntityArray(payload.scheme_components || payload.grading_components || payload.schemeComponents);
  const thresholds = normalizeEntityArray(payload.thresholds || payload.grade_thresholds);
  const finalConfigs = normalizeEntityArray(payload.final_grade_configs || payload.finalGradeConfigs);
  const finalCategories = normalizeEntityArray(payload.final_grade_categories || payload.finalGradeCategories);
  const finalItems = normalizeEntityArray(payload.final_grade_items || payload.finalGradeItems);
  const imports = normalizeEntityArray(payload.imports);
  const importSheets = normalizeEntityArray(payload.import_sheets || payload.importSheets);
  const historicalRecords = normalizeEntityArray(payload.historical_records || payload.historicalRecords);

  // Validate student entries
  const studentIds = new Set();
  students.forEach((student, index) => {
    if (!student || typeof student !== 'object') {
      errors.push(`Student at index ${index} is invalid.`);
      return;
    }
    const name = String(student.display_name || `${student.first_name || ''} ${student.last_name || ''}`).trim();
    if (!name) {
      errors.push(`Student at index ${index} is missing a display name.`);
    }
    if (student.id !== undefined && student.id !== null) {
      studentIds.add(student.id);
    }
  });

  // Validate assessment entries
  const assessmentIds = new Set();
  assessments.forEach((assessment, index) => {
    if (!assessment || typeof assessment !== 'object') {
      errors.push(`Assessment at index ${index} is invalid.`);
      return;
    }
    if (!assessment.title || typeof assessment.title !== 'string' || !assessment.title.trim()) {
      errors.push(`Assessment at index ${index} is missing a title.`);
    }
    if (assessment.id !== undefined && assessment.id !== null) {
      assessmentIds.add(assessment.id);
    }
  });

  // Validate components
  const componentIds = new Set();
  components.forEach((component, index) => {
    if (!component || typeof component !== 'object') {
      errors.push(`Component at index ${index} is invalid.`);
      return;
    }
    if (!component.name || typeof component.name !== 'string' || !component.name.trim()) {
      errors.push(`Component at index ${index} is missing a name.`);
    }
    if (component.assessment_id !== undefined && component.assessment_id !== null) {
      if (!assessmentIds.has(component.assessment_id)) {
        errors.push(`Component '${component.name}' references non-existent assessment ID ${component.assessment_id}.`);
      }
    }
    if (component.id !== undefined && component.id !== null) {
      componentIds.add(component.id);
    }
  });

  // Validate marks
  marks.forEach((mark, index) => {
    if (!mark || typeof mark !== 'object') {
      errors.push(`Mark at index ${index} is invalid.`);
      return;
    }
    if (mark.student_id !== undefined && mark.student_id !== null) {
      if (!studentIds.has(mark.student_id)) {
        errors.push(`Mark at index ${index} references unknown student ID ${mark.student_id}.`);
      }
    }
    if (mark.component_id !== undefined && mark.component_id !== null) {
      if (!componentIds.has(mark.component_id)) {
        errors.push(`Mark at index ${index} references unknown component ID ${mark.component_id}.`);
      }
    }
    if (mark.score !== null && mark.score !== undefined && mark.score !== '') {
      const numScore = Number(mark.score);
      if (!Number.isFinite(numScore) || numScore < 0) {
        errors.push(`Mark at index ${index} has an impossible negative score (${mark.score}).`);
      }
    }
  });

  // Validate aliases
  aliases.forEach((alias, index) => {
    if (!alias || typeof alias !== 'object') return;
    if (alias.student_id !== undefined && alias.student_id !== null) {
      if (!studentIds.has(alias.student_id)) {
        errors.push(`Student alias '${alias.alias_name}' references unknown student ID ${alias.student_id}.`);
      }
    }
  });

  // Validate schemes
  const schemeIds = new Set();
  schemes.forEach((scheme) => {
    if (scheme?.id !== undefined && scheme?.id !== null) schemeIds.add(scheme.id);
  });

  const schemeCompIds = new Set();
  schemeComponents.forEach((sc, index) => {
    if (!sc || typeof sc !== 'object') return;
    if (sc.scheme_id !== undefined && sc.scheme_id !== null) {
      if (!schemeIds.has(sc.scheme_id)) {
        errors.push(`Grading component '${sc.component_key || sc.label}' references unknown scheme ID ${sc.scheme_id}.`);
      }
    }
    if (sc.id !== undefined && sc.id !== null) schemeCompIds.add(sc.id);
  });

  thresholds.forEach((threshold, index) => {
    if (!threshold || typeof threshold !== 'object') return;
    if (threshold.grading_component_id !== undefined && threshold.grading_component_id !== null) {
      if (!schemeCompIds.has(threshold.grading_component_id)) {
        errors.push(`Grade threshold '${threshold.grade_label}' references unknown grading component ID ${threshold.grading_component_id}.`);
      }
    }
  });

  // Validate final grade configs
  const configIds = new Set();
  finalConfigs.forEach((cfg) => {
    if (cfg?.id !== undefined && cfg?.id !== null) configIds.add(cfg.id);
    if (cfg?.scheme_id && !schemeIds.has(cfg.scheme_id)) {
      errors.push(`Final grade configuration references unknown scheme ID ${cfg.scheme_id}.`);
    }
  });

  const categoryIds = new Set();
  finalCategories.forEach((cat) => {
    if (cat?.config_id && !configIds.has(cat.config_id)) {
      errors.push(`Final grade category '${cat.name}' references unknown config ID ${cat.config_id}.`);
    }
    if (cat?.id !== undefined && cat?.id !== null) categoryIds.add(cat.id);
  });

  finalItems.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    if (item.category_id && !categoryIds.has(item.category_id)) {
      errors.push(`Final grade item at index ${index} references unknown category ID ${item.category_id}.`);
    }
    if (item.assessment_id && !assessmentIds.has(item.assessment_id)) {
      errors.push(`Final grade item at index ${index} references unknown assessment ID ${item.assessment_id}.`);
    }
    if (item.component_id && !componentIds.has(item.component_id)) {
      errors.push(`Final grade item at index ${index} references unknown component ID ${item.component_id}.`);
    }
  });

  // Validate imports
  const importIds = new Set();
  imports.forEach((imp) => {
    if (imp?.id !== undefined && imp?.id !== null) importIds.add(imp.id);
  });

  importSheets.forEach((sheet, index) => {
    if (!sheet || typeof sheet !== 'object') return;
    if (sheet.import_id && !importIds.has(sheet.import_id)) {
      errors.push(`Import sheet '${sheet.sheet_name}' references unknown import ID ${sheet.import_id}.`);
    }
  });

  // Historical records
  historicalRecords.forEach((h, index) => {
    if (!h || typeof h !== 'object') return;
    if (h.student_id && !studentIds.has(h.student_id)) {
      errors.push(`Historical record at index ${index} references unknown student ID ${h.student_id}.`);
    }
    if (h.import_id && !importIds.has(h.import_id)) {
      errors.push(`Historical record at index ${index} references unknown import ID ${h.import_id}.`);
    }
  });

  if (errors.length) {
    return {
      valid: false,
      errors,
      warnings,
      counts: null,
    };
  }

  // Target Gradebook Context Warnings
  if (targetGradebook) {
    if (payload.gradebook?.academic_year && targetGradebook.academic_year && payload.gradebook.academic_year !== targetGradebook.academic_year) {
      warnings.push(
        `Academic year mismatch: Backup is for '${payload.gradebook.academic_year}', but target gradebook is '${targetGradebook.academic_year}'.`
      );
    }
    if (payload.gradebook?.title && targetGradebook.title && payload.gradebook.title !== targetGradebook.title) {
      warnings.push(
        `Title difference: Backup is from '${payload.gradebook.title}', target is '${targetGradebook.title}'.`
      );
    }
    warnings.push('This restore will completely replace all existing students, assessments, marks, schemes, and configurations in the target gradebook.');
  }

  const counts = {
    students: students.length,
    student_aliases: aliases.length,
    assessments: assessments.length,
    assessment_components: components.length,
    marks: marks.length,
    grading_schemes: schemes.length,
    grading_components: schemeComponents.length,
    grade_thresholds: thresholds.length,
    final_grade_configs: finalConfigs.length,
    final_grade_categories: finalCategories.length,
    final_grade_items: finalItems.length,
    analytics_settings: payload.analytics_settings ? 1 : 0,
    imports: imports.length,
    import_sheets: importSheets.length,
    historical_records: historicalRecords.length,
  };

  const comparison = {
    current: targetGradebook ? {
      students: targetGradebook.student_count ?? 0,
      assessments: targetGradebook.assessment_count ?? 0,
      marks: targetGradebook.mark_count ?? 0,
      schemes: targetGradebook.scheme_count ?? 0,
      finalGradeConfig: targetGradebook.has_final_grade_config ?? false,
      historicalRecords: targetGradebook.historical_count ?? 0,
    } : null,
    incoming: {
      students: students.length,
      assessments: assessments.length,
      marks: marks.length,
      schemes: schemes.length,
      finalGradeConfig: finalConfigs.length > 0,
      historicalRecords: historicalRecords.length,
    },
  };

  return {
    valid: true,
    backupFormatVersion: payload.backupFormatVersion || 1,
    format: 'json',
    errors: [],
    warnings,
    counts,
    comparison,
    manifest: payload.manifest || null,
    preview: {
      gradebook: payload.manifest?.sourceGradebook || payload.gradebook || null,
      manifest: payload.manifest || counts,
      exported_at: payload.exported_at || payload.createdAt || null,
    },
    sourceGradebook: payload.manifest?.sourceGradebook || payload.gradebook || null,
  };
}

async function createRecoveryCheckpoint(connection, gradebookId, userId, reason = 'pre_restore', description = 'Automatic snapshot created before backup restore') {
  const snapshot = await buildGradebookBackupSnapshot(connection, gradebookId);
  if (!snapshot) return null;

  const [result] = await connection.query(
    `INSERT INTO alamatak_checkpoints
     (gradebook_id, created_by, reason, description, manifest, snapshot)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      gradebookId,
      userId,
      reason,
      description,
      JSON.stringify(snapshot.manifest),
      JSON.stringify(snapshot),
    ]
  );

  // Retain the last 10 checkpoints per gradebook
  const [allCheckpoints] = await connection.query(
    'SELECT id FROM alamatak_checkpoints WHERE gradebook_id = ? ORDER BY created_at DESC, id DESC',
    [gradebookId]
  );
  if (allCheckpoints.length > 10) {
    const idsToDelete = allCheckpoints.slice(10).map((c) => c.id);
    await connection.query(
      'DELETE FROM alamatak_checkpoints WHERE id IN (?)',
      [idsToDelete]
    );
  }

  return {
    id: result.insertId,
    checkpointId: result.insertId,
    createdAt: snapshot.createdAt || snapshot.exported_at || new Date().toISOString(),
    manifest: snapshot.manifest,
  };
}

async function executeReplaceRestore(connection, targetGradebookId, backupPayload, userId) {
  let shouldManageTransaction = false;
  if (typeof connection.beginTransaction === 'function' && !connection.inTransaction) {
    shouldManageTransaction = true;
    await connection.beginTransaction();
  }

  try {
    // 1. Validate payload
    const validation = validateBackupPayload(backupPayload);
    if (!validation.valid) {
      throw new Error(`Invalid backup data: ${validation.errors.join('; ')}`);
    }

    // 2. Clear out target gradebook's existing dependent data (in foreign-key safe order)
    // Deleting from students cascades to marks, student_aliases, and student_merge_audits
    await connection.query('DELETE FROM alamatak_students WHERE gradebook_id = ?', [targetGradebookId]);
    // Deleting from assessments cascades to components, marks, final_grade_items
    await connection.query('DELETE FROM alamatak_assessments WHERE gradebook_id = ?', [targetGradebookId]);
    // Deleting from schemes cascades to components, thresholds, final_grade_configs
    await connection.query('DELETE FROM alamatak_grading_schemes WHERE gradebook_id = ?', [targetGradebookId]);
    await connection.query('DELETE FROM alamatak_final_grade_configs WHERE gradebook_id = ?', [targetGradebookId]);
    await connection.query('DELETE FROM alamatak_analytics_settings WHERE gradebook_id = ?', [targetGradebookId]);
    // Deleting from imports cascades to import_sheets, historical_records
    await connection.query('DELETE FROM alamatak_imports WHERE gradebook_id = ?', [targetGradebookId]);
    await connection.query('DELETE FROM alamatak_historical_records WHERE gradebook_id = ?', [targetGradebookId]);

    // 3. ID Remapping Maps
    const studentIdMap = new Map(); // oldStudentId -> newStudentId
    const importIdMap = new Map();   // oldImportId -> newImportId
    const schemeIdMap = new Map();   // oldSchemeId -> newSchemeId
    const schemeCompIdMap = new Map(); // oldSchemeCompId -> newSchemeCompId
    const assessmentIdMap = new Map(); // oldAssessmentId -> newAssessmentId
    const compIdMap = new Map();     // oldCompId -> newCompId
    const configIdMap = new Map();   // oldConfigId -> newConfigId
    const categoryIdMap = new Map(); // oldCategoryId -> newCategoryId

    // 4. Remap & Insert Students
    const students = normalizeEntityArray(backupPayload.students);
    for (const student of students) {
      const [res] = await connection.query(
        `INSERT INTO alamatak_students
         (gradebook_id, linked_user_id, external_student_id, first_name, last_name, display_name, email, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          targetGradebookId,
          student.linked_user_id || null,
          student.external_student_id ? String(student.external_student_id).trim() : null,
          String(student.first_name || '').trim(),
          String(student.last_name || '').trim(),
          String(student.display_name || '').trim(),
          student.email ? String(student.email).trim() : null,
          student.status || 'active',
          student.notes || null,
        ]
      );
      if (student.id !== undefined && student.id !== null) {
        studentIdMap.set(student.id, res.insertId);
      }
    }

    // 5. Remap & Insert Student Aliases
    const aliases = normalizeEntityArray(backupPayload.aliases || backupPayload.student_aliases);
    for (const alias of aliases) {
      const newStudentId = studentIdMap.get(alias.student_id);
      if (newStudentId) {
        await connection.query(
          `INSERT INTO alamatak_student_aliases
           (student_id, alias_name, normalized_alias, source, created_by)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE alias_name = VALUES(alias_name)`,
          [
            newStudentId,
            String(alias.alias_name || '').trim(),
            String(alias.normalized_alias || alias.alias_name || '').trim().toLowerCase(),
            alias.source || 'teacher',
            userId,
          ]
        );
      }
    }

  // 6. Remap & Insert Imports and Import Sheets
  const imports = normalizeEntityArray(backupPayload.imports);
  for (const imp of imports) {
    const [res] = await connection.query(
      `INSERT INTO alamatak_imports
       (gradebook_id, uploaded_by, original_filename, academic_year, detected_class, detected_subject, workbook_type, metadata, source_fingerprint, status, completed_at, rolled_back_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        targetGradebookId,
        userId,
        String(imp.original_filename || 'restored_import.xlsx').slice(0, 512),
        imp.academic_year || null,
        imp.detected_class || null,
        imp.detected_subject || null,
        imp.workbook_type || null,
        typeof imp.metadata === 'object' ? JSON.stringify(imp.metadata) : (imp.metadata || null),
        imp.source_fingerprint || null,
        imp.status || 'completed',
        imp.completed_at ? new Date(imp.completed_at) : new Date(),
        imp.rolled_back_at ? new Date(imp.rolled_back_at) : null,
      ]
    );
    if (imp.id !== undefined && imp.id !== null) {
      importIdMap.set(imp.id, res.insertId);
    }
  }

  const importSheets = normalizeEntityArray(backupPayload.import_sheets || backupPayload.importSheets);
  for (const sheet of importSheets) {
    const newImportId = importIdMap.get(sheet.import_id);
    if (newImportId) {
      await connection.query(
        `INSERT INTO alamatak_import_sheets
         (import_id, sheet_name, visibility, classification, source_year, selected, row_count, column_count, raw_rows, diagnostics)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newImportId,
          String(sheet.sheet_name || 'Sheet').slice(0, 255),
          sheet.visibility || 'visible',
          sheet.classification || 'reference',
          sheet.source_year || null,
          Boolean(sheet.selected),
          Number(sheet.row_count || 0),
          Number(sheet.column_count || 0),
          typeof sheet.raw_rows === 'object' ? JSON.stringify(sheet.raw_rows) : (sheet.raw_rows || null),
          typeof sheet.diagnostics === 'object' ? JSON.stringify(sheet.diagnostics) : (sheet.diagnostics || null),
        ]
      );
    }
  }

  // 7. Remap & Insert Grading Schemes, Components, and Thresholds
  const schemes = normalizeEntityArray(backupPayload.schemes || backupPayload.grading_schemes);
  for (const scheme of schemes) {
    const newImportId = scheme.source_import_id ? importIdMap.get(scheme.source_import_id) : null;
    const [res] = await connection.query(
      `INSERT INTO alamatak_grading_schemes
       (gradebook_id, name, source_import_id, is_fallback)
       VALUES (?, ?, ?, ?)`,
      [
        targetGradebookId,
        String(scheme.name || 'Standard').trim(),
        newImportId || null,
        Boolean(scheme.is_fallback),
      ]
    );
    if (scheme.id !== undefined && scheme.id !== null) {
      schemeIdMap.set(scheme.id, res.insertId);
    }
  }

  const schemeComponents = normalizeEntityArray(backupPayload.scheme_components || backupPayload.grading_components || backupPayload.schemeComponents);
  for (const sc of schemeComponents) {
    const newSchemeId = schemeIdMap.get(sc.scheme_id);
    if (newSchemeId) {
      const [res] = await connection.query(
        `INSERT INTO alamatak_grading_components
         (scheme_id, component_key, label, maximum_score)
         VALUES (?, ?, ?, ?)`,
        [
          newSchemeId,
          String(sc.component_key || sc.label || 'comp').trim(),
          String(sc.label || sc.component_key || 'Component').trim(),
          sc.maximum_score !== null && sc.maximum_score !== undefined ? Number(sc.maximum_score) : null,
        ]
      );
      if (sc.id !== undefined && sc.id !== null) {
        schemeCompIdMap.set(sc.id, res.insertId);
      }
    }
  }

  const thresholds = normalizeEntityArray(backupPayload.thresholds || backupPayload.grade_thresholds);
  for (const threshold of thresholds) {
    const newSchemeCompId = schemeCompIdMap.get(threshold.grading_component_id);
    if (newSchemeCompId) {
      await connection.query(
        `INSERT INTO alamatak_grade_thresholds
         (grading_component_id, grade_label, minimum_score)
         VALUES (?, ?, ?)`,
        [
          newSchemeCompId,
          String(threshold.grade_label || '').trim(),
          Number(threshold.minimum_score || 0),
        ]
      );
    }
  }

  // 8. Remap & Insert Assessments and Components
  const assessments = normalizeEntityArray(backupPayload.assessments);
  for (const assessment of assessments) {
    const newImportId = assessment.source_import_id ? importIdMap.get(assessment.source_import_id) : null;
    const [res] = await connection.query(
      `INSERT INTO alamatak_assessments
       (gradebook_id, title, strand, topic, assessment_date, source_import_id, is_historical, source_year)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        targetGradebookId,
        String(assessment.title || 'Assessment').trim(),
        assessment.strand || null,
        assessment.topic || null,
        assessment.assessment_date ? new Date(assessment.assessment_date) : null,
        newImportId || null,
        Boolean(assessment.is_historical),
        assessment.source_year || null,
      ]
    );
    if (assessment.id !== undefined && assessment.id !== null) {
      assessmentIdMap.set(assessment.id, res.insertId);
    }
  }

  const components = normalizeEntityArray(backupPayload.components || backupPayload.assessment_components);
  for (const component of components) {
    const newAssessmentId = assessmentIdMap.get(component.assessment_id);
    if (newAssessmentId) {
      const [res] = await connection.query(
        `INSERT INTO alamatak_assessment_components
         (assessment_id, name, maximum_score, sort_order)
         VALUES (?, ?, ?, ?)`,
        [
          newAssessmentId,
          String(component.name || 'Component').trim(),
          Number(component.maximum_score || 0),
          Number(component.sort_order || 0),
        ]
      );
      if (component.id !== undefined && component.id !== null) {
        compIdMap.set(component.id, res.insertId);
      }
    }
  }

  // 9. Remap & Insert Marks
  const marks = normalizeEntityArray(backupPayload.marks);
  for (const mark of marks) {
    const newCompId = compIdMap.get(mark.component_id);
    const newStudentId = studentIdMap.get(mark.student_id);
    if (newCompId && newStudentId) {
      const score = mark.score !== null && mark.score !== undefined && mark.score !== '' ? Number(mark.score) : null;
      await connection.query(
        `INSERT INTO alamatak_marks
         (component_id, student_id, score, mark_status, comment, follow_up_required, provenance)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          newCompId,
          newStudentId,
          score,
          mark.mark_status || null,
          mark.comment || null,
          Boolean(mark.follow_up_required),
          typeof mark.provenance === 'object' ? JSON.stringify(mark.provenance) : (mark.provenance || null),
        ]
      );
    }
  }

  // 10. Remap & Insert Historical Records
  const historicalRecords = normalizeEntityArray(backupPayload.historical_records || backupPayload.historicalRecords);
  for (const record of historicalRecords) {
    const newStudentId = record.student_id ? studentIdMap.get(record.student_id) : null;
    const newImportId = record.import_id ? importIdMap.get(record.import_id) : null;
    await connection.query(
      `INSERT INTO alamatak_historical_records
       (gradebook_id, student_id, import_id, record_type, source_year, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        targetGradebookId,
        newStudentId || null,
        newImportId || null,
        String(record.record_type || 'historical'),
        String(record.source_year || 'unknown'),
        typeof record.payload === 'object' ? JSON.stringify(record.payload) : (record.payload || '{}'),
      ]
    );
  }

  // 11. Remap & Insert Final Grade Configurations, Categories, and Items
  const finalConfigs = normalizeEntityArray(backupPayload.final_grade_configs || backupPayload.finalGradeConfigs);
  for (const cfg of finalConfigs) {
    const newSchemeId = cfg.scheme_id ? schemeIdMap.get(cfg.scheme_id) : null;
    const [res] = await connection.query(
      `INSERT INTO alamatak_final_grade_configs
       (gradebook_id, scheme_id, status, finalized_by, finalized_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        targetGradebookId,
        newSchemeId || null,
        cfg.status || 'draft',
        cfg.finalized_by ? userId : null,
        cfg.finalized_at ? new Date(cfg.finalized_at) : null,
      ]
    );
    if (cfg.id !== undefined && cfg.id !== null) {
      configIdMap.set(cfg.id, res.insertId);
    }
  }

  const finalCategories = normalizeEntityArray(backupPayload.final_grade_categories || backupPayload.finalGradeCategories);
  for (const cat of finalCategories) {
    const newConfigId = configIdMap.get(cat.config_id);
    if (newConfigId) {
      const [res] = await connection.query(
        `INSERT INTO alamatak_final_grade_categories
         (config_id, name, weight, calculation_method, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [
          newConfigId,
          String(cat.name || 'Category').trim(),
          Number(cat.weight || 0),
          cat.calculation_method || 'weighted_average',
          Number(cat.sort_order || 0),
        ]
      );
      if (cat.id !== undefined && cat.id !== null) {
        categoryIdMap.set(cat.id, res.insertId);
      }
    }
  }

  const finalItems = normalizeEntityArray(backupPayload.final_grade_items || backupPayload.finalGradeItems);
  for (const item of finalItems) {
    const newCategoryId = categoryIdMap.get(item.category_id);
    const newAssessmentId = assessmentIdMap.get(item.assessment_id);
    const newCompId = compIdMap.get(item.component_id);
    if (newCategoryId && newAssessmentId && newCompId) {
      await connection.query(
        `INSERT INTO alamatak_final_grade_items
         (category_id, assessment_id, component_id, weight)
         VALUES (?, ?, ?, ?)`,
        [
          newCategoryId,
          newAssessmentId,
          newCompId,
          Number(item.weight || 1),
        ]
      );
    }
  }

  // 12. Analytics Settings
  const analyticsPayload = Array.isArray(backupPayload.analytics_settings)
    ? backupPayload.analytics_settings[0]
    : (backupPayload.analytics_settings || backupPayload.analyticsSettings);

  if (analyticsPayload && typeof analyticsPayload === 'object') {
    const an = analyticsPayload;
    await connection.query(
      `INSERT INTO alamatak_analytics_settings
       (gradebook_id, low_average_threshold, missing_assessments_threshold, completion_threshold, decline_threshold)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         low_average_threshold = VALUES(low_average_threshold),
         missing_assessments_threshold = VALUES(missing_assessments_threshold),
         completion_threshold = VALUES(completion_threshold),
         decline_threshold = VALUES(decline_threshold)`,
      [
        targetGradebookId,
        Number(an.low_average_threshold ?? 50),
        Number(an.missing_assessments_threshold ?? 2),
        Number(an.completion_threshold ?? 80),
        Number(an.decline_threshold ?? 5),
      ]
    );
  }

  // 13. Post-Restore Verification Assertions
  const [actualStudentsRaw] = await connection.query('SELECT COUNT(*) AS count FROM alamatak_students WHERE gradebook_id = ?', [targetGradebookId]);
  const [actualAssessmentsRaw] = await connection.query('SELECT COUNT(*) AS count FROM alamatak_assessments WHERE gradebook_id = ?', [targetGradebookId]);
  const [actualMarksRaw] = await connection.query('SELECT COUNT(*) AS count FROM alamatak_marks m JOIN alamatak_students s ON s.id = m.student_id WHERE s.gradebook_id = ?', [targetGradebookId]);
  const [actualSchemesRaw] = await connection.query('SELECT COUNT(*) AS count FROM alamatak_grading_schemes WHERE gradebook_id = ?', [targetGradebookId]);

  const actualStudents = actualStudentsRaw || [];
  const actualAssessments = actualAssessmentsRaw || [];
  const actualMarks = actualMarksRaw || [];
  const actualSchemes = actualSchemesRaw || [];

  const studentCount = Number(actualStudents[0]?.count ?? actualStudents[0]?.['COUNT(*)'] ?? students.length);
  const assessmentCount = Number(actualAssessments[0]?.count ?? actualAssessments[0]?.['COUNT(*)'] ?? assessments.length);
  const markCount = Number(actualMarks[0]?.count ?? actualMarks[0]?.['COUNT(*)'] ?? marks.length);
  const schemeCount = Number(actualSchemes[0]?.count ?? actualSchemes[0]?.['COUNT(*)'] ?? schemes.length);

  if (actualStudents.length && actualStudents[0]?.count !== undefined && studentCount !== students.length) {
    throw new Error(`Restore verification failed: Expected ${students.length} students, but restored ${studentCount}.`);
  }
  if (actualAssessments.length && actualAssessments[0]?.count !== undefined && assessmentCount !== assessments.length) {
    throw new Error(`Restore verification failed: Expected ${assessments.length} assessments, but restored ${assessmentCount}.`);
  }
  if (actualMarks.length && actualMarks[0]?.count !== undefined && markCount !== marks.length) {
    throw new Error(`Restore verification failed: Expected ${marks.length} marks, but restored ${markCount}.`);
  }
  if (actualSchemes.length && actualSchemes[0]?.count !== undefined && schemeCount !== schemes.length) {
    throw new Error(`Restore verification failed: Expected ${schemes.length} schemes, but restored ${schemeCount}.`);
  }

  if (shouldManageTransaction) {
    await connection.commit();
  }

  return {
    success: true,
    restored: {
      students: studentCount,
      assessments: assessmentCount,
      marks: markCount,
      schemes: schemeCount,
      components: components.length,
      aliases: aliases.length,
      finalGradeCategories: finalCategories.length,
      historicalRecords: historicalRecords.length,
    },
    restoredCounts: {
      students: studentCount,
      assessments: assessmentCount,
      marks: markCount,
      schemes: schemeCount,
      components: components.length,
      aliases: aliases.length,
      final_grade_configs: finalConfigs.length,
      final_grade_categories: finalCategories.length,
      final_grade_items: finalItems.length,
      historical_records: historicalRecords.length,
    },
  };
} catch (restoreErr) {
  if (shouldManageTransaction) {
    await connection.rollback();
  }
  throw restoreErr;
}
}

async function rollbackImportBatch(connection, gradebookId, importId) {
  let shouldManageTransaction = false;
  if (typeof connection.beginTransaction === 'function' && !connection.inTransaction) {
    shouldManageTransaction = true;
    await connection.beginTransaction();
  }
  try {
    await connection.query(
      `DELETE m FROM alamatak_marks m
       JOIN alamatak_assessments a ON a.id = m.assessment_id
       WHERE a.gradebook_id = ? AND a.source_import_id = ?`,
      [gradebookId, importId]
    );

    await connection.query(
      `DELETE c FROM alamatak_assessment_components c
       JOIN alamatak_assessments a ON a.id = c.assessment_id
       WHERE a.gradebook_id = ? AND a.source_import_id = ?`,
      [gradebookId, importId]
    );

    await connection.query(
      'DELETE FROM alamatak_assessments WHERE gradebook_id = ? AND source_import_id = ?',
      [gradebookId, importId]
    );

    await connection.query(
      'DELETE FROM alamatak_historical_records WHERE gradebook_id = ? AND import_id = ?',
      [gradebookId, importId]
    );

    await connection.query(
      'UPDATE alamatak_imports SET status = ?, rolled_back_at = NOW() WHERE id = ? AND gradebook_id = ?',
      ['rolled_back', importId, gradebookId]
    );

    if (shouldManageTransaction) {
      await connection.commit();
    }

    return {
      success: true,
      rolledBackImportId: importId,
    };
  } catch (err) {
    if (shouldManageTransaction) {
      await connection.rollback();
    }
    throw err;
  }
}

module.exports = {
  buildGradebookBackupSnapshot,
  validateBackupPayload,
  createRecoveryCheckpoint,
  executeReplaceRestore,
  rollbackImportBatch,
};
