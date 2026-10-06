import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  ArrowLeft,
  Award,
  BarChart3,
  BookOpen,
  Calculator,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  FileCode,
  GraduationCap,
  HelpCircle,
  History,
  Info,
  Layers,
  LayoutDashboard,
  Lock,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  Users,
  X,
  AlertTriangle,
  Database,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import { AuthContext } from '../context/AuthContext';
import { threeAlamatakApi } from '../features/threeAlamatak/services/threeAlamatakApi';
import {
  buildWorkbookImportPackage,
  classifyWorkbook,
  parseDelimited,
  readXlsxWorkbook,
} from '../features/threeAlamatak/utils/workbookParser';
import {
  validateComponentDefinitions,
  calculateComponentMarks,
} from '../features/threeAlamatak/utils/componentCalculation';

const WORKSPACE_VIEWS = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['classes', 'Gradebooks', BookOpen],
  ['students', 'Students', Users],
  ['workspace', 'Assessments & Markbook', Layers],
  ['import', 'Import', Upload],
  ['reports', 'Reports', Printer],
];

const MANAGE_VIEWS = [
  ['settings', 'Settings', Settings2],
];

function viewTitle(view, gradebook) {
  switch (view) {
    case 'dashboard':
      return 'Teacher Dashboard';
    case 'classes':
      return 'Gradebook Directory';
    case 'students':
      return 'Student Roster';
    case 'workspace':
      return gradebook ? `${gradebook.title} Markbook` : 'Assessment Workspace';
    case 'import':
      return 'Workbook & Delimited Importer';
    case 'reports':
      return 'Custom Report Builder';
    case 'settings':
      return 'Gradebook Settings & Data Hub';
    default:
      return '3alamatak';
  }
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function safeFilename(name) {
  return String(name || 'export').trim().replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]+/g, '_');
}

function downloadText(content, filename, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function ThreeAlamatakPage() {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const [view, setView] = useState('dashboard');
  const [gradebooks, setGradebooks] = useState([]);
  const [gradebookTab, setGradebookTab] = useState('active');
  const [selectedId, setSelectedId] = useState(null);
  const [gradebook, setGradebook] = useState(null);
  const [students, setStudents] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [schemes, setSchemes] = useState([]);
  const [historicalRecords, setHistoricalRecords] = useState([]);
  const [importHistory, setImportHistory] = useState([]);
  const [checkpoints, setCheckpoints] = useState([]);
  const [restorePreview, setRestorePreview] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [activeAssessmentId, setActiveAssessmentId] = useState(null);
  const [marks, setMarks] = useState({});
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [showGradebookForm, setShowGradebookForm] = useState(false);
  const [editingGradebook, setEditingGradebook] = useState(null);
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [showAssessmentForm, setShowAssessmentForm] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [editingAssessment, setEditingAssessment] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [showSchemeForm, setShowSchemeForm] = useState(false);
  const [editingScheme, setEditingScheme] = useState(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [studentResolutions, setStudentResolutions] = useState({});

  // Performance cache for loaded assessment marks
  const marksCacheRef = useRef({});

  const loadGradebooks = async (preferredId = selectedId, status = gradebookTab) => {
    try {
      setBusy(true);
      const list = await threeAlamatakApi.listGradebooks(status);
      setGradebooks(list);
      const nextId = preferredId && list.some((item) => item.id === preferredId)
        ? preferredId
        : (list[0]?.id || null);
      setSelectedId(nextId);
      if (!nextId) {
        setGradebook(null);
        setStudents([]);
        setAssessments([]);
        setMarks({});
        setSchemes([]);
        setHistoricalRecords([]);
        setImportHistory([]);
        setCheckpoints([]);
        setAnalytics(null);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    loadGradebooks(selectedId, gradebookTab);
  }, [gradebookTab]);

  const loadGradebook = async (id) => {
    if (!id) {
      setGradebook(null);
      return;
    }
    try {
      setBusy(true);
      // Parallelize workspace queries
      const [g, stus, asses, schs, hist, imps, an, chks] = await Promise.all([
        threeAlamatakApi.getGradebook(id),
        threeAlamatakApi.listStudents(id),
        threeAlamatakApi.listAssessments(id),
        threeAlamatakApi.listSchemes(id),
        threeAlamatakApi.listHistoricalRecords(id),
        threeAlamatakApi.listImports(id),
        threeAlamatakApi.getAnalytics(id).catch(() => null),
        threeAlamatakApi.listCheckpoints(id).catch(() => []),
      ]);
      setGradebook(g);
      setStudents(stus || []);
      setAssessments(asses || []);
      setSchemes(schs || []);
      setHistoricalRecords(hist || []);
      setImportHistory(imps || []);
      setAnalytics(an);
      setCheckpoints(chks || []);
      if (asses?.length && (!activeAssessmentId || !asses.some((a) => a.id === activeAssessmentId))) {
        setActiveAssessmentId(asses[0].id);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (selectedId) {
      loadGradebook(selectedId);
    }
  }, [selectedId]);

  const loadMarks = async (assessmentId) => {
    if (!assessmentId) {
      setMarks({});
      return;
    }
    // Check in-memory cache first for instant response
    if (marksCacheRef.current[assessmentId]) {
      setMarks(marksCacheRef.current[assessmentId]);
    }
    try {
      const markList = await threeAlamatakApi.getMarks(assessmentId);
      const nextMarks = {};
      markList.forEach((mark) => {
        nextMarks[`${mark.student_id}:${mark.component_id}`] = mark;
      });
      marksCacheRef.current[assessmentId] = nextMarks;
      setMarks(nextMarks);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    loadMarks(activeAssessmentId);
  }, [activeAssessmentId]);

  const activeAssessment = useMemo(
    () => assessments.find((item) => item.id === activeAssessmentId) || null,
    [assessments, activeAssessmentId]
  );

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const handleSaveMarks = async () => {
    if (!activeAssessment) return;
    try {
      setBusy(true);
      // Filter out calculated marks - they are derived automatically
      const entries = Object.values(marks).filter((m) => !m.is_calculated);
      await threeAlamatakApi.saveMarks(activeAssessment.id, entries);
      // Invalidate cache and reload
      delete marksCacheRef.current[activeAssessment.id];
      await loadMarks(activeAssessment.id);
      notify('Marks saved successfully.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveGradebook = async (payload) => {
    try {
      setBusy(true);
      if (editingGradebook) {
        const updated = await threeAlamatakApi.updateGradebook(editingGradebook.id, payload);
        notify('Gradebook updated.');
        setShowGradebookForm(false);
        setEditingGradebook(null);
        await loadGradebooks(updated.id);
      } else {
        const created = await threeAlamatakApi.createGradebook(payload);
        notify('Gradebook created.');
        setShowGradebookForm(false);
        await loadGradebooks(created.id);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleArchiveGradebook = async (id) => {
    if (!window.confirm('Archive this gradebook? It will be hidden from the active list but can be restored anytime.')) return;
    try {
      setBusy(true);
      await threeAlamatakApi.archiveGradebook(id);
      notify('Gradebook archived.');
      await loadGradebooks(null, 'active');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreGradebook = async (id) => {
    try {
      setBusy(true);
      await threeAlamatakApi.restoreGradebook(id);
      notify('Gradebook restored to active.');
      await loadGradebooks(id, 'active');
      setGradebookTab('active');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handlePermanentDeleteGradebook = async (id) => {
    if (!window.confirm('PERMANENT DESTRUCTION: This will permanently delete this gradebook and all its students, marks, assessments, and backups. This action CANNOT be undone. Proceed?')) return;
    try {
      setBusy(true);
      await threeAlamatakApi.permanentlyDeleteGradebook(id);
      notify('Gradebook permanently deleted.');
      await loadGradebooks(null, gradebookTab);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveStudent = async (payload) => {
    if (!selectedId) return;
    try {
      setBusy(true);
      if (editingStudent) {
        await threeAlamatakApi.updateStudent(selectedId, editingStudent.id, payload);
        notify('Student updated.');
      } else {
        await threeAlamatakApi.createStudent(selectedId, payload);
        notify('Student added.');
      }
      setShowStudentForm(false);
      setEditingStudent(null);
      await loadGradebook(selectedId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAssessment = async (payload) => {
    if (!selectedId) return;
    try {
      setBusy(true);
      if (editingAssessment) {
        await threeAlamatakApi.updateAssessment(editingAssessment.id, payload);
        notify('Assessment updated.');
      } else {
        const created = await threeAlamatakApi.createAssessment(selectedId, payload);
        setActiveAssessmentId(created.id);
        notify('Assessment created.');
      }
      setShowAssessmentForm(false);
      setEditingAssessment(null);
      await loadGradebook(selectedId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAssessment = async (id) => {
    if (!window.confirm('Delete this assessment and all its marks?')) return;
    try {
      setBusy(true);
      await threeAlamatakApi.deleteAssessment(id);
      notify('Assessment deleted.');
      await loadGradebook(selectedId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveScheme = async (payload) => {
    if (!selectedId) return;
    try {
      setBusy(true);
      if (editingScheme) {
        await threeAlamatakApi.updateScheme(selectedId, editingScheme.id, payload);
        notify('Grading scheme updated.');
      } else {
        await threeAlamatakApi.createScheme(selectedId, payload);
        notify('Grading scheme created.');
      }
      setShowSchemeForm(false);
      setEditingScheme(null);
      await loadGradebook(selectedId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteScheme = async (schemeId) => {
    if (!window.confirm('Delete this grading scheme?')) return;
    try {
      setBusy(true);
      await threeAlamatakApi.deleteScheme(selectedId, schemeId);
      notify('Grading scheme deleted.');
      await loadGradebook(selectedId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveRecord = async (payload) => {
    if (!selectedId) return;
    try {
      setBusy(true);
      if (editingRecord) {
        await threeAlamatakApi.updateHistoricalRecord(editingRecord.id, payload);
        notify('Record updated.');
      } else {
        await threeAlamatakApi.createHistoricalRecord(selectedId, payload);
        notify('Record created.');
      }
      setShowRecordForm(false);
      setEditingRecord(null);
      await loadGradebook(selectedId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRecord = async (id) => {
    if (!window.confirm('Delete this record?')) return;
    try {
      setBusy(true);
      await threeAlamatakApi.deleteHistoricalRecord(id);
      notify('Record deleted.');
      await loadGradebook(selectedId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Export handlers
  const handleExportCsv = () => {
    if (!gradebook) return;
    const headers = ['Student ID', 'Name', 'Status'];
    const compHeaders = [];
    assessments.forEach((ass) => {
      (ass.components || []).forEach((c) => {
        compHeaders.push(`${ass.title} - ${c.name} (/${c.maximum_score})`);
      });
    });
    const rows = [
      [...headers, ...compHeaders].map(csvCell).join(','),
      ...students.map((st) => {
        const compValues = [];
        assessments.forEach((ass) => {
          (ass.components || []).forEach((c) => {
            const entry = marks[`${st.id}:${c.id}`];
            compValues.push(entry?.score ?? entry?.mark_status ?? '');
          });
        });
        return [
          st.external_student_id || st.id,
          st.display_name,
          st.status,
          ...compValues,
        ].map(csvCell).join(',');
      }),
    ];
    downloadText(rows.join('\n'), `${safeFilename(gradebook.title)}_Marks.csv`, 'text/csv;charset=utf-8');
  };

  const handleExportCanonicalJson = async () => {
    if (!selectedId) return;
    try {
      const backup = await threeAlamatakApi.getBackup(selectedId);
      downloadText(JSON.stringify(backup, null, 2), `${safeFilename(gradebook.title)}_Backup_v1.json`, 'application/json');
      notify('Canonical Format v1 backup downloaded.');
    } catch (e) {
      setError(e.message);
    }
  };

  const handleExportXml = async () => {
    if (!selectedId) return;
    try {
      const xml = await threeAlamatakApi.exportGradebook(selectedId);
      downloadText(typeof xml === 'string' ? xml : JSON.stringify(xml), `${safeFilename(gradebook.title)}.xml`, 'application/xml');
      notify('XML export downloaded.');
    } catch (e) {
      setError(e.message);
    }
  };

  const handleExportHtml = async () => {
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/3alamatak/gradebooks/${selectedId}/export?format=html`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const html = await res.text();
      downloadText(html, `${safeFilename(gradebook.title)}_Report.html`, 'text/html;charset=utf-8');
      notify('HTML Report downloaded.');
    } catch (e) {
      setError(e.message);
    }
  };

  const handleValidateBackup = async (fileOrPayload) => {
    if (!selectedId) return;
    try {
      setBusy(true);
      const validation = await threeAlamatakApi.validateBackup(selectedId, fileOrPayload);
      setRestorePreview({ validation, fileOrPayload });
      notify('Backup validated. Inspect diff before executing replace restore.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleExecuteRestore = async () => {
    if (!selectedId || !restorePreview?.fileOrPayload) return;
    if (!window.confirm('REPLACE RESTORE: This will replace all current gradebook data with the backup snapshot. An automatic pre-restore checkpoint will be captured. Continue?')) return;
    try {
      setBusy(true);
      const res = await threeAlamatakApi.restoreBackup(selectedId, restorePreview.fileOrPayload);
      notify(`Restore successful: ${res.manifest?.marks_restored || 0} marks restored.`);
      setRestorePreview(null);
      await loadGradebook(selectedId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreCheckpoint = async (checkpointId) => {
    if (!window.confirm('Rollback to this recovery checkpoint? Current state will be snapshotted first.')) return;
    try {
      setBusy(true);
      await threeAlamatakApi.restoreCheckpoint(selectedId, checkpointId);
      notify('Gradebook successfully restored from recovery checkpoint.');
      await loadGradebook(selectedId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCheckpoint = async (checkpointId) => {
    if (!window.confirm('Delete this recovery checkpoint?')) return;
    try {
      setBusy(true);
      await threeAlamatakApi.deleteCheckpoint(selectedId, checkpointId);
      notify('Checkpoint deleted.');
      await loadGradebook(selectedId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return <UnauthorizedThreeAlamatak onLogin={() => navigate('/login')} />;
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      {toast && (
        <div className="fixed right-5 top-5 z-50 flex items-center gap-3 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-2xl">
          <Check className="h-4 w-4 text-emerald-400" />
          {toast}
        </div>
      )}
      {error && (
        <div className="fixed right-5 top-5 z-50 flex items-center gap-3 rounded-2xl bg-red-700 px-5 py-3 text-sm font-bold text-white shadow-2xl">
          <AlertTriangle className="h-4 w-4" />
          {error}
          <button type="button" onClick={() => setError('')} className="ml-2 text-red-200 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Top Navbar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-6 py-3.5 backdrop-blur shadow-sm">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate('/ahmadadminpage')}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-xs transition"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-teal-600 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">3alamatak</span>
              <h1 className="text-lg font-black tracking-tight text-slate-900">Madrastak Cloud Gradebook</h1>
            </div>
            {gradebook ? (
              <p className="text-xs font-semibold text-teal-700">
                Current: <span className="font-bold text-slate-800">{gradebook.title}</span> · {gradebook.subject || 'General'} · {gradebook.academic_year}
              </p>
            ) : (
              <p className="text-xs text-slate-400">Select a gradebook to begin</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {busy && (
            <span className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500">
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-teal-600" /> Syncing…
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setEditingGradebook(null);
              setShowGradebookForm(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-teal-600 transition"
          >
            <Plus className="h-4 w-4" /> New Gradebook
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row">
        {/* Left Navigation Sidebar */}
        <aside className="w-full shrink-0 rounded-2xl bg-slate-900 p-4 text-slate-300 shadow-xl lg:w-64 lg:self-start">
          <div className="mb-2 px-3 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Workspace</div>
          <nav className="space-y-1">
            {WORKSPACE_VIEWS.map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold transition ${
                  view === key
                    ? 'bg-teal-700 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 text-teal-400" />
                {label}
              </button>
            ))}
          </nav>

          <div className="my-4 border-t border-slate-800" />

          <div className="mb-2 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Manage</div>
          <nav className="space-y-1">
            {MANAGE_VIEWS.map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold transition ${
                  view === key
                    ? 'bg-teal-700 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 text-teal-400" />
                {label}
              </button>
            ))}
          </nav>

          {/* Current Gradebook Card in Sidebar */}
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-800/80 p-3.5">
            <p className="text-[10px] font-black uppercase tracking-widest text-teal-400">Current Gradebook</p>
            {gradebook ? (
              <div className="mt-2">
                <p className="font-extrabold text-white text-sm truncate">{gradebook.title}</p>
                <p className="text-xs text-slate-400 mt-0.5 truncate">
                  {gradebook.subject || 'General'} · {gradebook.academic_year}
                </p>
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-400 italic">None selected</p>
            )}
            <select
              value={selectedId || ''}
              onChange={(event) => setSelectedId(Number(event.target.value) || null)}
              className="mt-3 min-h-9 w-full rounded-xl border border-slate-700 bg-slate-900 px-2.5 text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="">Select a gradebook</option>
              {gradebooks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} ({item.subject || 'General'} · {item.academic_year})
                </option>
              ))}
            </select>
          </div>
        </aside>

        {/* Main Content Area */}
        <section className="min-w-0 flex-1">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-teal-700">3alamatak Workspace</p>
              <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-900">{viewTitle(view, gradebook)}</h2>
              <p className="mt-1 text-sm font-medium text-slate-500">
                {gradebook
                  ? `Active Gradebook: ${gradebook.title} · ${gradebook.subject || 'General'} · ${gradebook.academic_year}`
                  : 'Select or create a gradebook from the sidebar to begin.'}
              </p>
            </div>
            {gradebook && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" /> Export Marks
                </button>
                <button
                  type="button"
                  onClick={() => setShowPrintModal(true)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 text-xs font-bold text-white shadow-xs hover:bg-slate-800"
                >
                  <Printer className="h-3.5 w-3.5" /> Print View
                </button>
              </div>
            )}
          </div>

          {/* Skeletons on initial load */}
          {busy && !gradebook && selectedId && (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="h-6 w-1/3 animate-pulse rounded-lg bg-slate-200" />
              <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-48 animate-pulse rounded-xl bg-slate-100" />
            </div>
          )}

          {/* VIEW SWITCHER */}
          {view === 'dashboard' && (
            <DashboardView
              gradebook={gradebook}
              students={students}
              assessments={assessments}
              analytics={analytics}
              onNavigate={(tabKey) => setView(tabKey)}
            />
          )}

          {view === 'classes' && (
            <ClassesView
              gradebooks={gradebooks}
              selectedId={selectedId}
              gradebookTab={gradebookTab}
              onTabChange={setGradebookTab}
              onSelect={(id) => {
                setSelectedId(id);
                setView('workspace');
              }}
              onEdit={(g) => {
                setEditingGradebook(g);
                setShowGradebookForm(true);
              }}
              onArchive={handleArchiveGradebook}
              onRestore={handleRestoreGradebook}
              onDelete={handlePermanentDeleteGradebook}
              onNew={() => {
                setEditingGradebook(null);
                setShowGradebookForm(true);
              }}
            />
          )}

          {view === 'students' && (
            <StudentsView
              gradebookId={selectedId}
              students={students}
              search={search}
              onSearchChange={setSearch}
              onAddStudent={() => {
                setEditingStudent(null);
                setShowStudentForm(true);
              }}
              onEditStudent={(s) => {
                setEditingStudent(s);
                setShowStudentForm(true);
              }}
              onReload={() => loadGradebook(selectedId)}
            />
          )}

          {view === 'workspace' && (
            <WorkspaceView
              gradebookId={selectedId}
              students={students}
              assessments={assessments}
              activeAssessment={activeAssessment}
              marks={marks}
              setMarks={setMarks}
              schemes={schemes}
              historicalRecords={historicalRecords}
              importHistory={importHistory}
              onAddStudent={() => {
                setEditingStudent(null);
                setShowStudentForm(true);
              }}
              onEditStudent={(s) => {
                setEditingStudent(s);
                setShowStudentForm(true);
              }}
              onAddAssessment={() => {
                setEditingAssessment(null);
                setShowAssessmentForm(true);
              }}
              onEditAssessment={(a) => {
                setEditingAssessment(a);
                setShowAssessmentForm(true);
              }}
              onDeleteAssessment={handleDeleteAssessment}
              onAddScheme={() => {
                setEditingScheme(null);
                setShowSchemeForm(true);
              }}
              onEditScheme={(s) => {
                setEditingScheme(s);
                setShowSchemeForm(true);
              }}
              onDeleteScheme={handleDeleteScheme}
              onAssessmentChange={setActiveAssessmentId}
              onSaveMarks={handleSaveMarks}
              onAddRecord={() => {
                setEditingRecord(null);
                setShowRecordForm(true);
              }}
              onEditRecord={(r) => {
                setEditingRecord(r);
                setShowRecordForm(true);
              }}
              onDeleteRecord={handleDeleteRecord}
              onOpenReports={() => setView('reports')}
              analytics={analytics}
            />
          )}

          {view === 'import' && (
            <ImportView
              gradebookId={selectedId}
              students={students}
              assessments={assessments}
              importPreview={importPreview}
              setImportPreview={setImportPreview}
              studentResolutions={studentResolutions}
              setStudentResolutions={setStudentResolutions}
              onSuccess={() => {
                loadGradebook(selectedId);
                setView('workspace');
              }}
            />
          )}

          {view === 'reports' && (
            <ReportsView
              gradebookId={selectedId}
              gradebook={gradebook}
              students={students}
              assessments={assessments}
              analytics={analytics}
              marks={marks}
              onExportCsv={handleExportCsv}
              onExportJson={handleExportCanonicalJson}
              onExportXml={handleExportXml}
              onExportHtml={handleExportHtml}
              onOpenPrint={() => setShowPrintModal(true)}
            />
          )}

          {view === 'settings' && (
            <SettingsView
              gradebook={gradebook}
              gradebookId={selectedId}
              schemes={schemes}
              checkpoints={checkpoints}
              restorePreview={restorePreview}
              setRestorePreview={setRestorePreview}
              importHistory={importHistory}
              onEditGradebook={() => {
                setEditingGradebook(gradebook);
                setShowGradebookForm(true);
              }}
              onArchive={() => handleArchiveGradebook(selectedId)}
              onRestore={() => handleRestoreGradebook(selectedId)}
              onPermanentDelete={() => handlePermanentDeleteGradebook(selectedId)}
              onExportJson={handleExportCanonicalJson}
              onExportXml={handleExportXml}
              onExportHtml={handleExportHtml}
              onValidateBackup={handleValidateBackup}
              onExecuteRestore={handleExecuteRestore}
              onRestoreCheckpoint={handleRestoreCheckpoint}
              onDeleteCheckpoint={handleDeleteCheckpoint}
              onAddScheme={() => {
                setEditingScheme(null);
                setShowSchemeForm(true);
              }}
              onEditScheme={(s) => {
                setEditingScheme(s);
                setShowSchemeForm(true);
              }}
              onDeleteScheme={handleDeleteScheme}
              onReload={() => loadGradebook(selectedId)}
            />
          )}
        </section>
      </div>

      {/* MODALS */}
      {showGradebookForm && (
        <GradebookForm
          gradebook={editingGradebook}
          onCancel={() => {
            setShowGradebookForm(false);
            setEditingGradebook(null);
          }}
          onSubmit={handleSaveGradebook}
        />
      )}

      {showStudentForm && (
        <StudentForm
          student={editingStudent}
          onCancel={() => {
            setShowStudentForm(false);
            setEditingStudent(null);
          }}
          onSubmit={handleSaveStudent}
        />
      )}

      {showAssessmentForm && (
        <AssessmentForm
          assessment={editingAssessment}
          onCancel={() => {
            setShowAssessmentForm(false);
            setEditingAssessment(null);
          }}
          onSubmit={handleSaveAssessment}
        />
      )}

      {showSchemeForm && (
        <SchemeForm
          scheme={editingScheme}
          onCancel={() => {
            setShowSchemeForm(false);
            setEditingScheme(null);
          }}
          onSubmit={handleSaveScheme}
        />
      )}

      {showRecordForm && (
        <RecordForm
          record={editingRecord}
          students={students}
          onCancel={() => {
            setShowRecordForm(false);
            setEditingRecord(null);
          }}
          onSubmit={handleSaveRecord}
        />
      )}

      {showPrintModal && (
        <PrintReportModal
          gradebook={gradebook}
          students={students}
          assessments={assessments}
          marks={marks}
          analytics={analytics}
          onClose={() => setShowPrintModal(false)}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// DASHBOARD VIEW
// -------------------------------------------------------------
function DashboardView({ gradebook, students, assessments, analytics, onNavigate }) {
  if (!gradebook) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <GraduationCap className="mx-auto h-12 w-12 text-teal-600" />
        <h3 className="mt-4 text-lg font-black text-slate-900">Welcome to 3alamatak</h3>
        <p className="mt-1 text-sm text-slate-500">Please select an active gradebook or create a new one to get started.</p>
        <button
          type="button"
          onClick={() => onNavigate('classes')}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-teal-600"
        >
          View Gradebooks <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Students Enrolled</p>
          <p className="mt-2 text-3xl font-black text-slate-900">{students.length}</p>
          <p className="mt-1 text-xs text-slate-500">Active roster</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Assessments</p>
          <p className="mt-2 text-3xl font-black text-slate-900">{assessments.length}</p>
          <p className="mt-1 text-xs text-slate-500">Recorded tasks</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Class Average</p>
          <p className="mt-2 text-3xl font-black text-teal-700">
            {analytics?.class_average != null ? `${analytics.class_average.toFixed(1)}%` : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500">Across all assessments</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Needs Attention</p>
          <p className="mt-2 text-3xl font-black text-amber-600">
            {analytics?.needs_attention?.length || 0}
          </p>
          <p className="mt-1 text-xs text-slate-500">Students flagged</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-black text-slate-900">Quick Actions</h3>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onNavigate('workspace')}
              className="flex flex-col items-start rounded-xl border border-slate-100 bg-slate-50 p-4 text-left hover:bg-slate-100 transition"
            >
              <Layers className="h-5 w-5 text-teal-700 mb-2" />
              <span className="font-bold text-sm text-slate-900">Open Markbook</span>
              <span className="text-xs text-slate-500 mt-0.5">Enter & calculate marks</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('import')}
              className="flex flex-col items-start rounded-xl border border-slate-100 bg-slate-50 p-4 text-left hover:bg-slate-100 transition"
            >
              <Upload className="h-5 w-5 text-teal-700 mb-2" />
              <span className="font-bold text-sm text-slate-900">Import Workbook</span>
              <span className="text-xs text-slate-500 mt-0.5">Upload XLSX / CSV</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="flex flex-col items-start rounded-xl border border-slate-100 bg-slate-50 p-4 text-left hover:bg-slate-100 transition"
            >
              <Printer className="h-5 w-5 text-teal-700 mb-2" />
              <span className="font-bold text-sm text-slate-900">Custom Reports</span>
              <span className="text-xs text-slate-500 mt-0.5">Build printable summaries</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="flex flex-col items-start rounded-xl border border-slate-100 bg-slate-50 p-4 text-left hover:bg-slate-100 transition"
            >
              <Database className="h-5 w-5 text-teal-700 mb-2" />
              <span className="font-bold text-sm text-slate-900">Backup & Settings</span>
              <span className="text-xs text-slate-500 mt-0.5">Manage data snapshots</span>
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-black text-slate-900">Recent Assessments</h3>
          <div className="mt-4 divide-y divide-slate-100">
            {assessments.slice(0, 5).map((a) => (
              <div key={a.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-bold text-sm text-slate-800">{a.title}</p>
                  <p className="text-xs text-slate-400">
                    {a.assessment_date || 'No date'} · {(a.components || []).length} components
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('workspace')}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold text-teal-700 hover:bg-teal-50"
                >
                  Open
                </button>
              </div>
            ))}
            {!assessments.length && (
              <p className="py-6 text-center text-xs text-slate-400 italic">No assessments created yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// CLASSES VIEW
// -------------------------------------------------------------
function ClassesView({
  gradebooks,
  selectedId,
  gradebookTab,
  onTabChange,
  onSelect,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
  onNew,
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onTabChange('active')}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
              gradebookTab === 'active' ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Active Gradebooks
          </button>
          <button
            type="button"
            onClick={() => onTabChange('archived')}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
              gradebookTab === 'archived' ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Archived Archive
          </button>
        </div>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-xs font-bold text-white hover:bg-teal-600 shadow-sm"
        >
          <Plus className="h-4 w-4" /> Create Gradebook
        </button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {gradebooks.map((g) => (
          <div
            key={g.id}
            className={`flex flex-col justify-between rounded-2xl border p-5 transition ${
              selectedId === g.id ? 'border-teal-600 bg-teal-50/40 ring-2 ring-teal-600/20' : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold uppercase text-slate-600">
                  {g.academic_year || 'Academic Year'}
                </span>
                {g.archived ? (
                  <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">Archived</span>
                ) : (
                  <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">Active</span>
                )}
              </div>
              <h4 className="mt-3 text-lg font-black text-slate-900">{g.title}</h4>
              <p className="mt-1 text-xs font-semibold text-slate-500">{g.subject || 'General'} · {g.class_name || 'Standard'}</p>
              {g.description && <p className="mt-2 text-xs text-slate-600 line-clamp-2">{g.description}</p>}
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => onSelect(g.id)}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-700 hover:text-teal-800"
              >
                Open Workspace <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onEdit(g)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  title="Edit metadata"
                >
                  <Sliders className="h-3.5 w-3.5" />
                </button>
                {g.archived ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onRestore(g.id)}
                      className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50"
                      title="Restore gradebook"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(g.id)}
                      className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                      title="Permanently delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => onArchive(g.id)}
                    className="rounded-lg p-1.5 text-amber-600 hover:bg-amber-50"
                    title="Archive gradebook"
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {!gradebooks.length && (
          <div className="col-span-full py-12 text-center text-sm text-slate-400 italic">
            No {gradebookTab} gradebooks found.
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// WORKSPACE VIEW (MARKBOOK, ASSESSMENTS, FINAL GRADES, ETC.)
// -------------------------------------------------------------
function WorkspaceView({
  gradebookId,
  students,
  assessments,
  activeAssessment,
  marks,
  setMarks,
  schemes,
  historicalRecords,
  importHistory,
  onAddStudent,
  onEditStudent,
  onAddAssessment,
  onEditAssessment,
  onDeleteAssessment,
  onAddScheme,
  onEditScheme,
  onDeleteScheme,
  onAssessmentChange,
  onSaveMarks,
  onAddRecord,
  onEditRecord,
  onDeleteRecord,
  onOpenReports,
  analytics,
}) {
  const [tab, setTab] = useState('markbook');

  if (!gradebookId) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <Layers className="mx-auto h-12 w-12 text-slate-400" />
        <h3 className="mt-3 text-lg font-bold text-slate-700">No Gradebook Selected</h3>
        <p className="mt-1 text-sm text-slate-500">Please select a gradebook from the sidebar to view the markbook.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Workspace Tabs Header */}
      <div className="flex flex-wrap gap-1.5 border-b border-slate-100 bg-slate-50/60 p-3">
        {[
          ['markbook', 'Markbook', Layers],
          ['assessments', 'Assessments', BookOpen],
          ['final-grades', 'Final Grades', Award],
          ['schemes', 'Grading Schemes', Sliders],
          ['records', 'Records & History', History],
          ['analytics', 'Analytics', BarChart3],
          ['imports', 'Import History', FileSpreadsheet],
        ].map(([key, label, Icon]) => (
          <button
            type="button"
            key={key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
              tab === key
                ? 'bg-teal-700 text-white shadow-xs'
                : 'bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200/60'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'markbook' && (
        <Markbook
          students={students}
          assessments={assessments}
          activeAssessment={activeAssessment}
          marks={marks}
          setMarks={setMarks}
          onAssessmentChange={onAssessmentChange}
          onSave={onSaveMarks}
          onAddAssessment={onAddAssessment}
        />
      )}

      {tab === 'assessments' && (
        <div className="p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-slate-900">Assessments & Components</h3>
              <p className="text-xs text-slate-500">Manage input questions, calculated totals, and weightings.</p>
            </div>
            <button
              type="button"
              onClick={onAddAssessment}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-teal-600"
            >
              <Plus className="h-4 w-4" /> Add Assessment
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {assessments.map((a) => (
              <div key={a.id} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-black text-slate-900 text-base">{a.title}</span>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                      {a.strand || 'General'}
                    </span>
                    {a.assessment_date && (
                      <span className="text-xs text-slate-400">({a.assessment_date})</span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(a.components || []).map((c) => (
                      <span
                        key={c.id}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                          c.component_type === 'calculated'
                            ? 'bg-purple-50 text-purple-700 border border-purple-200'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {c.component_type === 'calculated' && <Calculator className="h-3 w-3" />}
                        {c.name} <span className="font-bold">/{c.maximum_score}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      onAssessmentChange(a.id);
                      setTab('markbook');
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    Enter Marks
                  </button>
                  <button
                    type="button"
                    onClick={() => onEditAssessment(a)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-teal-700 hover:bg-teal-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteAssessment(a.id)}
                    className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {!assessments.length && (
              <div className="py-12 text-center text-sm text-slate-400 italic">
                No assessments found. Click &quot;Add Assessment&quot; to create your first assessment with components and totals.
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'final-grades' && (
        <FinalGradesTab
          gradebookId={gradebookId}
          assessments={assessments}
          schemes={schemes}
        />
      )}

      {tab === 'schemes' && (
        <SchemesTab
          schemes={schemes}
          onAddScheme={onAddScheme}
          onEditScheme={onEditScheme}
          onDeleteScheme={onDeleteScheme}
        />
      )}

      {tab === 'records' && (
        <RecordsTab
          records={historicalRecords}
          students={students}
          onAddRecord={onAddRecord}
          onEditRecord={onEditRecord}
          onDeleteRecord={onDeleteRecord}
        />
      )}

      {tab === 'analytics' && (
        <div className="p-6">
          <AnalyticsPanel
            gradebookId={gradebookId}
            analytics={analytics}
            students={students}
            assessments={assessments}
          />
        </div>
      )}

      {tab === 'imports' && (
        <ImportHistoryTab
          gradebookId={gradebookId}
          importHistory={importHistory}
          onRollback={() => {
            // Reload gradebook
          }}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// MARKBOOK COMPONENT (WITH CALCULATED COLUMNS)
// -------------------------------------------------------------
function Markbook({
  students,
  assessments,
  activeAssessment,
  marks,
  setMarks,
  onAssessmentChange,
  onSave,
  onAddAssessment,
}) {
  // Compute calculated marks in real-time
  const computedMarkMatrix = useMemo(() => {
    if (!activeAssessment) return {};
    const components = activeAssessment.components || [];
    const matrix = {};
    for (const st of students) {
      // Gather current marks for this student
      const studentRawMarks = {};
      components.forEach((c) => {
        studentRawMarks[c.id] = marks[`${st.id}:${c.id}`] || {};
      });
      const calculated = calculateComponentMarks(components, studentRawMarks);
      matrix[st.id] = calculated;
    }
    return matrix;
  }, [activeAssessment, students, marks]);

  const updateMark = (studentId, componentId, field, value) => {
    setMarks((current) => ({
      ...current,
      [`${studentId}:${componentId}`]: {
        ...(current[`${studentId}:${componentId}`] || { student_id: studentId, component_id: componentId }),
        [field]: value,
      },
    }));
  };

  if (!assessments.length) {
    return (
      <div className="p-12 text-center">
        <Layers className="mx-auto h-12 w-12 text-slate-300" />
        <h4 className="mt-3 text-base font-bold text-slate-700">No Assessments Created Yet</h4>
        <p className="mt-1 text-xs text-slate-500">Create an assessment to start entering and calculating marks.</p>
        <button
          type="button"
          onClick={onAddAssessment}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-teal-600"
        >
          <Plus className="h-4 w-4" /> Add First Assessment
        </button>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Assessment:</label>
          <select
            value={activeAssessment?.id || ''}
            onChange={(e) => onAssessmentChange(Number(e.target.value))}
            className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 shadow-xs focus:ring-2 focus:ring-teal-500"
          >
            {assessments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title} ({a.strand || 'General'} · {(a.components || []).length} components)
              </option>
            ))}
          </select>
        </div>
        {activeAssessment && (
          <button
            type="button"
            onClick={onSave}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-teal-700 px-5 text-sm font-bold text-white shadow-sm hover:bg-teal-600 transition"
          >
            <Check className="h-4 w-4" /> Save Marks
          </button>
        )}
      </div>

      {activeAssessment ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs font-black uppercase tracking-wider text-slate-500">
              <tr>
                <th className="sticky left-0 bg-slate-50 px-4 py-3.5 z-10">Student</th>
                {(activeAssessment.components || []).map((component) => (
                  <th
                    key={component.id}
                    className={`px-4 py-3.5 text-center ${
                      component.component_type === 'calculated' ? 'bg-purple-50/80 text-purple-900' : ''
                    }`}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="flex items-center gap-1">
                        {component.component_type === 'calculated' && (
                          <Calculator className="h-3.5 w-3.5 text-purple-600" title="Calculated Component" />
                        )}
                        <span>{component.name}</span>
                      </div>
                      <span className="text-[10px] font-bold text-slate-400">/{component.maximum_score}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {students.map((student) => {
                const computed = computedMarkMatrix[student.id] || {};
                return (
                  <tr key={student.id} className="hover:bg-slate-50/60 transition">
                    <td className="sticky left-0 bg-white px-4 py-3 font-bold text-slate-900 z-10 whitespace-nowrap">
                      {student.display_name}
                      {student.external_student_id && (
                        <span className="ml-2 text-[10px] font-normal text-slate-400">#{student.external_student_id}</span>
                      )}
                    </td>
                    {(activeAssessment.components || []).map((component) => {
                      const isCalc = component.component_type === 'calculated';
                      const entry = marks[`${student.id}:${component.id}`] || {};
                      const calcData = computed[component.id] || {};

                      if (isCalc) {
                        return (
                          <td key={component.id} className="bg-purple-50/30 px-3 py-2 text-center whitespace-nowrap">
                            <div className="inline-flex flex-col items-center justify-center min-w-[70px] rounded-lg bg-purple-100/60 px-2.5 py-1.5">
                              <span className="font-extrabold text-sm text-purple-950">
                                {calcData.score != null ? calcData.score : '—'}
                              </span>
                              {calcData.mark_status && (
                                <span className="mt-0.5 text-[9px] font-bold uppercase text-purple-700">
                                  {calcData.mark_status}
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      }

                      return (
                        <td key={component.id} className="px-3 py-2 text-center whitespace-nowrap">
                          <div className="flex flex-col items-center gap-1">
                            <input
                              type="number"
                              min="0"
                              max={component.maximum_score}
                              step="0.5"
                              value={entry.score ?? ''}
                              onChange={(e) =>
                                updateMark(
                                  student.id,
                                  component.id,
                                  'score',
                                  e.target.value === '' ? null : Number(e.target.value)
                                )
                              }
                              placeholder="—"
                              className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center text-sm font-bold text-slate-800 focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
                            />
                            <select
                              value={entry.mark_status || ''}
                              onChange={(e) => updateMark(student.id, component.id, 'mark_status', e.target.value || null)}
                              className="w-20 rounded-md border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px] font-medium text-slate-600"
                            >
                              <option value="">Status</option>
                              <option value="absent">Absent</option>
                              <option value="missing">Missing</option>
                              <option value="exempt">Exempt</option>
                              <option value="not_started">Not Started</option>
                            </select>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {!students.length && (
                <tr>
                  <td colSpan={2 + (activeAssessment.components?.length || 0)} className="p-8 text-center text-xs text-slate-400 italic">
                    No students enrolled in this gradebook.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------
// GUIDED 4-STEP FINAL GRADES WORKSPACE
// -------------------------------------------------------------
function FinalGradesTab({ gradebookId, assessments, schemes }) {
  const [data, setData] = useState(null);
  const [categories, setCategories] = useState([]);
  const [schemeId, setSchemeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedStudentPopup, setSelectedStudentPopup] = useState(null);

  // Collect all components across all active assessments
  const allComponents = useMemo(() => {
    return assessments.flatMap((assessment) =>
      (assessment.components || []).map((c) => ({
        ...c,
        assessment_id: assessment.id,
        assessment_title: assessment.title,
      }))
    );
  }, [assessments]);

  const toForm = (view) => {
    setData(view);
    setSchemeId(view.config?.scheme_id ? String(view.config.scheme_id) : '');
    if (view.config?.categories?.length) {
      setCategories(
        view.config.categories.map((cat) => ({
          ...cat,
          items: (view.config.items || []).filter((it) => it.category_id === cat.id).map((it) => ({ ...it })),
        }))
      );
    } else {
      // Default: Create category using calculated Totals if available, otherwise components
      const totalsOnly = allComponents.filter((c) => c.component_type === 'calculated' || /total/i.test(c.name));
      const chosen = totalsOnly.length ? totalsOnly : allComponents;
      setCategories([
        {
          name: 'Overall Assessment',
          weight: 100,
          calculation_method: 'weighted_average',
          items: chosen.map((c) => ({ assessment_id: c.assessment_id, component_id: c.id, weight: 1 })),
        },
      ]);
    }
  };

  useEffect(() => {
    threeAlamatakApi.getFinalGrades(gradebookId).then(toForm).catch((e) => setError(e.message));
  }, [gradebookId]);

  const totalWeight = categories.reduce((sum, c) => sum + Number(c.weight || 0), 0);
  const isWeightValid = Math.abs(totalWeight - 100) < 0.001;

  const toggleComponentInCategory = (categoryIdx, component) => {
    setCategories((current) =>
      current.map((cat, idx) => {
        if (idx !== categoryIdx) return cat;
        const exists = cat.items.some((it) => Number(it.component_id) === Number(component.id));
        return {
          ...cat,
          items: exists
            ? cat.items.filter((it) => Number(it.component_id) !== Number(component.id))
            : [...cat.items, { assessment_id: component.assessment_id, component_id: component.id, weight: 1 }],
        };
      })
    );
  };

  const handleAutoSelectTotals = (categoryIdx) => {
    const totals = allComponents.filter((c) => c.component_type === 'calculated' || /total/i.test(c.name));
    const items = (totals.length ? totals : allComponents).map((c) => ({
      assessment_id: c.assessment_id,
      component_id: c.id,
      weight: 1,
    }));
    setCategories((current) =>
      current.map((cat, idx) => (idx === categoryIdx ? { ...cat, items } : cat))
    );
  };

  const handleSaveConfig = async () => {
    setBusy(true);
    try {
      const payload = {
        scheme_id: schemeId ? Number(schemeId) : null,
        categories: categories.map((cat) => ({
          name: cat.name,
          weight: Number(cat.weight),
          calculation_method: cat.calculation_method || 'weighted_average',
          items: (cat.items || []).map((it) => ({
            assessment_id: Number(it.assessment_id),
            component_id: Number(it.component_id),
            weight: Number(it.weight || 1),
          })),
        })),
      };
      const next = await threeAlamatakApi.saveFinalGradeConfig(gradebookId, payload);
      toForm(next);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleFinalize = async () => {
    if (!window.confirm('Finalize final grades? This captures an immutable snapshot. Any subsequent mark changes will mark the result as stale.')) return;
    setBusy(true);
    try {
      const next = await threeAlamatakApi.finalizeFinalGrades(gradebookId);
      toForm(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleExportCsv = async () => {
    try {
      const blob = await threeAlamatakApi.exportFinalGrades(gradebookId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Final_Grades_Report.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
  };

  if (!data) {
    return <div className="p-8 text-center text-xs text-slate-500">Loading final grades workspace…</div>;
  }

  const readiness = data.readiness || {};
  const results = data.results || [];

  return (
    <div className="space-y-6 p-6">
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <h3 className="text-xl font-black text-slate-900">Final Grade Calculation Engine</h3>
          <p className="text-xs text-slate-500">Configure weighting categories, assessment totals, and threshold schemes.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
          <button
            type="button"
            onClick={handleSaveConfig}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2 text-xs font-bold text-white hover:bg-teal-600 shadow-sm disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> Save Configuration
          </button>
          <button
            type="button"
            onClick={handleFinalize}
            disabled={busy || !readiness.valid}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 shadow-sm disabled:opacity-50"
          >
            <Award className="h-3.5 w-3.5 text-amber-400" /> Finalize Grades
          </button>
        </div>
      </div>

      {/* Guided 4-Step Cards */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Step 1 & 2: Categories & Weights */}
        <div className="lg:col-span-2 space-y-4 rounded-2xl border border-slate-200 bg-slate-50/50 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-teal-700">Step 1 & 2: Weighting Categories</span>
            <span
              className={`rounded-lg px-2.5 py-1 text-xs font-extrabold ${
                isWeightValid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }`}
            >
              Total: {totalWeight}% {isWeightValid ? '✓ 100%' : '≠ 100%'}
            </span>
          </div>

          {categories.map((cat, catIdx) => (
            <div key={catIdx} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  value={cat.name}
                  onChange={(e) =>
                    setCategories((cur) =>
                      cur.map((c, i) => (i === catIdx ? { ...c, name: e.target.value } : c))
                    )
                  }
                  placeholder="Category Name"
                  className="min-h-9 flex-1 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-800"
                />
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-400">Weight:</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={cat.weight}
                    onChange={(e) =>
                      setCategories((cur) =>
                        cur.map((c, i) => (i === catIdx ? { ...c, weight: Number(e.target.value) } : c))
                      )
                    }
                    className="w-20 rounded-lg border border-slate-200 px-2.5 py-1.5 text-center text-sm font-extrabold"
                  />
                  <span className="text-xs font-bold text-slate-500">%</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleAutoSelectTotals(catIdx)}
                  className="rounded-lg bg-teal-50 px-2.5 py-1.5 text-xs font-bold text-teal-700 hover:bg-teal-100"
                >
                  Auto-Select Totals
                </button>
              </div>

              <div className="mt-3">
                <p className="text-[11px] font-bold uppercase text-slate-400">Included Assessments / Components:</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {allComponents.map((comp) => {
                    const isSelected = (cat.items || []).some((it) => Number(it.component_id) === Number(comp.id));
                    return (
                      <button
                        type="button"
                        key={comp.id}
                        onClick={() => toggleComponentInCategory(catIdx, comp)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                          isSelected
                            ? 'bg-teal-700 text-white shadow-xs'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {isSelected ? <Check className="h-3 w-3" /> : null}
                        {comp.assessment_title} · {comp.name} (/{comp.maximum_score})
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() =>
              setCategories((cur) => [
                ...cur,
                { name: `Category ${cur.length + 1}`, weight: 0, calculation_method: 'weighted_average', items: [] },
              ])
            }
            className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-700 hover:text-teal-800"
          >
            <Plus className="h-3.5 w-3.5" /> Add Category
          </button>
        </div>

        {/* Step 3: Scheme & Readiness */}
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/50 p-5">
          <span className="text-xs font-black uppercase tracking-wider text-teal-700">Step 3: Grading Scheme</span>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <label className="text-xs font-bold text-slate-500">Active Threshold Scheme:</label>
            <select
              value={schemeId}
              onChange={(e) => setSchemeId(e.target.value)}
              className="mt-2 min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-800"
            >
              <option value="">Default Percentage Scheme (A* - U)</option>
              {schemes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.is_fallback ? '(Fallback)' : ''}
                </option>
              ))}
            </select>

            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="text-[11px] font-bold text-slate-400 uppercase">Readiness Summary:</p>
              <div className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-600">Ready Students:</span>
                  <span className="font-bold text-emerald-700">{readiness.ready_students || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Incomplete:</span>
                  <span className="font-bold text-amber-700">{readiness.incomplete_students || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Absent:</span>
                  <span className="font-bold text-red-700">{readiness.absent_students || 0}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Step 4: Live Preview Table */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-black text-slate-900">Step 4: Live Results & Student Calculation Breakdown</h4>
          <span className="text-xs text-slate-400">Click any student row to view full formula calculation</span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Student</th>
                {categories.map((cat, idx) => (
                  <th key={idx} className="px-4 py-3 text-center">
                    {cat.name} ({cat.weight}%)
                  </th>
                ))}
                <th className="px-4 py-3 text-center">Overall %</th>
                <th className="px-4 py-3 text-center">Grade</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {results.map((res) => (
                <tr
                  key={res.student_id}
                  onClick={() => setSelectedStudentPopup(res)}
                  className="cursor-pointer hover:bg-teal-50/40 transition"
                >
                  <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">
                    {res.display_name}
                  </td>
                  {(res.categories || []).map((cat, cIdx) => (
                    <td key={cIdx} className="px-4 py-3 text-center whitespace-nowrap font-medium text-slate-700">
                      {cat.percent != null ? `${cat.percent.toFixed(1)}%` : '—'}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-center whitespace-nowrap font-black text-teal-800">
                    {res.overall_percent != null ? `${res.overall_percent.toFixed(1)}%` : '—'}
                  </td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    {res.final_grade ? (
                      <span className="rounded-lg bg-teal-100 px-2.5 py-1 text-xs font-black text-teal-900">
                        {res.final_grade}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                        res.status === 'Ready'
                          ? 'bg-emerald-100 text-emerald-800'
                          : res.status === 'Absent'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {res.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Student Breakdown Modal */}
      {selectedStudentPopup && (
        <Modal
          title={`Calculation Breakdown: ${selectedStudentPopup.display_name}`}
          onCancel={() => setSelectedStudentPopup(null)}
        >
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs font-bold text-slate-400 uppercase">Overall Result</p>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="text-2xl font-black text-teal-800">
                  {selectedStudentPopup.overall_percent != null
                    ? `${selectedStudentPopup.overall_percent.toFixed(1)}%`
                    : 'No overall mark'}
                </span>
                {selectedStudentPopup.final_grade && (
                  <span className="rounded-lg bg-teal-100 px-2.5 py-1 text-sm font-black text-teal-900">
                    Grade: {selectedStudentPopup.final_grade}
                  </span>
                )}
                <span className="text-xs font-semibold text-slate-500">({selectedStudentPopup.status})</span>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-black uppercase text-slate-600">Category Contributions</p>
              {(selectedStudentPopup.categories || []).map((cat, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-3.5">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-sm text-slate-900">{cat.name} ({cat.weight}%)</span>
                    <span className="font-black text-sm text-teal-700">
                      {cat.percent != null ? `${cat.percent.toFixed(1)}%` : 'Missing / Incomplete'}
                    </span>
                  </div>
                  <div className="mt-2 divide-y divide-slate-100 text-xs text-slate-600">
                    {(cat.items || []).map((it, j) => (
                      <div key={j} className="py-1.5 flex justify-between">
                        <span>{it.assessment?.title || 'Assessment'} - {it.component?.name || 'Component'}:</span>
                        <span className="font-semibold">
                          {it.score != null ? `${it.score} / ${it.component?.maximum_score}` : (it.status || 'No mark')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setSelectedStudentPopup(null)}
              className="mt-4 w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white hover:bg-slate-800"
            >
              Close Breakdown
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// CUSTOM REPORT BUILDER VIEW
// -------------------------------------------------------------
function ReportsView({
  gradebookId,
  gradebook,
  students,
  assessments,
  analytics,
  marks,
  onExportCsv,
  onExportJson,
  onExportXml,
  onExportHtml,
  onOpenPrint,
}) {
  const [reportType, setReportType] = useState('class'); // student, class, assessment, final_grade, custom
  const [studentFilter, setStudentFilter] = useState('all'); // all, selected, attention, missing, absent
  const [selectedStudentIds, setSelectedStudentIds] = useState(new Set());
  const [assessmentFilter, setAssessmentFilter] = useState('all'); // all, selected
  const [selectedAssessmentIds, setSelectedAssessmentIds] = useState(new Set());
  const [componentFilter, setComponentFilter] = useState('all'); // all, totals_only, input_only
  const [includeScores, setIncludeScores] = useState(true);
  const [includePercentages, setIncludePercentages] = useState(true);
  const [includeGrades, setIncludeGrades] = useState(true);
  const [includeComments, setIncludeComments] = useState(false);

  // Filter students based on selection
  const filteredStudents = useMemo(() => {
    switch (studentFilter) {
      case 'attention':
        const attentionSet = new Set((analytics?.needs_attention || []).map((a) => a.student_id));
        return students.filter((s) => attentionSet.has(s.id));
      case 'selected':
        return students.filter((s) => selectedStudentIds.has(s.id));
      case 'all':
      default:
        return students;
    }
  }, [students, studentFilter, selectedStudentIds, analytics]);

  // Filter assessments
  const filteredAssessments = useMemo(() => {
    if (assessmentFilter === 'selected') {
      return assessments.filter((a) => selectedAssessmentIds.has(a.id));
    }
    return assessments;
  }, [assessments, assessmentFilter, selectedAssessmentIds]);

  const toggleStudent = (id) => {
    setSelectedStudentIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAssessment = (id) => {
    setSelectedAssessmentIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Quick Export Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <button
          type="button"
          onClick={onOpenPrint}
          className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50 transition text-left"
        >
          <Printer className="h-7 w-7 text-teal-700 shrink-0" />
          <div>
            <p className="font-bold text-sm text-slate-900">Print Report</p>
            <p className="text-xs text-slate-500">Formatted print-ready</p>
          </div>
        </button>
        <button
          type="button"
          onClick={onExportCsv}
          className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50 transition text-left"
        >
          <FileSpreadsheet className="h-7 w-7 text-emerald-700 shrink-0" />
          <div>
            <p className="font-bold text-sm text-slate-900">Marks CSV</p>
            <p className="text-xs text-slate-500">Spreadsheet table</p>
          </div>
        </button>
        <button
          type="button"
          onClick={onExportHtml}
          className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50 transition text-left"
        >
          <FileText className="h-7 w-7 text-indigo-700 shrink-0" />
          <div>
            <p className="font-bold text-sm text-slate-900">HTML Copy</p>
            <p className="text-xs text-slate-500">Standalone report</p>
          </div>
        </button>
        <button
          type="button"
          onClick={onExportJson}
          className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50 transition text-left"
        >
          <FileCode className="h-7 w-7 text-purple-700 shrink-0" />
          <div>
            <p className="font-bold text-sm text-slate-900">JSON Snapshot</p>
            <p className="text-xs text-slate-500">Format v1 structure</p>
          </div>
        </button>
      </div>

      {/* Custom Report Builder Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
        <div>
          <h3 className="text-lg font-black text-slate-900">Custom Report Builder</h3>
          <p className="text-xs text-slate-500">Tailor report generation by student, assessment, and content preferences.</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Column 1: Report Type & Students */}
          <div className="space-y-4 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <span className="text-xs font-black uppercase tracking-wider text-slate-600">1. Select Target & Audience</span>
            <div>
              <label className="text-xs font-bold text-slate-500">Report Type:</label>
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
                className="mt-1 min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold"
              >
                <option value="class">Class Performance Summary</option>
                <option value="student">Individual Student Cards</option>
                <option value="assessment">Assessment Item Analysis</option>
                <option value="final_grade">Final Grade Master Sheet</option>
                <option value="custom">Custom Filtered Report</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500">Student Filter:</label>
              <select
                value={studentFilter}
                onChange={(e) => setStudentFilter(e.target.value)}
                className="mt-1 min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold"
              >
                <option value="all">All Enrolled Students ({students.length})</option>
                <option value="attention">Needs Attention Only ({analytics?.needs_attention?.length || 0})</option>
                <option value="selected">Pick Specific Students…</option>
              </select>
            </div>

            {studentFilter === 'selected' && (
              <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-slate-200 bg-white p-2 text-xs">
                {students.map((st) => (
                  <label key={st.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 rounded">
                    <input
                      type="checkbox"
                      checked={selectedStudentIds.has(st.id)}
                      onChange={() => toggleStudent(st.id)}
                      className="rounded text-teal-600"
                    />
                    <span className="truncate">{st.display_name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Column 2: Assessment Filters */}
          <div className="space-y-4 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <span className="text-xs font-black uppercase tracking-wider text-slate-600">2. Assessment Scope</span>
            <div>
              <label className="text-xs font-bold text-slate-500">Assessment Selection:</label>
              <select
                value={assessmentFilter}
                onChange={(e) => setAssessmentFilter(e.target.value)}
                className="mt-1 min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold"
              >
                <option value="all">All Assessments ({assessments.length})</option>
                <option value="selected">Pick Specific Assessments…</option>
              </select>
            </div>

            {assessmentFilter === 'selected' && (
              <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-slate-200 bg-white p-2 text-xs">
                {assessments.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 rounded">
                    <input
                      type="checkbox"
                      checked={selectedAssessmentIds.has(a.id)}
                      onChange={() => toggleAssessment(a.id)}
                      className="rounded text-teal-600"
                    />
                    <span className="truncate">{a.title}</span>
                  </label>
                ))}
              </div>
            )}

            <div>
              <label className="text-xs font-bold text-slate-500">Component Detail:</label>
              <select
                value={componentFilter}
                onChange={(e) => setComponentFilter(e.target.value)}
                className="mt-1 min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold"
              >
                <option value="all">All Components (Input & Totals)</option>
                <option value="totals_only">Calculated Assessment Totals Only</option>
                <option value="input_only">Input Questions Only</option>
              </select>
            </div>
          </div>

          {/* Column 3: Content Options */}
          <div className="space-y-4 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <span className="text-xs font-black uppercase tracking-wider text-slate-600">3. Columns & Details</span>
            <div className="space-y-2 text-xs font-bold text-slate-700">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeScores}
                  onChange={(e) => setIncludeScores(e.target.checked)}
                  className="rounded text-teal-600"
                />
                <span>Raw Scores / Maximum</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includePercentages}
                  onChange={(e) => setIncludePercentages(e.target.checked)}
                  className="rounded text-teal-600"
                />
                <span>Percentages (%)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeGrades}
                  onChange={(e) => setIncludeGrades(e.target.checked)}
                  className="rounded text-teal-600"
                />
                <span>Letter Grades (A* - U)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeComments}
                  onChange={(e) => setIncludeComments(e.target.checked)}
                  className="rounded text-teal-600"
                />
                <span>Teacher Comments & Flags</span>
              </label>
            </div>

            <div className="mt-4 border-t border-slate-200 pt-3">
              <p className="text-[11px] font-black uppercase text-teal-700">Live Preview Counts:</p>
              <p className="mt-1 text-xs text-slate-600 font-semibold">
                {filteredStudents.length} students · {filteredAssessments.length} assessments
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// REAL SETTINGS WORKSPACE (WITH DATA MANAGEMENT & DANGER ZONE)
// -------------------------------------------------------------
function SettingsView({
  gradebook,
  gradebookId,
  schemes,
  checkpoints,
  restorePreview,
  setRestorePreview,
  importHistory,
  onEditGradebook,
  onArchive,
  onRestore,
  onPermanentDelete,
  onExportJson,
  onExportXml,
  onExportHtml,
  onValidateBackup,
  onExecuteRestore,
  onRestoreCheckpoint,
  onDeleteCheckpoint,
  onAddScheme,
  onEditScheme,
  onDeleteScheme,
  onReload,
}) {
  const [activeTab, setActiveTab] = useState('general');

  if (!gradebook || !gradebookId) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <Settings2 className="mx-auto h-12 w-12 text-slate-400" />
        <h3 className="mt-3 text-lg font-bold text-slate-700">No Gradebook Selected</h3>
        <p className="mt-1 text-sm text-slate-500">Please select a gradebook from the sidebar to manage settings.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Settings Navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-100 bg-slate-50/60 p-4">
        {[
          ['general', 'General', Sliders],
          ['grading', 'Grading & Schemes', Award],
          ['data', 'Data & Backups', Database],
          ['danger', 'Danger Zone', ShieldAlert],
        ].map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
              activeTab === key
                ? key === 'danger'
                  ? 'bg-red-700 text-white shadow-xs'
                  : 'bg-teal-700 text-white shadow-xs'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/60'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="p-6">
        {/* General Settings */}
        {activeTab === 'general' && (
          <div className="space-y-6 max-w-2xl">
            <div>
              <h3 className="text-lg font-black text-slate-900">General Gradebook Configuration</h3>
              <p className="text-xs text-slate-500">Manage title, academic year, subject, and classroom information.</p>
            </div>

            <div className="space-y-4 rounded-xl border border-slate-200 p-5 bg-slate-50/40">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase">Title</p>
                  <p className="mt-1 font-bold text-slate-900">{gradebook.title}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase">Academic Year</p>
                  <p className="mt-1 font-bold text-slate-900">{gradebook.academic_year}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase">Subject</p>
                  <p className="mt-1 font-bold text-slate-900">{gradebook.subject || 'ESL'}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase">Class Section</p>
                  <p className="mt-1 font-bold text-slate-900">{gradebook.class_name || 'Standard'}</p>
                </div>
              </div>
              {gradebook.description && (
                <div className="border-t border-slate-200 pt-3">
                  <p className="text-xs font-bold text-slate-400 uppercase">Description</p>
                  <p className="mt-1 text-xs text-slate-700">{gradebook.description}</p>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onEditGradebook}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-xs font-bold text-white hover:bg-teal-600 shadow-sm"
            >
              <Sliders className="h-3.5 w-3.5" /> Edit Metadata
            </button>
          </div>
        )}

        {/* Grading Schemes Settings */}
        {activeTab === 'grading' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900">Grading Schemes & Thresholds</h3>
                <p className="text-xs text-slate-500">Configure letter grade boundary schemes for final grade computation.</p>
              </div>
              <button
                type="button"
                onClick={onAddScheme}
                className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-teal-600 shadow-sm"
              >
                <Plus className="h-3.5 w-3.5" /> New Scheme
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {schemes.map((s) => (
                <div key={s.id} className="rounded-xl border border-slate-200 p-4 bg-white">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-slate-900 text-sm">{s.name}</span>
                    {s.is_fallback && <span className="text-[10px] font-bold text-teal-700">Fallback</span>}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onEditScheme(s)}
                      className="text-xs font-bold text-teal-700 hover:underline"
                    >
                      Edit Boundaries
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteScheme(s.id)}
                      className="text-xs font-bold text-red-600 hover:underline ml-2"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Data & Backup Management */}
        {activeTab === 'data' && (
          <BackupRestoreView
            gradebookId={gradebookId}
            gradebook={gradebook}
            checkpoints={checkpoints}
            restorePreview={restorePreview}
            setRestorePreview={setRestorePreview}
            onExportCanonicalJson={onExportJson}
            onExportXml={onExportXml}
            onExportHtml={onExportHtml}
            onValidateBackup={onValidateBackup}
            onExecuteRestore={onExecuteRestore}
            onRestoreCheckpoint={onRestoreCheckpoint}
            onDeleteCheckpoint={onDeleteCheckpoint}
          />
        )}

        {/* Danger Zone */}
        {activeTab === 'danger' && (
          <div className="space-y-6 max-w-2xl">
            <div className="rounded-2xl border border-red-200 bg-red-50/40 p-6 space-y-4">
              <div className="flex items-center gap-2 text-red-700 font-black">
                <ShieldAlert className="h-5 w-5" />
                <span>Destructive Operations</span>
              </div>
              <p className="text-xs text-red-600">
                Exercise caution. These actions modify the lifecycle of this gradebook.
              </p>

              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between rounded-xl bg-white p-4 border border-red-100">
                  <div>
                    <p className="font-bold text-sm text-slate-900">Archive Gradebook</p>
                    <p className="text-xs text-slate-500">Hide from active workspaces. Can be restored anytime.</p>
                  </div>
                  <button
                    type="button"
                    onClick={onArchive}
                    className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100"
                  >
                    Archive
                  </button>
                </div>

                <div className="flex items-center justify-between rounded-xl bg-white p-4 border border-red-100">
                  <div>
                    <p className="font-bold text-sm text-red-900">Permanent Deletion</p>
                    <p className="text-xs text-red-500">Completely erase gradebook, marks, students, and history.</p>
                  </div>
                  <button
                    type="button"
                    onClick={onPermanentDelete}
                    className="rounded-xl bg-red-700 px-4 py-2 text-xs font-bold text-white hover:bg-red-800"
                  >
                    Delete Permanently
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// BACKUP & RESTORE VIEW
// -------------------------------------------------------------
function BackupRestoreView({
  gradebookId,
  gradebook,
  checkpoints,
  restorePreview,
  setRestorePreview,
  onExportCanonicalJson,
  onExportXml,
  onExportHtml,
  onValidateBackup,
  onExecuteRestore,
  onRestoreCheckpoint,
  onDeleteCheckpoint,
}) {
  const comparison = restorePreview?.validation?.comparison;
  const isValid = restorePreview?.validation?.valid;
  const warnings = restorePreview?.validation?.warnings || [];
  const errors = restorePreview?.validation?.errors || [];

  return (
    <div className="space-y-6">
      {/* 1. Export Backups Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Database className="h-6 w-6 text-teal-700" />
          <div>
            <h3 className="text-base font-black text-slate-900">Download Backups & Exports</h3>
            <p className="text-xs text-slate-500">Canonical Format v1 JSON captures complete relational state.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onExportCanonicalJson}
            className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-teal-700 px-4 text-xs font-bold text-white hover:bg-teal-600 shadow-sm"
          >
            <Download className="h-3.5 w-3.5" /> Canonical JSON (v1)
          </button>
          <button
            type="button"
            onClick={onExportHtml}
            className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <FileText className="h-3.5 w-3.5" /> Standalone HTML Report
          </button>
          <button
            type="button"
            onClick={onExportXml}
            className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <FileCode className="h-3.5 w-3.5" /> Legacy XML Export
          </button>
        </div>
      </div>

      {/* 2. Restore Backup Dropzone */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Upload className="h-6 w-6 text-teal-700" />
          <div>
            <h3 className="text-base font-black text-slate-900">Upload & Validate Backup File</h3>
            <p className="text-xs text-slate-500">Performs dry-run comparison and verification before replacing data.</p>
          </div>
        </div>

        <div className="mt-4">
          <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 p-6 hover:border-teal-500 cursor-pointer bg-slate-50/50">
            <Upload className="h-8 w-8 text-slate-400 mb-2" />
            <span className="text-xs font-bold text-slate-700">Choose Backup JSON / XML / HTML file</span>
            <input
              type="file"
              accept=".json,.xml,.html"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const formData = new FormData();
                  formData.append('backupFile', file);
                  onValidateBackup(formData);
                }
              }}
              className="hidden"
            />
          </label>
        </div>

        {/* Pre-Restore Diff Comparison */}
        {restorePreview && (
          <div className="mt-5 rounded-xl border border-slate-200 p-4 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <span className="font-black text-sm text-slate-900">Pre-Restore Diff Verification</span>
              <span
                className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                  isValid ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                }`}
              >
                {isValid ? 'Valid Format v1' : 'Validation Failed'}
              </span>
            </div>

            {comparison && (
              <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                <div className="rounded-lg bg-white p-2 border border-slate-200">
                  <span className="text-slate-400 font-bold block">Students</span>
                  <span className="font-extrabold text-slate-800">{comparison.students?.current} → {comparison.students?.incoming}</span>
                </div>
                <div className="rounded-lg bg-white p-2 border border-slate-200">
                  <span className="text-slate-400 font-bold block">Assessments</span>
                  <span className="font-extrabold text-slate-800">{comparison.assessments?.current} → {comparison.assessments?.incoming}</span>
                </div>
                <div className="rounded-lg bg-white p-2 border border-slate-200">
                  <span className="text-slate-400 font-bold block">Marks</span>
                  <span className="font-extrabold text-slate-800">{comparison.marks?.current} → {comparison.marks?.incoming}</span>
                </div>
                <div className="rounded-lg bg-white p-2 border border-slate-200">
                  <span className="text-slate-400 font-bold block">Schemes</span>
                  <span className="font-extrabold text-slate-800">{comparison.grading_schemes?.current} → {comparison.grading_schemes?.incoming}</span>
                </div>
              </div>
            )}

            {errors.length > 0 && (
              <div className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">
                {errors.map((err, i) => <p key={i}>• {err}</p>)}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={onExecuteRestore}
                disabled={!isValid}
                className="rounded-xl bg-teal-700 px-4 py-2 text-xs font-bold text-white hover:bg-teal-600 disabled:opacity-50"
              >
                Execute Replace Restore
              </button>
              <button
                type="button"
                onClick={() => setRestorePreview(null)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. Automatic Recovery Checkpoints */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <History className="h-6 w-6 text-teal-700" />
          <div>
            <h3 className="text-base font-black text-slate-900">Automatic Recovery Checkpoints</h3>
            <p className="text-xs text-slate-500">Auto-captured snapshots created prior to replace restore operations.</p>
          </div>
        </div>

        <div className="mt-4 divide-y divide-slate-100">
          {checkpoints.map((chk) => (
            <div key={chk.id} className="py-3 flex items-center justify-between">
              <div>
                <p className="font-bold text-sm text-slate-800">{chk.label || `Checkpoint #${chk.id}`}</p>
                <p className="text-xs text-slate-400">{chk.created_at || 'Just now'} · Reason: {chk.reason || 'pre_restore'}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onRestoreCheckpoint(chk.id)}
                  className="rounded-lg bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-700 hover:bg-teal-100"
                >
                  Rollback
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteCheckpoint(chk.id)}
                  className="rounded-lg p-1.5 text-slate-400 hover:text-red-600"
                  title="Delete checkpoint"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
          {!checkpoints.length && (
            <p className="py-6 text-center text-xs text-slate-400 italic">No recovery checkpoints created yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// ASSESSMENT FORM MODAL (SUPPORTING INPUT & CALCULATED TOTALS)
// -------------------------------------------------------------
function AssessmentForm({ assessment, onCancel, onSubmit }) {
  const [form, setForm] = useState(() =>
    assessment
      ? {
          title: assessment.title || '',
          strand: assessment.strand || 'General',
          topic: assessment.topic || '',
          assessment_date: assessment.assessment_date || '',
          components: (assessment.components || []).map((c, i) => ({
            id: c.id ? String(c.id) : `comp_${i}`,
            name: c.name || '',
            maximum_score: Number(c.maximum_score || 10),
            component_type: c.component_type || 'input',
            calculation_type: c.calculation_type || 'sum',
            source_component_ids: Array.isArray(c.source_component_ids) ? c.source_component_ids.map(String) : [],
          })),
        }
      : {
          title: '',
          strand: 'General',
          topic: '',
          assessment_date: '',
          components: [
            { id: 'comp_0', name: 'Q1', maximum_score: 10, component_type: 'input', calculation_type: 'sum', source_component_ids: [] },
            { id: 'comp_1', name: 'Q2', maximum_score: 10, component_type: 'input', calculation_type: 'sum', source_component_ids: [] },
            { id: 'comp_2', name: 'Total', maximum_score: 20, component_type: 'calculated', calculation_type: 'sum', source_component_ids: ['comp_0', 'comp_1'] },
          ],
        }
  );

  // Live validation & max score computation
  const validation = useMemo(() => {
    return validateComponentDefinitions(form.components);
  }, [form.components]);

  const updateComponent = (index, updates) => {
    setForm((cur) => ({
      ...cur,
      components: cur.components.map((c, i) => (i === index ? { ...c, ...updates } : c)),
    }));
  };

  const addInputComponent = () => {
    const newId = `comp_${Date.now()}`;
    setForm((cur) => ({
      ...cur,
      components: [
        ...cur.components,
        { id: newId, name: `Question ${cur.components.length + 1}`, maximum_score: 10, component_type: 'input', calculation_type: 'sum', source_component_ids: [] },
      ],
    }));
  };

  const addCalculatedTotal = () => {
    const newId = `comp_${Date.now()}`;
    // Auto-select all input components
    const inputIds = form.components.filter((c) => c.component_type === 'input').map((c) => c.id);
    setForm((cur) => ({
      ...cur,
      components: [
        ...cur.components,
        { id: newId, name: 'Total', maximum_score: 0, component_type: 'calculated', calculation_type: 'sum', source_component_ids: inputIds },
      ],
    }));
  };

  const removeComponent = (index) => {
    setForm((cur) => ({
      ...cur,
      components: cur.components.filter((_, i) => i !== index),
    }));
  };

  const toggleSourceId = (compIndex, srcId) => {
    const comp = form.components[compIndex];
    const curIds = comp.source_component_ids || [];
    const nextIds = curIds.includes(srcId) ? curIds.filter((id) => id !== srcId) : [...curIds, srcId];
    updateComponent(compIndex, { source_component_ids: nextIds });
  };

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!form.title.trim()) {
      alert('Please enter an assessment title.');
      return;
    }
    if (!validation.valid) {
      alert(`Please fix calculation errors:\n${validation.errors.join('\n')}`);
      return;
    }
    onSubmit({
      ...form,
      components: validation.components,
    });
  };

  return (
    <Modal title={assessment ? 'Edit Assessment' : 'New Assessment'} onCancel={onCancel}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Assessment Title" value={form.title} onChange={(val) => setForm({ ...form, title: val })} placeholder="e.g. Midterm Exam" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Strand / Category" value={form.strand} onChange={(val) => setForm({ ...form, strand: val })} />
          <Field label="Date" type="date" value={form.assessment_date} onChange={(val) => setForm({ ...form, assessment_date: val })} />
        </div>

        {/* Components List */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-slate-700">Assessment Components</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={addInputComponent}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200"
              >
                <Plus className="h-3 w-3" /> Input Question
              </button>
              <button
                type="button"
                onClick={addCalculatedTotal}
                className="inline-flex items-center gap-1 rounded-lg bg-purple-100 px-2.5 py-1 text-xs font-bold text-purple-800 hover:bg-purple-200"
              >
                <Calculator className="h-3 w-3" /> Calculated Total
              </button>
            </div>
          </div>

          {form.components.map((comp, idx) => {
            const isCalc = comp.component_type === 'calculated';
            const calcComp = validation.components.find((c) => c.id === comp.id);
            const computedMax = calcComp ? calcComp.maximum_score : comp.maximum_score;

            return (
              <div
                key={comp.id || idx}
                className={`rounded-xl border p-3.5 space-y-2.5 transition ${
                  isCalc ? 'border-purple-200 bg-purple-50/30' : 'border-slate-200 bg-slate-50/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-extrabold text-slate-400">#{idx + 1}</span>
                  <input
                    value={comp.name}
                    onChange={(e) => updateComponent(idx, { name: e.target.value })}
                    placeholder="Component Name (e.g. Q1, Total)"
                    className="min-h-9 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-900"
                  />
                  <select
                    value={comp.component_type}
                    onChange={(e) => updateComponent(idx, { component_type: e.target.value })}
                    className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700"
                  >
                    <option value="input">Input</option>
                    <option value="calculated">Calculated</option>
                  </select>

                  {isCalc ? (
                    <div className="inline-flex min-h-9 items-center justify-center rounded-lg bg-purple-100 px-3 text-xs font-extrabold text-purple-900">
                      /{computedMax}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-bold text-slate-400">/</span>
                      <input
                        type="number"
                        min="1"
                        value={comp.maximum_score}
                        onChange={(e) => updateComponent(idx, { maximum_score: Number(e.target.value) })}
                        className="w-16 min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-center text-xs font-bold"
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => removeComponent(idx)}
                    className="p-1.5 text-slate-400 hover:text-red-600 rounded"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Source components selection for calculated components */}
                {isCalc && (
                  <div className="rounded-lg bg-white p-2.5 border border-purple-100 space-y-1.5">
                    <p className="text-[10px] font-black uppercase text-purple-800">Select Contributing Questions / Components:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {form.components
                        .filter((c, i) => i !== idx) // Prevent self
                        .map((c) => {
                          const isSelected = (comp.source_component_ids || []).includes(c.id);
                          return (
                            <button
                              type="button"
                              key={c.id}
                              onClick={() => toggleSourceId(idx, c.id)}
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ${
                                isSelected
                                  ? 'bg-purple-700 text-white'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              {isSelected ? <Check className="h-3 w-3" /> : null}
                              {c.name || 'Unnamed'} (/{c.maximum_score})
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Live Validation Alert */}
        {!validation.valid && (
          <div className="rounded-xl bg-amber-50 p-3 border border-amber-200 text-xs text-amber-900">
            <span className="font-bold block mb-1">Calculation Warnings:</span>
            {validation.errors.map((err, i) => (
              <p key={i}>• {err}</p>
            ))}
          </div>
        )}

        <FormActions onCancel={onCancel} onSubmit={handleSubmit} label={assessment ? 'Save Assessment' : 'Create Assessment'} />
      </form>
    </Modal>
  );
}

// -------------------------------------------------------------
// AUXILIARY TABS & VIEWS (STUDENTS, SCHEMES, RECORDS, IMPORTS)
// -------------------------------------------------------------
function StudentsView({ gradebookId, students, search, onSearchChange, onAddStudent, onEditStudent, onReload }) {
  const filtered = useMemo(() => {
    const q = (search || '').toLowerCase();
    return students.filter((s) => s.display_name?.toLowerCase().includes(q) || s.external_student_id?.includes(q));
  }, [students, search]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2 flex-1 max-w-sm">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search students by name or ID…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold"
          />
        </div>
        <div className="flex items-center gap-2">
          <DuplicateReview gradebookId={gradebookId} onMerged={onReload} />
          <button
            type="button"
            onClick={onAddStudent}
            className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-teal-600"
          >
            <Plus className="h-4 w-4" /> Add Student
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Student ID</th>
              <th className="px-4 py-3">Full Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {filtered.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50/50">
                <td className="px-4 py-3 text-xs font-bold text-slate-400">
                  {s.external_student_id || `#${s.id}`}
                </td>
                <td className="px-4 py-3 font-bold text-slate-900">{s.display_name}</td>
                <td className="px-4 py-3">
                  <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 uppercase">
                    {s.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button
                    type="button"
                    onClick={() => onEditStudent(s)}
                    className="text-xs font-bold text-teal-700 hover:underline"
                  >
                    Edit
                  </button>
                  <AliasManager gradebookId={gradebookId} student={s} />
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-xs text-slate-400 italic">
                  No students found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SchemesTab({ schemes, onAddScheme, onEditScheme, onDeleteScheme }) {
  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-black text-slate-900">Grading Schemes & Boundaries</h3>
          <p className="text-xs text-slate-500">Threshold matrices used for calculating final letter grades.</p>
        </div>
        <button
          type="button"
          onClick={onAddScheme}
          className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-teal-600"
        >
          <Plus className="h-3.5 w-3.5" /> Add Scheme
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {schemes.map((s) => (
          <div key={s.id} className="rounded-xl border border-slate-200 p-4 bg-white shadow-xs">
            <div className="flex justify-between items-center">
              <span className="font-black text-sm text-slate-900">{s.name}</span>
              {s.is_fallback && <span className="text-[10px] font-bold text-teal-700">Fallback</span>}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => onEditScheme(s)}
                className="text-xs font-bold text-teal-700 hover:underline"
              >
                Edit Boundaries
              </button>
              <button
                type="button"
                onClick={() => onDeleteScheme(s.id)}
                className="text-xs font-bold text-red-600 hover:underline ml-2"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {!schemes.length && (
          <p className="col-span-full py-8 text-center text-xs text-slate-400 italic">No custom grading schemes configured.</p>
        )}
      </div>
    </div>
  );
}

function RecordsTab({ records, students, onAddRecord, onEditRecord, onDeleteRecord }) {
  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-black text-slate-900">Supporting Records & History</h3>
          <p className="text-xs text-slate-500">Conduct notes, assignment tracking, and team project records.</p>
        </div>
        <button
          type="button"
          onClick={onAddRecord}
          className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-teal-600"
        >
          <Plus className="h-3.5 w-3.5" /> Add Record
        </button>
      </div>

      <div className="divide-y divide-slate-100">
        {records.map((r) => (
          <div key={r.id} className="py-3 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 uppercase">
                  {r.record_type}
                </span>
                <span className="font-bold text-sm text-slate-800">
                  {r.student_name || 'General Record'}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{JSON.stringify(r.payload || {})}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onEditRecord(r)}
                className="text-xs font-bold text-teal-700 hover:underline"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onDeleteRecord(r.id)}
                className="text-xs font-bold text-red-600 hover:underline ml-2"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {!records.length && (
          <p className="py-8 text-center text-xs text-slate-400 italic">No supporting records recorded yet.</p>
        )}
      </div>
    </div>
  );
}

function ImportHistoryTab({ gradebookId, importHistory, onRollback }) {
  const handleRollback = async (importId) => {
    if (!window.confirm('Rollback this specific import batch? Any marks and assessments introduced in this import will be removed.')) return;
    try {
      await threeAlamatakApi.rollbackImport(gradebookId, importId);
      alert('Import batch rolled back successfully.');
      onRollback?.();
    } catch (e) {
      alert(`Rollback failed: ${e.message}`);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-4">
        <h3 className="font-black text-slate-900">Workbook Import History</h3>
        <p className="text-xs text-slate-500">Lineage tracking of uploaded spreadsheet workbooks with isolated batch rollback.</p>
      </div>

      <div className="divide-y divide-slate-100">
        {importHistory.map((imp) => (
          <div key={imp.id} className="py-3.5 flex items-center justify-between">
            <div>
              <p className="font-bold text-sm text-slate-800">{imp.file_name || `Import #${imp.id}`}</p>
              <p className="text-xs text-slate-400">
                {imp.created_at} · Status: {imp.status} · {imp.sheet_count || 0} sheets processed
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleRollback(imp.id)}
              className="rounded-xl border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
            >
              Rollback Batch
            </button>
          </div>
        ))}
        {!importHistory.length && (
          <p className="py-8 text-center text-xs text-slate-400 italic">No spreadsheet imports recorded for this gradebook.</p>
        )}
      </div>
    </div>
  );
}

function AnalyticsPanel({ gradebookId, analytics, students, assessments }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 p-4 bg-white">
          <p className="text-xs font-bold text-slate-400 uppercase">Class Median</p>
          <p className="mt-1 text-2xl font-black text-slate-900">
            {analytics?.median != null ? `${analytics.median.toFixed(1)}%` : '—'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 p-4 bg-white">
          <p className="text-xs font-bold text-slate-400 uppercase">Highest Mark</p>
          <p className="mt-1 text-2xl font-black text-emerald-700">
            {analytics?.highest != null ? `${analytics.highest.toFixed(1)}%` : '—'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 p-4 bg-white">
          <p className="text-xs font-bold text-slate-400 uppercase">Lowest Mark</p>
          <p className="mt-1 text-2xl font-black text-red-700">
            {analytics?.lowest != null ? `${analytics.lowest.toFixed(1)}%` : '—'}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 p-5 bg-white space-y-3">
        <h4 className="font-black text-slate-900 text-sm">Students Needing Attention</h4>
        <div className="divide-y divide-slate-100">
          {(analytics?.needs_attention || []).map((att, i) => (
            <div key={i} className="py-2.5 flex items-center justify-between">
              <div>
                <p className="font-bold text-sm text-slate-800">{att.student_name || `Student #${att.student_id}`}</p>
                <p className="text-xs text-amber-700 font-medium">{att.reason || 'Flagged for review'}</p>
              </div>
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900 uppercase">
                Attention
              </span>
            </div>
          ))}
          {!(analytics?.needs_attention?.length) && (
            <p className="py-4 text-center text-xs text-slate-400 italic">No students currently flagged for intervention.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// WORKBOOK IMPORTER VIEW
// -------------------------------------------------------------
function ImportView({
  gradebookId,
  students,
  assessments,
  importPreview,
  setImportPreview,
  studentResolutions,
  setStudentResolutions,
  onSuccess,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleFileUpload = async (file) => {
    if (!gradebookId || !file) return;
    try {
      setBusy(true);
      setError('');
      const preview = await threeAlamatakApi.analyzeWorkbook(gradebookId, file);
      setImportPreview({ preview, file });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!gradebookId || !importPreview?.file) return;
    try {
      setBusy(true);
      await threeAlamatakApi.importPackage(gradebookId, importPreview.file);
      alert('Workbook imported successfully.');
      setImportPreview(null);
      onSuccess?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
      <div>
        <h3 className="text-lg font-black text-slate-900">Spreadsheet Importer</h3>
        <p className="text-xs text-slate-500">Supports multi-sheet XLSX workbooks, CSV, and TSV files with canonical roster detection.</p>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 p-3 text-xs text-red-700 font-bold">
          {error}
        </div>
      )}

      {!importPreview ? (
        <label className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 p-10 hover:border-teal-600 cursor-pointer bg-slate-50/50 transition">
          <Upload className="h-10 w-10 text-slate-400 mb-2" />
          <span className="text-sm font-bold text-slate-700">Choose Excel (.xlsx) or CSV file</span>
          <span className="text-xs text-slate-400 mt-1">Upload real school markbooks (up to 20MB)</span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.tsv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
            }}
            className="hidden"
          />
        </label>
      ) : (
        <div className="space-y-4 rounded-xl border border-slate-200 p-5 bg-slate-50/50">
          <div className="flex justify-between items-center">
            <span className="font-black text-slate-900">Workbook Classification Summary</span>
            <span className="text-xs text-slate-500 font-bold">{importPreview.file.name}</span>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleCommit}
              disabled={busy}
              className="rounded-xl bg-teal-700 px-5 py-2 text-xs font-bold text-white hover:bg-teal-600 disabled:opacity-50"
            >
              Commit Import
            </button>
            <button
              type="button"
              onClick={() => setImportPreview(null)}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// HELPER DIALOGS & FORMS
// -------------------------------------------------------------
function DuplicateReview({ gradebookId, onMerged }) {
  const [open, setOpen] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const [busy, setBusy] = useState(false);

  const loadDuplicates = async () => {
    try {
      setBusy(true);
      const list = await threeAlamatakApi.listDuplicateStudents(gradebookId);
      setDuplicates(list || []);
      setOpen(true);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleMerge = async (survivorId, duplicateId) => {
    if (!window.confirm('Merge duplicate student? Marks and aliases will be safely transferred.')) return;
    try {
      await threeAlamatakApi.mergeStudents(gradebookId, { survivor_id: survivorId, duplicate_id: duplicateId });
      alert('Students merged successfully.');
      setOpen(false);
      onMerged?.();
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={loadDuplicates}
        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
      >
        Review Duplicates
      </button>
      {open && (
        <Modal title="Duplicate Student Review" onCancel={() => setOpen(false)}>
          <div className="space-y-3">
            {duplicates.map((d, i) => (
              <div key={i} className="flex justify-between items-center p-3 border rounded-xl">
                <div>
                  <p className="font-bold text-sm">{d.candidate_name}</p>
                  <p className="text-xs text-slate-400">Match similarity: {Math.round(d.similarity * 100)}%</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleMerge(d.survivor_id, d.duplicate_id)}
                  className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-bold text-white"
                >
                  Merge
                </button>
              </div>
            ))}
            {!duplicates.length && <p className="text-xs text-slate-500 italic">No duplicate students detected.</p>}
          </div>
        </Modal>
      )}
    </>
  );
}

function AliasManager({ gradebookId, student }) {
  const [open, setOpen] = useState(false);
  const [aliases, setAliases] = useState([]);
  const [aliasInput, setAliasInput] = useState('');

  const load = async () => {
    try {
      const list = await threeAlamatakApi.listStudentAliases(gradebookId, student.id);
      setAliases(list || []);
      setOpen(true);
    } catch (e) {
      alert(e.message);
    }
  };

  const handleAdd = async () => {
    if (!aliasInput.trim()) return;
    try {
      await threeAlamatakApi.addStudentAlias(gradebookId, student.id, aliasInput.trim());
      setAliasInput('');
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleRemove = async (aliasId) => {
    try {
      await threeAlamatakApi.removeStudentAlias(gradebookId, student.id, aliasId);
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <>
      <button type="button" onClick={load} className="text-xs font-bold text-slate-500 hover:underline">
        Aliases ({aliases.length || 0})
      </button>
      {open && (
        <Modal title={`Name Aliases for ${student.display_name}`} onCancel={() => setOpen(false)}>
          <div className="space-y-4">
            <div className="flex gap-2">
              <input
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                placeholder="Add alternate name variant…"
                className="flex-1 rounded-xl border border-slate-200 px-3 text-xs"
              />
              <button
                type="button"
                onClick={handleAdd}
                className="rounded-xl bg-teal-700 px-4 py-2 text-xs font-bold text-white"
              >
                Add
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {aliases.map((al) => (
                <div key={al.id} className="py-2 flex justify-between items-center text-xs">
                  <span>{al.alias_name}</span>
                  <button type="button" onClick={() => handleRemove(al.id)} className="text-red-600 font-bold">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function PrintReportModal({ gradebook, students, assessments, marks, analytics, onClose }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 p-4 sm:p-6 backdrop-blur-xs flex items-center justify-center">
      <div className="w-full max-w-4xl rounded-2xl bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center border-b pb-3">
          <div>
            <h3 className="font-black text-lg text-slate-900">{gradebook?.title} Report Card</h3>
            <p className="text-xs text-slate-500">{gradebook?.subject || 'General'} · {gradebook?.academic_year}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-xl bg-teal-700 px-4 py-2 text-xs font-bold text-white"
            >
              Print
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold"
            >
              Close
            </button>
          </div>
        </div>

        <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
          <thead>
            <tr className="bg-slate-50">
              <th className="p-2">Student</th>
              {assessments.map((a) => (
                <th key={a.id} className="p-2 text-center">{a.title}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {students.map((s) => (
              <tr key={s.id}>
                <td className="p-2 font-bold">{s.display_name}</td>
                {assessments.map((a) => {
                  const comps = a.components || [];
                  const compScores = comps.map((c) => marks[`${s.id}:${c.id}`]?.score).filter((sc) => sc != null);
                  const sum = compScores.reduce((acc, v) => acc + v, 0);
                  return (
                    <td key={a.id} className="p-2 text-center">
                      {compScores.length ? sum : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GradebookForm({ gradebook, onCancel, onSubmit }) {
  const [title, setTitle] = useState(gradebook?.title || '');
  const [academicYear, setAcademicYear] = useState(gradebook?.academic_year || '2025–2026');
  const [subject, setSubject] = useState(gradebook?.subject || 'ESL');
  const [className, setClassName] = useState(gradebook?.class_name || 'Year 9');
  const [description, setDescription] = useState(gradebook?.description || '');

  return (
    <Modal title={gradebook ? 'Edit Gradebook' : 'Create Gradebook'} onCancel={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ title, academic_year: academicYear, subject, class_name: className, description });
        }}
        className="space-y-4"
      >
        <Field label="Gradebook Title" value={title} onChange={setTitle} placeholder="e.g. Year 9 ESL" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Academic Year" value={academicYear} onChange={setAcademicYear} />
          <Field label="Subject" value={subject} onChange={setSubject} />
        </div>
        <Field label="Class Section" value={className} onChange={setClassName} />
        <Field label="Description (Optional)" value={description} onChange={setDescription} />
        <FormActions onCancel={onCancel} label={gradebook ? 'Save Changes' : 'Create Gradebook'} />
      </form>
    </Modal>
  );
}

function StudentForm({ student, onCancel, onSubmit }) {
  const [name, setName] = useState(student?.display_name || '');
  const [externalId, setExternalId] = useState(student?.external_student_id || '');

  return (
    <Modal title={student ? 'Edit Student' : 'Add Student'} onCancel={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ display_name: name, external_student_id: externalId });
        }}
        className="space-y-4"
      >
        <Field label="Full Name" value={name} onChange={setName} placeholder="Student Name" />
        <Field label="Student ID (Optional)" value={externalId} onChange={setExternalId} />
        <FormActions onCancel={onCancel} label={student ? 'Save Changes' : 'Add Student'} />
      </form>
    </Modal>
  );
}

function SchemeForm({ scheme, onCancel, onSubmit }) {
  const [name, setName] = useState(scheme?.name || '');

  return (
    <Modal title={scheme ? 'Edit Grading Scheme' : 'New Grading Scheme'} onCancel={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ name });
        }}
        className="space-y-4"
      >
        <Field label="Scheme Name" value={name} onChange={setName} placeholder="e.g. Cambridge IGCSE Boundaries" />
        <FormActions onCancel={onCancel} label={scheme ? 'Save Scheme' : 'Create Scheme'} />
      </form>
    </Modal>
  );
}

function RecordForm({ record, students, onCancel, onSubmit }) {
  const [recordType, setRecordType] = useState(record?.record_type || 'behavior');
  const [studentId, setStudentId] = useState(record?.student_id || '');
  const [notes, setNotes] = useState(record?.payload?.notes || '');

  return (
    <Modal title={record ? 'Edit Record' : 'Add Record'} onCancel={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ record_type: recordType, student_id: studentId || null, payload: { notes } });
        }}
        className="space-y-4"
      >
        <div>
          <label className="text-xs font-bold text-slate-500">Record Type</label>
          <select
            value={recordType}
            onChange={(e) => setRecordType(e.target.value)}
            className="mt-1 min-h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold"
          >
            <option value="behavior">Behavior / Conduct</option>
            <option value="submission">Assignment Submission</option>
            <option value="team_project">Team Project</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500">Student (Optional)</label>
          <select
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            className="mt-1 min-h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold"
          >
            <option value="">General (No specific student)</option>
            {students.map((st) => (
              <option key={st.id} value={st.id}>
                {st.display_name}
              </option>
            ))}
          </select>
        </div>
        <Field label="Notes / Content" value={notes} onChange={setNotes} />
        <FormActions onCancel={onCancel} label={record ? 'Save Changes' : 'Create Record'} />
      </form>
    </Modal>
  );
}

function Modal({ title, children, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="text-base font-black text-slate-900">{title}</h3>
          <button type="button" onClick={onCancel} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder = '', type = 'text' }) {
  return (
    <div>
      <label className="text-xs font-bold text-slate-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-xs focus:ring-2 focus:ring-teal-500"
      />
    </div>
  );
}

function FormActions({ onCancel, onSubmit, label = 'Submit' }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t pt-4">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSubmit}
        className="rounded-xl bg-teal-700 px-4 py-2 text-xs font-bold text-white hover:bg-teal-600 shadow-sm"
      >
        {label}
      </button>
    </div>
  );
}

function UnauthorizedThreeAlamatak({ onLogin }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 p-6 text-center">
      <GraduationCap className="h-16 w-16 text-teal-600 mb-4" />
      <h2 className="text-2xl font-black text-slate-900">3alamatak Teacher Workspace</h2>
      <p className="mt-2 text-sm text-slate-500 max-w-sm">
        Please sign in with your instructor account to access your gradebooks and student marks.
      </p>
      <button
        type="button"
        onClick={onLogin}
        className="mt-6 rounded-xl bg-teal-700 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-teal-600"
      >
        Sign In
      </button>
    </div>
  );
}
