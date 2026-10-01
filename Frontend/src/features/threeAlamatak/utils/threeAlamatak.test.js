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
  normalizeImportedName,
} from './rosterMatching.js';
import { classifyWorksheet, parseDelimited } from './workbookParser.js';
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

test('import parsing and worksheet classification preserve source distinctions', () => {
  assert.deepEqual(parseDelimited('id,name\n1,"Doe, Jane"'), [['id', 'name'], ['1', 'Doe, Jane']]);
  assert.equal(classifyWorksheet({ name: 'Conduct', rows: [['Student', 'Date']] }).type, 'behavior');
  assert.equal(classifyWorksheet({ name: 'Gradethreshold', rows: [['A', 'B']] }).type, 'threshold');
  assert.equal(classifyWorksheet({ name: 'Archive 2024', rows: [['Name']] }).selected, false);
});

test('input validation rejects incomplete records', () => {
  assert.equal(validateGradebookInput({ title: '', academic_year: '2026-2027' }).valid, false);
  assert.equal(validateStudentInput({ first_name: 'Aisha', last_name: 'Noor' }).value.display_name, 'Aisha Noor');
  assert.equal(validateAssessmentInput({ title: 'Quiz', components: [] }).valid, false);
});
