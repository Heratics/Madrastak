import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessmentState,
  computeFinalGrade,
  gradeFor,
  studentAverage,
} from './gradeCalculations.js';
import {
  findConfidentNameMatch,
  importedNameScore,
  matchImportedRoster,
  normalizeImportedName,
} from './rosterMatching.js';
import {
  buildWorkbookImportPackage,
  classifyWorksheet,
  exportGradebookToHtml,
  exportGradebookToXml,
  extractAssessmentBlocks,
  parseBehaviorRecords,
  parseDelimited,
  parseGradebookHtml,
  parseGradebookXml,
  parseGradeThresholdSheet,
  parseSubmissionTracker,
  parseTeamProjectsSheet,
  readXlsxWorkbook,
} from './workbookParser.js';
import { validateAssessmentInput, validateGradebookInput, validateStudentInput } from './validation.js';

test('grade calculations preserve completion and partial states', () => {
  const assessment = {
    components: [{ id: 'q1', max: 20 }, { id: 'q2', max: 30 }],
    marks: { student: { q1: 10 } },
    statuses: {},
  };
  assert.equal(assessmentState(assessment, 'student').state, 'Partial');
  assert.equal(assessmentState(assessment, 'student').percent, 20);
  assert.equal(studentAverage([assessment], 'student'), 20);
  assert.equal(gradeFor(85), 'A');
});

test('final grades use component thresholds and report missing components', () => {
  const scheme = {
    grades: ['A', 'B', 'U'],
    componentOrder: ['Coursework', 'Presentation', 'AX'],
    maximums: { Coursework: 100, Presentation: 100, AX: 100 },
    components: {
      Coursework: { thresholds: { A: 80, B: 60, U: 0 } },
      Presentation: { thresholds: { A: 80, B: 60, U: 0 } },
      AX: { thresholds: { A: 80, B: 60, U: 0 } },
    },
  };
  const result = computeFinalGrade({
    studentId: 'student',
    scheme,
    selectedItems: [{ assessmentId: 'assessment', componentKey: 'Coursework' }],
    assessments: [{
      id: 'assessment',
      components: [{ id: 'total', max: 100 }],
      marks: { student: { total: 85 } },
      statuses: {},
    }],
  });
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.requiredMissing, ['Presentation']);
});

test('roster matching is conservative about ambiguity', () => {
  assert.equal(normalizeImportedName("O'Sama Al-Hadad"), 'osama alhadad');
  assert.ok(importedNameScore('Mohammad Saleh', 'Mohd Saleh') > 0.9);
  const exact = findConfidentNameMatch([{ id: '1', name: 'Aisha Noor' }], 'Aisha Noor');
  assert.equal(exact.mode, 'exact');
  const ambiguous = findConfidentNameMatch([{ id: '1', name: 'Aisha Noor' }, { id: '2', name: 'Aisha Noor' }], 'Aisha Noor');
  assert.equal(ambiguous.mode, 'ambiguous-exact');
});

test('matchImportedRoster accurately classifies exact, fuzzy, ambiguous, and new students', () => {
  const existing = [
    { id: 101, display_name: 'Ahmad Shara', external_student_id: 'STU-101' },
    { id: 102, display_name: 'Mohammad Saleh', external_student_id: 'STU-102' },
    { id: 103, display_name: 'Sara Qasim', external_student_id: 'STU-103' },
    { id: 104, display_name: 'Sara Qasem', external_student_id: 'STU-104' },
  ];

  const imported = [
    { key: 'Ahmad Shara', display_name: 'Ahmad Shara', external_student_id: 'STU-101' }, // Exact by ID and name
    { key: 'Mohd Saleh', display_name: 'Mohd Saleh' }, // High-confidence fuzzy
    { key: 'Sara Qasim', display_name: 'Sara Qasym' }, // Ambiguous between 103 and 104
    { key: 'Zaid Tareq', display_name: 'Zaid Tareq' }, // Brand new student
  ];

  const matched = matchImportedRoster(existing, imported);
  assert.equal(matched[0].status, 'exact');
  assert.equal(matched[0].matchedStudent.id, 101);

  assert.equal(matched[1].status, 'fuzzy');
  assert.equal(matched[1].matchedStudent.id, 102);

  assert.equal(matched[2].status, 'ambiguous');
  assert.ok(matched[2].candidates.length >= 2);

  assert.equal(matched[3].status, 'unmatched');
  assert.equal(matched[3].resolution, 'new');
});

test('XML export and restore preserve full gradebook data', () => {
  const sampleData = {
    gradebook: { id: 1, title: 'Year 10 ESL', academic_year: '2025-2026', subject: 'ESL' },
    students: [{ id: 1, display_name: 'Ahmad Noor', external_student_id: 'S1', status: 'active' }],
    assessments: [{ id: 10, title: 'Midterm Writing', strand: 'Writing', assessment_date: '2026-03-15' }],
    marks: [{ component_id: 101, student_id: 1, score: 95 }],
  };

  const xml = exportGradebookToXml(sampleData);
  assert.ok(xml.includes('<?xml version="1.0"'));
  assert.ok(xml.includes('<threealamatak'));
  assert.ok(xml.includes('Year 10 ESL'));

  const restored = parseGradebookXml(xml);
  assert.equal(restored.gradebook.title, 'Year 10 ESL');
  assert.equal(restored.students[0].display_name, 'Ahmad Noor');
  assert.equal(restored.assessments[0].title, 'Midterm Writing');
  assert.equal(restored.marks[0].score, 95);
});

test('Self-contained HTML export and restore preserve full gradebook data', () => {
  const sampleData = {
    gradebook: { id: 2, title: 'IGCSE Physics', academic_year: '2025-2026', subject: 'Physics' },
    students: [{ id: 5, display_name: 'Zaid Omar', external_student_id: 'P5', status: 'active' }],
    assessments: [{ id: 20, title: 'Paper 4 Theory', strand: 'Theory', assessment_date: '2026-05-10' }],
    marks: [{ component_id: 201, student_id: 5, score: 78 }],
  };

  const html = exportGradebookToHtml(sampleData);
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('IGCSE Physics'));
  assert.ok(html.includes('window.__EMBEDDED_MARKBOOK__'));

  const restored = parseGradebookHtml(html);
  assert.equal(restored.gradebook.title, 'IGCSE Physics');
  assert.equal(restored.students[0].display_name, 'Zaid Omar');
  assert.equal(restored.assessments[0].title, 'Paper 4 Theory');
  assert.equal(restored.marks[0].score, 78);
});

test('parseGradeThresholdSheet extracts component thresholds and boundaries', () => {
  const sheet = {
    name: 'Gradethreshold',
    rows: [
      ['Component', 'A*', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'U'],
      ['Max score', '100', '80', '70', '60', '50', '40', '30', '20', '0'],
      ['Component 1', '90', '80', '70', '60', '50', '40', '30', '20', '0'],
      ['Component 2', '85', '75', '65', '55', '45', '35', '25', '15', '0'],
      ['AX (Written Exam)', '175', '155', '135', '115', '95', '75', '55', '35', '0'],
      ['Overall', '88', '78', '68', '58', '48', '38', '28', '18', '0'],
    ],
  };

  const scheme = parseGradeThresholdSheet(sheet);
  assert.ok(scheme);
  assert.equal(scheme.name, 'Gradethreshold');
  assert.ok(scheme.components['Component 1']);
  assert.equal(scheme.components['Component 1'].thresholds['A*'], 90);
  assert.equal(scheme.components['Component 1'].thresholds['A'], 80);
  assert.ok(scheme.components.AX);
  assert.equal(scheme.components.AX.thresholds['A*'], 175);
  assert.ok(scheme.components.Overall);
  assert.equal(scheme.components.Overall.thresholds['A*'], 88);
});

test('extractAssessmentBlocks extracts marks and components from worksheet', () => {
  const sheet = {
    name: 'First Sem. Marks',
    rows: [
      ['Student Name', 'ID', 'Q1 Reading', 'Q2 Writing', 'Total'],
      ['Mark', '', '25', '25', '50'],
      ['Ahmad Shara', 'STU01', '23', '20', '43'],
      ['Fatima Zahra', 'STU02', '24', 'AB', '24'],
    ],
  };

  const blocks = extractAssessmentBlocks(sheet);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].components.length, 2); // Q1 and Q2 (Total is aggregate)
  assert.equal(blocks[0].components[0].name, 'Q1 Reading');
  assert.equal(blocks[0].components[0].maximum_score, 25);

  const ahmadMarks = blocks[0].marks.filter((m) => m.display_name === 'Ahmad Shara');
  assert.equal(ahmadMarks.length, 2);
  assert.equal(ahmadMarks[0].score, 23);
  assert.equal(ahmadMarks[1].score, 20);

  const fatimaMarks = blocks[0].marks.filter((m) => m.display_name === 'Fatima Zahra');
  assert.equal(fatimaMarks.length, 2);
  assert.equal(fatimaMarks[0].score, 24);
  assert.equal(fatimaMarks[1].mark_status, 'AB');
});

test('parseBehaviorRecords extracts conduct entries', () => {
  const sheet = {
    name: 'Conduct',
    rows: [
      ['Class 9A Conduct'],
      ['Student Name', '2026-02-01', '2026-02-15'],
      ['Header spacer'],
      ['Ahmad Shara', 'Participated actively', 'Disrupted class conversation'],
    ],
  };

  const records = parseBehaviorRecords(sheet);
  assert.equal(records.length, 2);
  assert.equal(records[0].record_type, 'behavior');
  assert.equal(records[0].payload.student_name, 'Ahmad Shara');
  assert.equal(records[0].payload.note, 'Participated actively');
  assert.equal(records[1].payload.note, 'Disrupted class conversation');
});

test('parseSubmissionTracker extracts assignment submission statuses', () => {
  const sheet = {
    name: 'IR Submission',
    rows: [
      ['Task', 'Due Date', 'Ahmad Shara', 'Fatima Zahra'],
      ['Header row'],
      ['Topic Selection', '2026-01-15', 'Submitted', 'Pending'],
      ['Draft Outline', '2026-02-01', 'Submitted', 'Late'],
    ],
  };

  const tasks = parseSubmissionTracker(sheet);
  assert.equal(tasks.length, 4);
  assert.equal(tasks[0].record_type, 'assignment');
  assert.equal(tasks[0].payload.title, 'Topic Selection');
  assert.equal(tasks[0].payload.status, 'Submitted');
  assert.equal(tasks[1].payload.status, 'Pending');
});

test('parseTeamProjectsSheet extracts team assignments and topics', () => {
  const sheet = {
    name: 'List of Teams',
    rows: [
      ['Team', 'Topic', 'Members', 'Leader', 'Action Plan', 'Progress'],
      ['1', 'Renewable Energy in Jordan', 'Ahmad Shara', '', 'Phase 1 Research', 'On track'],
      ['', '', 'Zaid Tareq', '', '', ''],
      ['2', 'Water Conservation', 'Sara Qasim', '', 'Phase 1 Survey', 'Needs follow-up'],
    ],
  };

  const projects = parseTeamProjectsSheet(sheet);
  assert.equal(projects.length, 3);
  assert.equal(projects[0].record_type, 'team_project');
  assert.equal(projects[0].payload.team_number, '1');
  assert.equal(projects[0].payload.topic, 'Renewable Energy in Jordan');
  assert.equal(projects[0].payload.student_name, 'Ahmad Shara');
  assert.equal(projects[1].payload.student_name, 'Zaid Tareq');
  assert.equal(projects[2].payload.student_name, 'Sara Qasim');
});

test('buildWorkbookImportPackage ties all sheets into complete import package', () => {
  const sheets = [
    {
      name: 'Gradethreshold',
      rows: [
        ['Component', 'A*', 'A', 'B', 'U'],
        ['Max', '100', '80', '60', '0'],
        ['Overall', '90', '80', '60', '0'],
      ],
    },
    {
      name: 'Sheet1',
      rows: [
        ['Student Name', 'ID', 'Email'],
        ['Ahmad Shara', 'STU-1', 'ahmad@example.com'],
        ['Fatima Zahra', 'STU-2', 'fatima@example.com'],
      ],
    },
    {
      name: 'First Sem. Marks',
      rows: [
        ['Student Name', 'ID', 'Quiz 1'],
        ['Mark', '', '20'],
        ['Ahmad Shara', 'STU-1', '18'],
        ['Fatima Zahra', 'STU-2', '19'],
      ],
    },
  ];

  const pkg = buildWorkbookImportPackage(sheets, 'Grade9.xlsx', { academicYear: '2025-2026' });
  assert.equal(pkg.original_filename, 'Grade9.xlsx');
  assert.equal(pkg.summary.studentsCount, 2);
  assert.equal(pkg.summary.schemesCount, 1);
  assert.equal(pkg.summary.assessmentsCount, 1);
  assert.equal(pkg.schemes[0].name, 'Gradethreshold');
  assert.equal(pkg.assessments[0].marks.length, 2);
});

test('input validation rejects incomplete records', () => {
  assert.equal(validateGradebookInput({ title: '', academic_year: '2026-2027' }).valid, false);
  assert.equal(validateStudentInput({ first_name: 'Aisha', last_name: 'Noor' }).value.display_name, 'Aisha Noor');
  assert.equal(validateAssessmentInput({ title: 'Quiz', components: [] }).valid, false);
});

test('readXlsxWorkbook parses real 27-worksheet workbook without errors', async () => {
  const fs = await import('node:fs');
  const testFile = 'E:/Documents/DAD WORK/Manastak/GP 0457 Grade 9 2026-2027.xlsx';
  if (fs.existsSync(testFile)) {
    const buf = fs.readFileSync(testFile);
    const sheets = await readXlsxWorkbook(buf);
    assert.equal(sheets.length, 27);
    const pkg = buildWorkbookImportPackage(sheets, 'GP 0457 Grade 9 2026-2027.xlsx', { academicYear: '2026-2027' });
    assert.equal(pkg.summary.totalSheets, 27);
    assert.ok(pkg.summary.studentsCount > 0);
  }
});

