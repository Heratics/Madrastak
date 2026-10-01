export function validateGradebookInput(payload = {}) {
  const title = String(payload.title || '').trim();
  const academicYear = String(payload.academic_year || '').trim();
  if (title.length < 2 || title.length > 255) return { valid: false, error: 'Title must be between 2 and 255 characters.' };
  if (!academicYear || academicYear.length > 32) return { valid: false, error: 'Academic year is required.' };
  return { valid: true, value: { ...payload, title, academic_year: academicYear } };
}

export function validateStudentInput(payload = {}) {
  const firstName = String(payload.first_name || '').trim();
  const lastName = String(payload.last_name || '').trim();
  const displayName = String(payload.display_name || `${firstName} ${lastName}`).trim();
  if (!displayName || displayName.length > 255) return { valid: false, error: 'A valid student name is required.' };
  return { valid: true, value: { ...payload, first_name: firstName, last_name: lastName, display_name: displayName } };
}

export function validateAssessmentInput(payload = {}) {
  const title = String(payload.title || '').trim();
  const components = Array.isArray(payload.components) ? payload.components : [];
  if (!title || title.length > 255) return { valid: false, error: 'Assessment title is required.' };
  if (!components.length) return { valid: false, error: 'At least one assessment component is required.' };
  if (components.some((component) => !String(component.name || '').trim() || Number(component.maximum_score ?? component.max) < 0)) {
    return { valid: false, error: 'Assessment components must have names and non-negative maximum scores.' };
  }
  return { valid: true, value: { ...payload, title, components } };
}
