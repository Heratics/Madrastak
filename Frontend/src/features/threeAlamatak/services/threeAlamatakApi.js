import { API_URL } from '../../../config';
import { getValidToken } from '../../../utils/auth';

async function request(path, options = {}) {
  const token = getValidToken();
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = {
    ...(!isFormData && options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const responseText = await response.text();
  const data = (() => {
    try { return responseText ? JSON.parse(responseText) : null; }
    catch { return { message: responseText }; }
  })();
  if (!response.ok) throw new Error(data?.message || '3alamatak request failed.');
  return data;
}

export const threeAlamatakApi = {
  listGradebooks: (status = 'active') => request(`/api/3alamatak/gradebooks?status=${encodeURIComponent(status)}`),
  createGradebook: (payload) => request('/api/3alamatak/gradebooks', { method: 'POST', body: JSON.stringify(payload) }),
  updateGradebook: (id, payload) => request(`/api/3alamatak/gradebooks/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  archiveGradebook: (id) => request(`/api/3alamatak/gradebooks/${id}`, { method: 'DELETE' }),
  restoreGradebook: (id) => request(`/api/3alamatak/gradebooks/${id}/restore`, { method: 'POST' }),
  permanentlyDeleteGradebook: (id) => request(`/api/3alamatak/gradebooks/${id}/permanent`, { method: 'DELETE' }),
  getGradebook: (id) => request(`/api/3alamatak/gradebooks/${id}`),
  listStudents: (id) => request(`/api/3alamatak/gradebooks/${id}/students`),
  createStudent: (id, payload) => request(`/api/3alamatak/gradebooks/${id}/students`, { method: 'POST', body: JSON.stringify(payload) }),
  updateStudent: (gradebookId, studentId, payload) => request(`/api/3alamatak/gradebooks/${gradebookId}/students/${studentId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  archiveStudent: (gradebookId, studentId) => request(`/api/3alamatak/gradebooks/${gradebookId}/students/${studentId}`, { method: 'DELETE' }),
  listStudentAliases: (gradebookId, studentId) => request(`/api/3alamatak/gradebooks/${gradebookId}/students/${studentId}/aliases`),
  addStudentAlias: (gradebookId, studentId, alias_name) => request(`/api/3alamatak/gradebooks/${gradebookId}/students/${studentId}/aliases`, { method: 'POST', body: JSON.stringify({ alias_name }) }),
  removeStudentAlias: (gradebookId, studentId, aliasId) => request(`/api/3alamatak/gradebooks/${gradebookId}/students/${studentId}/aliases/${aliasId}`, { method: 'DELETE' }),
  listDuplicateStudents: (gradebookId) => request(`/api/3alamatak/gradebooks/${gradebookId}/duplicate-students`),
  previewStudentMerge: (gradebookId, payload) => request(`/api/3alamatak/gradebooks/${gradebookId}/student-merge/preview`, { method: 'POST', body: JSON.stringify(payload) }),
  mergeStudents: (gradebookId, payload) => request(`/api/3alamatak/gradebooks/${gradebookId}/student-merge`, { method: 'POST', body: JSON.stringify(payload) }),
  listAssessments: (id) => request(`/api/3alamatak/gradebooks/${id}/assessments`),
  createAssessment: (id, payload) => request(`/api/3alamatak/gradebooks/${id}/assessments`, { method: 'POST', body: JSON.stringify(payload) }),
  updateAssessment: (id, payload) => request(`/api/3alamatak/assessments/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteAssessment: (id) => request(`/api/3alamatak/assessments/${id}`, { method: 'DELETE' }),
  getMarks: (id) => request(`/api/3alamatak/assessments/${id}/marks`),
  saveMarks: (id, marks) => request(`/api/3alamatak/assessments/${id}/marks`, { method: 'PUT', body: JSON.stringify({ marks }) }),
  getAnalytics: (id) => request(`/api/3alamatak/gradebooks/${id}/analytics`),
  getFinalGrades: (id) => request(`/api/3alamatak/gradebooks/${id}/final-grades`),
  saveFinalGradeConfig: (id, payload) => request(`/api/3alamatak/gradebooks/${id}/final-grades/config`, { method: 'PUT', body: JSON.stringify(payload) }),
  finalizeFinalGrades: (id) => request(`/api/3alamatak/gradebooks/${id}/final-grades/finalize`, { method: 'POST' }),
  exportFinalGrades: async (id) => {
    const token = getValidToken();
    const response = await fetch(`${API_URL}/api/3alamatak/gradebooks/${id}/final-grades/export`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.message || 'Final-grade export failed.'); }
    return response.blob();
  },
  exportGradebook: (id) => request(`/api/3alamatak/gradebooks/${id}/export`),
  analyzeWorkbook: (id, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return request(`/api/3alamatak/gradebooks/${id}/imports/analyze`, { method: 'POST', body: formData });
  },
  importPackage: (id, payload) => {
    const isFormData = typeof FormData !== 'undefined' && payload instanceof FormData;
    return request(`/api/3alamatak/gradebooks/${id}/imports`, {
      method: 'POST',
      body: isFormData ? payload : JSON.stringify(payload),
    });
  },
  listSchemes: (id) => request(`/api/3alamatak/gradebooks/${id}/schemes`),
  createScheme: (id, payload) => request(`/api/3alamatak/gradebooks/${id}/schemes`, { method: 'POST', body: JSON.stringify(payload) }),
  updateScheme: (gradebookId, schemeId, payload) => request(`/api/3alamatak/gradebooks/${gradebookId}/schemes/${schemeId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteScheme: (gradebookId, schemeId) => request(`/api/3alamatak/gradebooks/${gradebookId}/schemes/${schemeId}`, { method: 'DELETE' }),
  listHistoricalRecords: (id, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/3alamatak/gradebooks/${id}/historical-records${q ? `?${q}` : ''}`);
  },
  listImports: (id) => request(`/api/3alamatak/gradebooks/${id}/imports`),
  getImport: (id, importId) => request(`/api/3alamatak/gradebooks/${id}/imports/${importId}`),
  rollbackImport: (id, importId) => request(`/api/3alamatak/gradebooks/${id}/imports/${importId}/rollback`, { method: 'POST' }),
  updateHistoricalRecord: (id, payload) => request(`/api/3alamatak/historical-records/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteHistoricalRecord: (id) => request(`/api/3alamatak/historical-records/${id}`, { method: 'DELETE' }),
};
