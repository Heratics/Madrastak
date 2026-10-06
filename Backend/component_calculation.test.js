const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateComponentDefinitions,
  calculateComponentMarks,
} = require('./componentCalculation');
const { calculateFinalGrades, validateThresholdScheme } = require('./finalGradeCalculator');

test('1. Input component is valid with positive maximum score', () => {
  const comps = [
    { id: '1', name: 'Q1', maximum_score: 10, component_type: 'input' },
  ];
  const res = validateComponentDefinitions(comps);
  assert.equal(res.valid, true);
  assert.equal(res.components[0].maximum_score, 10);
  assert.equal(res.components[0].component_type, 'input');
});

test('2. Calculated component calculates sum of selected source components', () => {
  const comps = [
    { id: '1', name: 'Q1', maximum_score: 5, component_type: 'input' },
    { id: '2', name: 'Q2', maximum_score: 10, component_type: 'input' },
    { id: '3', name: 'Q3', maximum_score: 10, component_type: 'input' },
    { id: '4', name: 'Q4', maximum_score: 15, component_type: 'input' },
    { id: '5', name: 'Total', component_type: 'calculated', calculation_type: 'sum', source_component_ids: ['1', '2', '3', '4'] },
  ];
  const res = validateComponentDefinitions(comps);
  assert.equal(res.valid, true);
  const totalComp = res.components.find((c) => c.id === '5');
  assert.equal(totalComp.maximum_score, 40); // 5 + 10 + 10 + 15

  const marks = { '1': 4, '2': 8, '3': 9, '4': 12 };
  const calculated = calculateComponentMarks(comps, marks);
  assert.equal(calculated['5'].score, 33);
  assert.equal(calculated['5'].is_calculated, true);
});

test('3. Excluded component is not included in total calculation', () => {
  const comps = [
    { id: '1', name: 'Q1', maximum_score: 10, component_type: 'input' },
    { id: '2', name: 'Q2 (Bonus)', maximum_score: 5, component_type: 'input' },
    { id: '3', name: 'Q3', maximum_score: 10, component_type: 'input' },
    { id: '4', name: 'Standard Total', component_type: 'calculated', calculation_type: 'sum', source_component_ids: ['1', '3'] },
  ];
  const res = validateComponentDefinitions(comps);
  assert.equal(res.valid, true);
  const totalComp = res.components.find((c) => c.id === '4');
  assert.equal(totalComp.maximum_score, 20); // only Q1 (10) + Q3 (10)

  const marks = { '1': 9, '2': 5, '3': 8 };
  const calculated = calculateComponentMarks(comps, marks);
  assert.equal(calculated['4'].score, 17); // 9 + 8 (Q2 bonus excluded)
});

test('4. Self-reference in calculated component is rejected', () => {
  const comps = [
    { id: '1', name: 'Q1', maximum_score: 10, component_type: 'input' },
    { id: '2', name: 'Total', component_type: 'calculated', calculation_type: 'sum', source_component_ids: ['1', '2'] },
  ];
  const res = validateComponentDefinitions(comps);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes('cannot depend on itself')));
});

test('5. Circular dependency between calculated components is detected and rejected', () => {
  const comps = [
    { id: '1', name: 'A', component_type: 'calculated', source_component_ids: ['2'] },
    { id: '2', name: 'B', component_type: 'calculated', source_component_ids: ['1'] },
  ];
  const res = validateComponentDefinitions(comps);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes('Circular dependency')));
});

test('6. Missing or non-existent source component is rejected', () => {
  const comps = [
    { id: '1', name: 'Q1', maximum_score: 10, component_type: 'input' },
    { id: '2', name: 'Total', component_type: 'calculated', source_component_ids: ['999'] },
  ];
  const res = validateComponentDefinitions(comps);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes('references non-existent component')));
});

test('7. Valid zero marks contribute 0 to calculated sum without becoming null', () => {
  const comps = [
    { id: '1', name: 'Q1', maximum_score: 10, component_type: 'input' },
    { id: '2', name: 'Q2', maximum_score: 10, component_type: 'input' },
    { id: '3', name: 'Total', component_type: 'calculated', source_component_ids: ['1', '2'] },
  ];
  const marks = { '1': 0, '2': 8 };
  const calculated = calculateComponentMarks(comps, marks);
  assert.equal(calculated['3'].score, 8); // 0 + 8 = 8
});

test('8. All absent source marks produce absent calculated status', () => {
  const comps = [
    { id: '1', name: 'Q1', maximum_score: 10, component_type: 'input' },
    { id: '2', name: 'Q2', maximum_score: 10, component_type: 'input' },
    { id: '3', name: 'Total', component_type: 'calculated', source_component_ids: ['1', '2'] },
  ];
  const marks = [
    { component_id: '1', score: null, mark_status: 'absent' },
    { component_id: '2', score: null, mark_status: 'absent' },
  ];
  const calculated = calculateComponentMarks(comps, marks);
  assert.equal(calculated['3'].mark_status, 'absent');
  assert.equal(calculated['3'].score, null);
});

test('9. All exempt source marks produce exempt calculated status', () => {
  const comps = [
    { id: '1', name: 'Q1', maximum_score: 10, component_type: 'input' },
    { id: '2', name: 'Q2', maximum_score: 10, component_type: 'input' },
    { id: '3', name: 'Total', component_type: 'calculated', source_component_ids: ['1', '2'] },
  ];
  const marks = [
    { component_id: '1', score: null, mark_status: 'exempt' },
    { component_id: '2', score: null, mark_status: 'exempt' },
  ];
  const calculated = calculateComponentMarks(comps, marks);
  assert.equal(calculated['3'].mark_status, 'exempt');
  assert.equal(calculated['3'].score, null);
});

test('10. Mixed statuses with missing source marks mark calculated component as partial', () => {
  const comps = [
    { id: '1', name: 'Q1', maximum_score: 10, component_type: 'input' },
    { id: '2', name: 'Q2', maximum_score: 10, component_type: 'input' },
    { id: '3', name: 'Total', component_type: 'calculated', source_component_ids: ['1', '2'] },
  ];
  const marks = { '1': 7 }; // Q2 is not entered yet
  const calculated = calculateComponentMarks(comps, marks);
  assert.equal(calculated['3'].score, 7);
  assert.equal(calculated['3'].mark_status, 'partial');
});

test('11. Final grade calculation seamlessly uses assessment totals with weighting', () => {
  const students = [
    { id: 101, display_name: 'Ahmad Alshara' },
    { id: 102, display_name: 'Ali Jordan' },
  ];
  const assessments = [
    { id: 1, title: 'Midterm Exam' },
    { id: 2, title: 'Final Exam' },
  ];
  const components = [
    { id: 11, assessment_id: 1, name: 'Q1', maximum_score: 20, component_type: 'input' },
    { id: 12, assessment_id: 1, name: 'Q2', maximum_score: 20, component_type: 'input' },
    { id: 13, assessment_id: 1, name: 'Total', maximum_score: 40, component_type: 'calculated', source_component_ids: [11, 12] },
    { id: 21, assessment_id: 2, name: 'Final Total', maximum_score: 60, component_type: 'input' },
  ];
  // Student 101: Midterm Q1=18, Q2=18 (Total=36/40 = 90%). Final=54/60 (90%).
  // Student 102: Midterm Q1=10, Q2=10 (Total=20/40 = 50%). Final=30/60 (50%).
  const marks = [
    { component_id: 11, student_id: 101, score: 18 },
    { component_id: 12, student_id: 101, score: 18 },
    { component_id: 21, student_id: 101, score: 54 },
    { component_id: 11, student_id: 102, score: 10 },
    { component_id: 12, student_id: 102, score: 10 },
    { component_id: 21, student_id: 102, score: 30 },
  ];

  const config = {
    scheme_id: 1,
    categories: [
      { id: 1, name: 'Midterm', weight: 40 },
      { id: 2, name: 'Final', weight: 60 },
    ],
    items: [
      { id: 1, category_id: 1, component_id: 13, weight: 1 }, // Using calculated Midterm Total!
      { id: 2, category_id: 2, component_id: 21, weight: 1 }, // Using Final Total
    ],
  };

  const scheme = {
    id: 1,
    components: {
      Overall: {
        maximum_score: 100,
        thresholds: { 'A*': 90, A: 80, B: 70, C: 60, D: 50, F: 0 },
      },
    },
  };

  const res = calculateFinalGrades({ students, assessments, components, marks, config, scheme });
  assert.equal(res.readiness.valid, true);
  assert.equal(res.readiness.ready_students, 2);

  const ahmad = res.results.find((r) => r.student_id === 101);
  assert.equal(ahmad.overall_percent, 90);
  assert.equal(ahmad.final_grade, 'A*');

  const ali = res.results.find((r) => r.student_id === 102);
  assert.equal(ali.overall_percent, 50);
  assert.equal(ali.final_grade, 'D');
});
