export const DEFAULT_GRADES = [
  { label: 'A*', min: 90 },
  { label: 'A', min: 80 },
  { label: 'B', min: 70 },
  { label: 'C', min: 60 },
  { label: 'D', min: 50 },
  { label: 'E', min: 40 },
  { label: 'F', min: 30 },
  { label: 'G', min: 20 },
  { label: 'U', min: 0 },
];

export function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function gradeFor(percent, scheme = DEFAULT_GRADES) {
  const score = safeNumber(percent, 0);
  return scheme.find((grade) => score >= grade.min)?.label || 'U';
}

export function assessmentState(assessment, studentId) {
  const components = Array.isArray(assessment?.components) ? assessment.components : [];
  const marks = assessment?.marks?.[studentId] || {};
  const statuses = assessment?.statuses?.[studentId] || {};
  const total = components.reduce((sum, component) => sum + safeNumber(component.max), 0);
  const recorded = components.filter((component) => (
    marks[component.id] !== undefined && marks[component.id] !== ''
  ) || (
    statuses[component.id] !== undefined && statuses[component.id] !== ''
  )).length;
  const numeric = components.filter((component) => marks[component.id] !== undefined && marks[component.id] !== '').length;
  const score = numeric ? components.reduce((sum, component) => sum + safeNumber(marks[component.id]), 0) : null;
  const percent = score === null ? null : (total > 0 ? score / total * 100 : null);

  if (!recorded) return { state: 'Not started', entered: 0, recorded: 0, total, score: null, percent: null };
  return {
    state: recorded === components.length ? 'Complete' : 'Partial',
    entered: numeric,
    recorded,
    total,
    score,
    percent,
  };
}

export function studentAverage(assessments, studentId) {
  const percentages = (assessments || [])
    .map((assessment) => assessmentState(assessment, studentId).percent)
    .filter((percent) => percent !== null);
  return percentages.length ? percentages.reduce((sum, percent) => sum + percent, 0) / percentages.length : null;
}

export function thresholdGrade(score, componentKey, scheme) {
  if (score === null || score === undefined || !scheme?.components?.[componentKey]) return null;
  const thresholds = scheme.components[componentKey].thresholds || {};
  const grades = scheme.grades || [];
  for (const grade of grades) {
    if (typeof thresholds[grade] === 'number' && score >= thresholds[grade]) return grade;
  }
  return 'U';
}

function thresholdMaximum(scheme, key) {
  const value = scheme?.maximums?.[key];
  return typeof value === 'number' && value > 0 ? value : null;
}

function finalComponent(assessments, studentId, componentKey, selectedItems, scheme) {
  const relevant = selectedItems.filter((item) => item.componentKey === componentKey);
  if (!relevant.length) return null;
  let raw = 0;
  let max = 0;
  let completed = 0;
  let partial = 0;

  for (const item of relevant) {
    const assessment = assessments.find((candidate) => candidate.id === item.assessmentId);
    if (!assessment) continue;
    const state = assessmentState(assessment, studentId);
    if (state.percent === null) continue;
    raw += state.score || 0;
    max += state.total || 0;
    if (state.state === 'Complete') completed += 1;
    else partial += 1;
  }

  if (max <= 0) return null;
  const targetMax = thresholdMaximum(scheme, componentKey);
  const scaled = targetMax ? raw / max * targetMax : raw / max * 100;
  return {
    raw,
    max,
    scaled,
    targetMax,
    grade: thresholdGrade(scaled, componentKey, scheme),
    completed,
    partial,
    totalItems: relevant.length,
  };
}

export function computeFinalGrade({ assessments = [], studentId, selectedItems = [], scheme, fallbackScheme }) {
  const activeScheme = scheme || fallbackScheme || { components: {}, componentOrder: [] };
  if (!selectedItems.length) return { status: 'no-selection', scheme: activeScheme, components: {}, final: null };

  const keys = activeScheme.componentOrder || Object.keys(activeScheme.components || {});
  const componentKeys = keys.filter((key) => key !== 'AX' && key !== 'Overall');
  const components = {};
  componentKeys.forEach((key) => {
    components[key] = finalComponent(assessments, studentId, key, selectedItems, activeScheme);
  });

  let final = null;
  if (activeScheme.components?.AX) {
    const ax = finalComponent(assessments, studentId, 'AX', selectedItems, activeScheme);
    if (ax) final = { ...ax, grade: thresholdGrade(ax.scaled, 'AX', activeScheme), method: 'AX assessment selection' };
    else if (componentKeys.length && componentKeys.every((key) => components[key])) {
      const scaled = componentKeys.reduce((sum, key) => sum + (components[key]?.scaled || 0), 0);
      const targetMax = thresholdMaximum(activeScheme, 'AX');
      if (targetMax) final = { scaled, targetMax, grade: thresholdGrade(scaled, 'AX', activeScheme), method: 'Combined component scores' };
    }
  } else if (activeScheme.components?.Overall) {
    const values = componentKeys.length
      ? componentKeys.map((key) => components[key]).filter(Boolean)
      : [finalComponent(assessments, studentId, 'Overall', selectedItems, activeScheme)].filter(Boolean);
    if (values.length) {
      const percent = values.reduce((sum, value) => sum + (value.targetMax ? value.scaled / value.targetMax * 100 : value.scaled), 0) / values.length;
      final = { scaled: percent, targetMax: 100, grade: thresholdGrade(percent, 'Overall', activeScheme), method: 'Overall threshold' };
    }
  } else if (componentKeys.length) {
    const values = componentKeys.map((key) => components[key]).filter(Boolean);
    if (values.length) {
      const percent = values.reduce((sum, value) => sum + (value.targetMax ? value.scaled / value.targetMax * 100 : value.scaled), 0) / values.length;
      final = { scaled: percent, targetMax: 100, grade: gradeFor(percent), method: 'Indicative average' };
    }
  }

  const requiredMissing = activeScheme.components?.AX
    ? componentKeys.filter((key) => !components[key])
    : [];
  return {
    status: requiredMissing.length ? 'incomplete' : 'ready',
    scheme: activeScheme,
    components,
    final,
    requiredMissing,
  };
}
