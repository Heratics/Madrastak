import { API_URL } from '../../../config';
import { getValidToken } from '../../../utils/auth';

async function request(path, options = {}) {
  const token = getValidToken();
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
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
  listGradebooks: () => request('/api/3alamatak/gradebooks'),
  createGradebook: (payload) => request('/api/3alamatak/gradebooks', { method: 'POST', body: JSON.stringify(payload) }),
  updateGradebook: (id, payload) => request(`/api/3alamatak/gradebooks/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  archiveGradebook: (id) => request(`/api/3alamatak/gradebooks/${id}`, { method: 'DELETE' }),
  getGradebook: (id) => request(`/api/3alamatak/gradebooks/${id}`),
  listStudents: (id) => request(`/api/3alamatak/gradebooks/${id}/students`),
  createStudent: (id, payload) => request(`/api/3alamatak/gradebooks/${id}/students`, { method: 'POST', body: JSON.stringify(payload) }),
  updateStudent: (gradebookId, studentId, payload) => request(`/api/3alamatak/gradebooks/${gradebookId}/students/${studentId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  archiveStudent: (gradebookId, studentId) => request(`/api/3alamatak/gradebooks/${gradebookId}/students/${studentId}`, { method: 'DELETE' }),
  listAssessments: (id) => request(`/api/3alamatak/gradebooks/${id}/assessments`),
  createAssessment: (id, payload) => request(`/api/3alamatak/gradebooks/${id}/assessments`, { method: 'POST', body: JSON.stringify(payload) }),
  updateAssessment: (id, payload) => request(`/api/3alamatak/assessments/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteAssessment: (id) => request(`/api/3alamatak/assessments/${id}`, { method: 'DELETE' }),
  getMarks: (id) => request(`/api/3alamatak/assessments/${id}/marks`),
  saveMarks: (id, marks) => request(`/api/3alamatak/assessments/${id}/marks`, { method: 'PUT', body: JSON.stringify({ marks }) }),
  getAnalytics: (id) => request(`/api/3alamatak/gradebooks/${id}/analytics`),
  exportGradebook: (id) => request(`/api/3alamatak/gradebooks/${id}/export`),
  importPackage: (id, payload) => request(`/api/3alamatak/gradebooks/${id}/imports`, { method: 'POST', body: JSON.stringify(payload) }),
};
