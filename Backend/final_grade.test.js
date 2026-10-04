const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateFinalGrades, validateThresholdScheme } = require('./finalGradeCalculator');

const scheme = { components: { Overall: { maximum_score: 100, thresholds: { A: 80, B: 70, U: 0 } } } };
const base = {
  students: [{ id: 1, display_name: 'Aisha' }, { id: 2, display_name: 'Omar' }],
  assessments: [{ id: 10, title: '18 mark task' }, { id: 11, title: '100 mark exam' }],
  components: [{ id: 100, assessment_id: 10, name: 'Task', maximum_score: 18 }, { id: 110, assessment_id: 11, name: 'Exam', maximum_score: 100 }],
  config: { categories: [{ id: 1, name: 'Coursework', weight: 50 }, { id: 2, name: 'Exam', weight: 50 }], items: [{ category_id: 1, assessment_id: 10, component_id: 100, weight: 1 }, { category_id: 2, assessment_id: 11, component_id: 110, weight: 1 }] },
  scheme,
};

test('final grades normalize different assessment maxima and apply weights', () => {
  const result = calculateFinalGrades({ ...base, marks: [{ student_id: 1, component_id: 100, score: 18 }, { student_id: 1, component_id: 110, score: 70 }] });
  assert.equal(result.results[0].overall_percent, 85);
  assert.equal(result.results[0].final_grade, 'A');
  assert.equal(result.results[0].status, 'Ready');
});

test('missing, absent, and zero remain distinct', () => {
  const result = calculateFinalGrades({ ...base, marks: [{ student_id: 1, component_id: 100, score: 0, mark_status: null }, { student_id: 2, component_id: 100, mark_status: 'Absent' }] });
  assert.equal(result.results[0].overall_percent, null);
  assert.equal(result.results[0].status, 'Incomplete');
  assert.equal(result.results[1].status, 'Absent');
  assert.equal(result.results[0].categories[0].items[0].score, 0);
});

test('invalid weights, duplicate mappings, and invalid thresholds are rejected', () => {
  const invalid = calculateFinalGrades({ ...base, config: { categories: [{ id: 1, name: 'Only', weight: 60 }], items: [{ category_id: 1, assessment_id: 10, component_id: 100 }, { category_id: 1, assessment_id: 10, component_id: 100 }] }, scheme: { components: { Overall: { thresholds: { A: 80, B: 90 } } } }, marks: [] });
  assert.equal(invalid.readiness.valid, false);
  assert.ok(invalid.readiness.errors.some((error) => /100%/.test(error)));
  assert.ok(invalid.readiness.errors.some((error) => /not ordered/.test(error)));
  assert.ok(validateThresholdScheme({ components: { Overall: { thresholds: { A: 80, U: 0 } } } }).valid);
});
