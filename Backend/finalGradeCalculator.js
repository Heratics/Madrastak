const { calculateComponentMarks } = require('./componentCalculation');

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validateThresholdScheme(scheme) {
  const errors = [];
  const components = scheme?.components || {};
  if (!Object.keys(components).length) errors.push('The grading scheme has no components.');
  for (const [key, component] of Object.entries(components)) {
    const thresholds = component?.thresholds || {};
    const labels = Object.keys(thresholds);
    if (!labels.length) errors.push(`Threshold component ${key} has no grade boundaries.`);
    const values = labels.map((label) => numeric(thresholds[label]));
    if (values.some((value) => value === null)) errors.push(`Threshold component ${key} contains a non-numeric boundary.`);
    if (values.some((value) => value < 0)) errors.push(`Threshold component ${key} contains a negative boundary.`);
    if (new Set(labels).size !== labels.length) errors.push(`Threshold component ${key} contains duplicate grade labels.`);
    for (let index = 1; index < values.length; index += 1) if (values[index] > values[index - 1]) errors.push(`Threshold component ${key} is not ordered from highest to lowest.`);
    if (values.length && !values.some((value) => value === 0)) errors.push(`Threshold component ${key} has no baseline boundary at 0.`);
  }
  return { valid: errors.length === 0, errors };
}

function assessmentPercent(markRows, componentId, studentId, maximum, studentCalculatedMarks = {}) {
  const computed = studentCalculatedMarks[String(componentId)] || studentCalculatedMarks[Number(componentId)];
  const rawMark = markRows.find((row) => Number(row.component_id) === Number(componentId) && Number(row.student_id) === Number(studentId));
  const score = computed?.score !== undefined ? computed.score : numeric(rawMark?.score);
  const status = computed?.mark_status || rawMark?.mark_status || null;
  if (score === null) return { percent: null, score: null, status };
  if (!Number.isFinite(Number(maximum)) || Number(maximum) <= 0 || score < 0 || score > Number(maximum)) return { percent: null, score, status: status || 'invalid' };
  return { percent: score / Number(maximum) * 100, score, status };
}

function gradeForPercent(percent, scheme, componentKey) {
  if (percent === null || percent === undefined) return null;
  const component = scheme?.components?.[componentKey] || scheme?.components?.Overall || scheme?.components?.AX;
  if (!component) return null;
  const maximum = numeric(component.maximum_score);
  const score = maximum && maximum > 0 ? percent / 100 * maximum : percent;
  const thresholds = Object.entries(component.thresholds || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
  return thresholds.find(([, minimum]) => score >= Number(minimum))?.[0] || null;
}

function calculateFinalGrades({ students = [], assessments = [], components = [], marks = [], config, scheme }) {
  const schemeValidation = validateThresholdScheme(scheme);
  const categories = config?.categories || [];
  const categoryItems = config?.items || [];
  const assessmentMap = new Map(assessments.map((assessment) => [Number(assessment.id), assessment]));
  const componentMap = new Map(components.map((component) => [Number(component.id), component]));
  const readiness = { errors: [...schemeValidation.errors], warnings: [], missing_mappings: [], duplicate_mappings: [], students: [] };
  const seenComponents = new Set();
  for (const item of categoryItems) {
    const component = componentMap.get(Number(item.component_id));
    if (!component) readiness.errors.push(`Mapped component ${item.component_id} no longer exists.`);
    if (seenComponents.has(Number(item.component_id))) readiness.duplicate_mappings.push(Number(item.component_id));
    seenComponents.add(Number(item.component_id));
  }
  if (readiness.duplicate_mappings.length) readiness.errors.push('A component is mapped more than once.');
  if (!categories.length) readiness.errors.push('No final-grade categories are configured.');
  const categoryWeight = categories.reduce((sum, category) => sum + Number(category.weight || 0), 0);
  if (Math.abs(categoryWeight - 100) > 0.001) readiness.errors.push(`Category weights must total 100%; current total is ${categoryWeight}.`);
  if (categoryItems.length === 0) readiness.errors.push('No assessment components are mapped into final-grade categories.');
  for (const assessment of assessments) for (const component of components.filter((candidate) => Number(candidate.assessment_id) === Number(assessment.id))) if (!seenComponents.has(Number(component.id))) readiness.missing_mappings.push(Number(component.id));
  if (readiness.missing_mappings.length) readiness.warnings.push(`${readiness.missing_mappings.length} assessment component(s) are not mapped.`);

  const results = students.map((student) => {
    // Collect all computed marks for this student across assessments
    const studentCalculatedMarks = {};
    for (const assessment of assessments) {
      const assComps = components.filter((c) => Number(c.assessment_id) === Number(assessment.id));
      const rawStudentMarks = marks.filter((m) => Number(m.student_id) === Number(student.id) && assComps.some((c) => Number(c.id) === Number(m.component_id)));
      const computed = calculateComponentMarks(assComps, rawStudentMarks);
      Object.entries(computed).forEach(([cId, data]) => {
        studentCalculatedMarks[String(cId)] = data;
        studentCalculatedMarks[Number(cId)] = data;
      });
    }

    const categoryResults = categories.map((category) => {
      const items = categoryItems.filter((item) => Number(item.category_id) === Number(category.id));
      const values = items
        .map((item) => ({ item, component: componentMap.get(Number(item.component_id)) }))
        .filter((value) => value.component)
        .map(({ item, component }) => ({
          ...assessmentPercent(marks, component.id, student.id, component.maximum_score, studentCalculatedMarks),
          component,
          assessment: assessmentMap.get(Number(component.assessment_id)),
          weight: Number(item.weight || 1),
        }));
      const numericValues = values.filter((value) => value.percent !== null);
      const totalWeight = numericValues.reduce((sum, value) => sum + value.weight, 0);
      const percent = totalWeight > 0 ? numericValues.reduce((sum, value) => sum + value.percent * value.weight, 0) / totalWeight : null;
      return { id: category.id, name: category.name, weight: Number(category.weight || 0), percent, items: values };
    });
    const required = categoryItems.length;
    const complete = categoryResults.reduce((sum, category) => sum + category.items.filter((item) => item.percent !== null).length, 0);
    const absent = categoryResults.reduce((sum, category) => sum + category.items.filter((item) => item.percent === null && /absent/i.test(item.status || '')).length, 0);
    const missing = required - complete;
    const usableCategories = categoryResults.filter((category) => category.percent !== null);
    const overall = categoryWeight > 0 && usableCategories.length === categories.length ? usableCategories.reduce((sum, category) => sum + category.percent * category.weight, 0) / categoryWeight : null;
    const status = missing ? (absent ? 'Absent' : 'Incomplete') : (overall === null ? (absent ? 'Absent' : 'No Grade') : 'Ready');
    const result = {
      student_id: student.id,
      display_name: student.display_name,
      categories: categoryResults,
      overall_percent: overall != null ? Math.round(overall * 100) / 100 : null,
      final_grade: status === 'Ready' ? gradeForPercent(overall, scheme, scheme.components?.Overall ? 'Overall' : (scheme.components?.AX ? 'AX' : Object.keys(scheme.components || {})[0])) : null,
      status,
      required_assessments: required,
      completed_assessments: complete,
      missing_assessments: Math.max(0, missing),
      absent_assessments: absent,
    };
    readiness.students.push(result);
    return result;
  });
  readiness.incomplete_students = results.filter((result) => result.status === 'Incomplete').length;
  readiness.absent_students = results.filter((result) => result.status === 'Absent').length;
  readiness.ready_students = results.filter((result) => result.status === 'Ready').length;
  readiness.valid = readiness.errors.length === 0;
  readiness.state = !readiness.valid ? 'NOT_READY' : (readiness.warnings.length || readiness.incomplete_students || readiness.absent_students ? 'READY_WITH_WARNINGS' : 'READY');
  return { readiness, results };
}

module.exports = { validateThresholdScheme, calculateFinalGrades, gradeForPercent };
