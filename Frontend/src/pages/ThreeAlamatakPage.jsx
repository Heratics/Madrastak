import { useContext, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  Award,
  BarChart3,
  BookOpen,
  Check,
  CheckCircle2,
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
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings2,
  Sliders,
  Trash2,
  Upload,
  UserCheck,
  Users,
  X,
  AlertTriangle,
} from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import AccountStatus from './AccountStatus';
import { threeAlamatakApi } from '../features/threeAlamatak/services/threeAlamatakApi';
import {
  readXlsxWorkbook,
  classifyWorkbook,
  parseDelimited,
  buildWorkbookImportPackage,
  exportGradebookToXml,
  parseGradebookXml,
  exportGradebookToHtml,
  parseGradebookHtml,
} from '../features/threeAlamatak/utils/workbookParser';
import { assessmentState, computeFinalGrade, gradeFor } from '../features/threeAlamatak/utils/gradeCalculations';

const views = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['classes', 'Gradebooks', BookOpen],
  ['students', 'Students', Users],
  ['imports', 'Import', Upload],
  ['reports', 'Reports', BarChart3],
  ['settings', 'Settings', Settings2],
];

export default function ThreeAlamatakPage() {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const [view, setView] = useState('dashboard');
  const [gradebooks, setGradebooks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [gradebook, setGradebook] = useState(null);
  const [students, setStudents] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [schemes, setSchemes] = useState([]);
  const [historicalRecords, setHistoricalRecords] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [activeAssessmentId, setActiveAssessmentId] = useState(null);
  const [marks, setMarks] = useState({});
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [showGradebookForm, setShowGradebookForm] = useState(false);
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [showAssessmentForm, setShowAssessmentForm] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [editingAssessment, setEditingAssessment] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [showSchemeForm, setShowSchemeForm] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [studentResolutions, setStudentResolutions] = useState({});

  const loadGradebooks = async (preferredId = selectedId) => {
    setBusy(true);
    try {
      const data = await threeAlamatakApi.listGradebooks();
      setGradebooks(data);
      const nextId = preferredId && data.some((item) => item.id === preferredId) ? preferredId : data[0]?.id || null;
      setSelectedId(nextId);
      if (!nextId) {
        setGradebook(null);
        setStudents([]);
        setAssessments([]);
        setSchemes([]);
        setHistoricalRecords([]);
        setAnalytics(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const loadWorkspace = async (id = selectedId) => {
    if (!id) return;
    setBusy(true);
    try {
      const [current, currentStudents, currentAssessments, currentAnalytics, currentSchemes, currentRecords] = await Promise.all([
        threeAlamatakApi.getGradebook(id),
        threeAlamatakApi.listStudents(id),
        threeAlamatakApi.listAssessments(id),
        threeAlamatakApi.getAnalytics(id),
        threeAlamatakApi.listSchemes(id).catch(() => []),
        threeAlamatakApi.listHistoricalRecords(id).catch(() => []),
      ]);
      setGradebook(current);
      setStudents(currentStudents);
      setAssessments(currentAssessments);
      setAnalytics(currentAnalytics);
      setSchemes(currentSchemes);
      setHistoricalRecords(currentRecords);
      setActiveAssessmentId((currentActive) =>
        currentAssessments.some((assessment) => assessment.id === currentActive)
          ? currentActive
          : currentAssessments[0]?.id || null
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (user?.role === 'teacher' || user?.role === 'admin') {
      loadGradebooks().catch((loadError) => setError(loadError.message));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!selectedId) return;
    loadWorkspace(selectedId).catch((loadError) => setError(loadError.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (!activeAssessmentId) return;
    threeAlamatakApi.getMarks(activeAssessmentId)
      .then((entries) => setMarks(Object.fromEntries(entries.map((entry) => [`${entry.student_id}:${entry.component_id}`, entry]))))
      .catch((loadError) => setError(loadError.message));
  }, [activeAssessmentId]);

  const activeAssessment = assessments.find((assessment) => assessment.id === activeAssessmentId) || null;
  const filteredStudents = useMemo(() => students.filter((student) => `${student.display_name} ${student.external_student_id || ''}`.toLowerCase().includes(search.toLowerCase())), [students, search]);

  const runAction = async (action, message) => {
    setBusy(true);
    setError('');
    try {
      await action();
      if (message) setToast(message);
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
      window.setTimeout(() => setToast(''), 3000);
    }
  };

  const createGradebook = async (payload) => {
    await runAction(async () => {
      const created = await threeAlamatakApi.createGradebook(payload);
      setShowGradebookForm(false);
      setView('classes');
      await loadGradebooks(created.id);
    }, 'Gradebook created.');
  };

  const createStudent = async (payload) => {
    await runAction(async () => {
      await threeAlamatakApi.createStudent(selectedId, payload);
      setShowStudentForm(false);
      await loadWorkspace();
    }, 'Student added.');
  };

  const editStudent = async (payload) => {
    await runAction(async () => {
      await threeAlamatakApi.updateStudent(selectedId, editingStudent.id, payload);
      setEditingStudent(null);
      await loadWorkspace();
    }, 'Student updated.');
  };

  const createAssessment = async (payload) => {
    await runAction(async () => {
      const created = await threeAlamatakApi.createAssessment(selectedId, payload);
      setShowAssessmentForm(false);
      await loadWorkspace();
      setActiveAssessmentId(created.id);
    }, 'Assessment created.');
  };

  const saveAssessment = async (payload) => {
    await runAction(async () => {
      await threeAlamatakApi.updateAssessment(editingAssessment.id, payload);
      setEditingAssessment(null);
      setShowAssessmentForm(false);
      await loadWorkspace();
    }, 'Assessment updated.');
  };

  const deleteAssessment = async (assessment) => {
    if (!window.confirm(`Delete ${assessment.title}? Its marks will also be removed.`)) return;
    await runAction(async () => {
      await threeAlamatakApi.deleteAssessment(assessment.id);
      await loadWorkspace();
    }, 'Assessment deleted.');
  };

  const saveRecord = async (payload) => {
    await runAction(async () => {
      await threeAlamatakApi.updateHistoricalRecord(editingRecord.id, payload);
      setEditingRecord(null);
      await loadWorkspace();
    }, 'Record updated.');
  };

  const deleteRecord = async (record) => {
    if (!window.confirm('Delete this record?')) return;
    await runAction(async () => {
      await threeAlamatakApi.deleteHistoricalRecord(record.id);
      await loadWorkspace();
    }, 'Record deleted.');
  };

  const createScheme = async (payload) => {
    await runAction(async () => {
      await threeAlamatakApi.createScheme(selectedId, payload);
      setShowSchemeForm(false);
      await loadWorkspace();
    }, 'Grading scheme created.');
  };

  const deleteScheme = async (schemeId) => {
    if (!window.confirm('Delete this grading scheme?')) return;
    await runAction(async () => {
      await threeAlamatakApi.deleteScheme(selectedId, schemeId);
      await loadWorkspace();
    }, 'Grading scheme deleted.');
  };

  const archiveGradebook = async (id = selectedId) => {
    if (!id || !window.confirm('Archive this gradebook? Its history will remain available.')) return;
    await runAction(async () => {
      await threeAlamatakApi.archiveGradebook(id);
      await loadGradebooks(null);
    }, 'Gradebook archived.');
  };

  const refresh = () => runAction(async () => {
    await loadGradebooks();
    await loadWorkspace();
  }, 'Workspace refreshed.');

  const exportBackupJson = async () => {
    if (!selectedId) return;
    await runAction(async () => {
      const data = await threeAlamatakApi.exportGradebook(selectedId);
      downloadText(JSON.stringify(data, null, 2), `${safeFilename(gradebook?.title || '3alamatak')}.json`, 'application/json');
    }, 'JSON backup downloaded.');
  };

  const exportBackupXml = async () => {
    if (!selectedId) return;
    await runAction(async () => {
      const data = await threeAlamatakApi.exportGradebook(selectedId);
      const xml = exportGradebookToXml(data);
      downloadText(xml, `${safeFilename(gradebook?.title || '3alamatak')}.xml`, 'application/xml;charset=utf-8');
    }, 'XML backup downloaded.');
  };

  const exportBackupHtml = async () => {
    if (!selectedId) return;
    await runAction(async () => {
      const data = await threeAlamatakApi.exportGradebook(selectedId);
      const html = exportGradebookToHtml(data);
      downloadText(html, `${safeFilename(gradebook?.title || '3alamatak')}.html`, 'text/html;charset=utf-8');
    }, 'Self-contained HTML report downloaded.');
  };

  const exportCsv = () => {
    if (!gradebook) return;
    const rows = [['Student ID', 'Student Name', ...assessments.map((assessment) => assessment.title)]];
    students.forEach((student) => rows.push([
      student.external_student_id || student.id,
      student.display_name,
      ...assessments.map((assessment) => {
        const state = assessmentState(assessment, student.id);
        return state.percent === null ? '' : state.percent.toFixed(2);
      }),
    ]));
    downloadText(rows.map((row) => row.map(csvCell).join(',')).join('\n'), `${safeFilename(gradebook.title)}_marks.csv`, 'text/csv;charset=utf-8');
    setToast('CSV exported.');
  };

  const restoreBackup = async (file) => {
    if (!file || !selectedId) return;
    await runAction(async () => {
      const text = await file.text();
      let backup;
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.xml') || text.includes('<?xml')) {
        backup = parseGradebookXml(text);
      } else if (lower.endsWith('.html') || text.includes('__EMBEDDED_MARKBOOK__')) {
        backup = parseGradebookHtml(text);
      } else {
        backup = JSON.parse(text);
      }
      const packageData = backupToImportPackage(backup);
      await threeAlamatakApi.importPackage(selectedId, packageData);
      setImportPreview(null);
      await loadWorkspace();
    }, 'Backup data imported into Aiven.');
  };

  const analyzeWorkbook = async (file) => {
    if (!file) return;
    try {
      let pkg, sheets;
      if (selectedId) {
        try {
          const res = await threeAlamatakApi.analyzeWorkbook(selectedId, file);
          pkg = res.pkg;
          sheets = res.sheets;
        } catch (backendErr) {
          console.warn('Backend analyze failed, falling back to local analysis:', backendErr);
        }
      }

      if (!pkg) {
        sheets = /\.xlsx?$/i.test(file.name)
          ? await readXlsxWorkbook(file)
          : [{ name: file.name.replace(/\.[^.]+$/, ''), rows: parseDelimited(await file.text()) }];
        
        pkg = buildWorkbookImportPackage(sheets, file.name, {
          existingStudents: students,
          academicYear: gradebook?.academic_year,
        });
      }

      const initialResolutions = {};
      (pkg.matched_students || []).forEach((m) => {
        initialResolutions[m.key] = {
          resolution: m.resolution, // studentId, 'new', or ''
          include: m.include,
        };
      });
      setStudentResolutions(initialResolutions);
      setImportPreview({ file, pkg, rawSheets: sheets });
      setError('');
    } catch (importError) {
      setError(importError.message);
    }
  };

  const commitWorkbook = async () => {
    if (!importPreview || !selectedId) return;
    
    // Check if any ambiguous student has unresolved status
    const unresolvedAmbiguous = (importPreview.pkg.matched_students || []).filter(
      (m) => m.status === 'ambiguous' && (!studentResolutions[m.key]?.resolution || studentResolutions[m.key]?.resolution === '')
    );

    if (unresolvedAmbiguous.length > 0) {
      setError(`Please resolve all ambiguous student matches before importing (${unresolvedAmbiguous.length} pending).`);
      return;
    }

    await runAction(async () => {
      if (importPreview.file && typeof File !== 'undefined' && importPreview.file instanceof File) {
        const formData = new FormData();
        formData.append('file', importPreview.file);
        formData.append('sheetSelections', JSON.stringify(
          (importPreview.pkg.sheets || []).map((s) => ({ name: s.name, selected: Boolean(s.selected) }))
        ));
        formData.append('studentResolutions', JSON.stringify(studentResolutions));
        if (gradebook?.academic_year) {
          formData.append('academicYear', gradebook.academic_year);
        }
        await threeAlamatakApi.importPackage(selectedId, formData);
      } else {
        // Re-map students according to teacher's resolutions for non-file/backup packages
        const finalStudents = [];
        const studentKeyToTargetMap = new Map();

        (importPreview.pkg.matched_students || []).forEach((m) => {
          const res = studentResolutions[m.key] || { resolution: m.resolution, include: true };
          if (!res.include || res.resolution === 'skip') return;

          if (res.resolution === 'new') {
            finalStudents.push({
              key: m.key,
              display_name: m.display_name,
              first_name: m.first_name,
              last_name: m.last_name,
              external_student_id: m.external_student_id,
              email: m.email,
            });
            studentKeyToTargetMap.set(m.key, m.key);
          } else {
            // Resolved to existing student
            studentKeyToTargetMap.set(m.key, res.resolution);
          }
        });

        const payload = {
          ...importPreview.pkg,
          students: finalStudents,
          assessments: (importPreview.pkg.assessments || []).map((ass) => ({
            ...ass,
            marks: (ass.marks || []).map((mk) => ({
              ...mk,
              student_key: studentKeyToTargetMap.get(mk.student_key) || mk.student_key,
            })),
          })),
          historical_records: (importPreview.pkg.historical_records || []).map((rec) => ({
            ...rec,
            student_key: studentKeyToTargetMap.get(rec.student_key) || rec.student_key,
          })),
        };

        await threeAlamatakApi.importPackage(selectedId, payload);
      }

      setImportPreview(null);
      await loadWorkspace();
    }, 'Workbook import persisted.');
  };

  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'teacher' && user.account_status !== 'active') return <AccountStatus status={user.account_status} />;
  if (user.role !== 'teacher' && user.role !== 'admin') return <UnauthorizedThreeAlamatak />;

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-700 text-white shadow-lg shadow-teal-700/20">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Teacher workspace</p>
              <h1 className="text-xl font-black tracking-tight">3alamatak</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-slate-500 sm:inline">{user.full_name}</span>
            <button
              type="button"
              onClick={() => navigate('/home')}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-600 hover:border-teal-300 hover:text-teal-700"
            >
              <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Madrastak</span>
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-5 sm:px-8 lg:flex-row">
        <aside className="w-full shrink-0 rounded-2xl bg-slate-900 p-3 text-slate-300 shadow-lg lg:w-60 lg:self-start">
          <div className="mb-2 px-3 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Workspace</div>
          <nav className="grid grid-cols-2 gap-1 lg:block">
            {views.map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`mb-1 flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition ${
                  view === key ? 'bg-slate-700 text-white' : 'hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
          <div className="mt-4 border-t border-slate-700 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Current gradebook</p>
            <select
              value={selectedId || ''}
              onChange={(event) => setSelectedId(Number(event.target.value) || null)}
              className="mt-2 min-h-10 w-full rounded-lg border-0 bg-slate-800 px-2 text-xs text-white"
            >
              <option value="">Select a gradebook</option>
              {gradebooks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowGradebookForm(true)}
              className="mt-2 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-2 text-xs font-bold text-white hover:bg-teal-500"
            >
              <Plus className="h-3.5 w-3.5" /> New gradebook
            </button>
          </div>
        </aside>
        <section className="min-w-0 flex-1">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">3alamatak</p>
              <h2 className="mt-1 text-3xl font-black tracking-tight">{viewTitle(view, gradebook)}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {gradebook ? `${gradebook.title} · ${gradebook.academic_year}` : 'Persistent teacher markbooks backed by Madrastak.'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={refresh}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 hover:border-teal-300 hover:text-teal-700"
              >
                <RefreshCw className="h-4 w-4" /> Refresh
              </button>
              {busy && <span className="self-center text-sm text-slate-400">Saving...</span>}
            </div>
          </div>
          {error && (
            <div role="alert" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              <span>{error}</span>
              <button type="button" onClick={() => setError('')} aria-label="Dismiss error">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {toast && <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{toast}</div>}
          {view === 'dashboard' && <DashboardView gradebooks={gradebooks} analytics={analytics} students={students} assessments={assessments} onSelect={(id) => { setSelectedId(id); setView('classes'); }} />}
          {view === 'classes' && <ClassesView gradebooks={gradebooks} selectedId={selectedId} gradebook={gradebook} onSelect={setSelectedId} onCreate={() => setShowGradebookForm(true)} onArchive={archiveGradebook} />}
          {view === 'students' && <StudentsView students={filteredStudents} search={search} setSearch={setSearch} onAdd={() => setShowStudentForm(true)} onEdit={setEditingStudent} onArchive={(id) => runAction(() => threeAlamatakApi.archiveStudent(selectedId, id).then(loadWorkspace), 'Student archived.')} />}
          {view === 'imports' && (
            <ImportView
              selectedId={selectedId}
              importPreview={importPreview}
              studentResolutions={studentResolutions}
              setStudentResolutions={setStudentResolutions}
              existingStudents={students}
              onAnalyze={analyzeWorkbook}
              onToggleSheet={(index, selected) => {
                if (!importPreview) return;
                const nextSheets = importPreview.pkg.sheets.map((s, idx) => (idx === index ? { ...s, selected } : s));
                const nextPkg = buildWorkbookImportPackage(nextSheets, importPreview.file.name, {
                  existingStudents: students,
                  academicYear: gradebook?.academic_year,
                });
                setImportPreview({ ...importPreview, pkg: nextPkg });
              }}
              onCommit={commitWorkbook}
              onRestore={restoreBackup}
            />
          )}
          {view === 'reports' && (
            <ReportsView
              gradebook={gradebook}
              students={students}
              assessments={assessments}
              analytics={analytics}
              onExportCsv={exportCsv}
              onExportJson={exportBackupJson}
              onExportXml={exportBackupXml}
              onExportHtml={exportBackupHtml}
              onOpenPrint={() => setShowPrintModal(true)}
            />
          )}
          {view === 'settings' && <SettingsView gradebook={gradebook} onArchive={archiveGradebook} />}
          {gradebook && view === 'classes' && (
            <WorkspaceView
              gradebook={gradebook}
              students={students}
              assessments={assessments}
              activeAssessment={activeAssessment}
              marks={marks}
              setMarks={setMarks}
              schemes={schemes}
              historicalRecords={historicalRecords}
              onAddStudent={() => setShowStudentForm(true)}
              onEditStudent={setEditingStudent}
              onAddAssessment={() => setShowAssessmentForm(true)}
              onEditAssessment={(assessment) => { setEditingAssessment(assessment); setShowAssessmentForm(true); }}
              onDeleteAssessment={deleteAssessment}
              onAddScheme={() => setShowSchemeForm(true)}
              onDeleteScheme={deleteScheme}
              onAssessmentChange={(id) => { setActiveAssessmentId(id); setMarks({}); }}
              onSaveMarks={() => runAction(async () => { await threeAlamatakApi.saveMarks(activeAssessment.id, Object.values(marks)); await loadWorkspace(); }, 'Marks saved to Aiven.')}
              onEditRecord={setEditingRecord}
              onDeleteRecord={deleteRecord}
              analytics={analytics}
            />
          )}
        </section>
      </div>

      {showGradebookForm && <GradebookForm onCancel={() => setShowGradebookForm(false)} onSubmit={createGradebook} />}
      {showStudentForm && selectedId && <StudentForm onCancel={() => setShowStudentForm(false)} onSubmit={createStudent} />}
      {editingStudent && selectedId && <StudentForm student={editingStudent} onCancel={() => setEditingStudent(null)} onSubmit={editStudent} />}
      {showAssessmentForm && selectedId && <AssessmentForm assessment={editingAssessment} onCancel={() => { setShowAssessmentForm(false); setEditingAssessment(null); }} onSubmit={editingAssessment ? saveAssessment : createAssessment} />}
      {editingRecord && <RecordForm record={editingRecord} onCancel={() => setEditingRecord(null)} onSubmit={saveRecord} />}
      {showSchemeForm && selectedId && <SchemeForm onCancel={() => setShowSchemeForm(false)} onSubmit={createScheme} />}
      {showPrintModal && gradebook && (
        <PrintReportModal
          gradebook={gradebook}
          students={students}
          assessments={assessments}
          analytics={analytics}
          schemes={schemes}
          user={user}
          onClose={() => setShowPrintModal(false)}
        />
      )}
    </main>
  );
}

function DashboardView({ gradebooks, analytics, students, assessments, onSelect }) {
  const summary = analytics?.summary || {};
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Gradebooks" value={gradebooks.length} />
        <Stat label="Students" value={summary.students || students.length} />
        <Stat label="Assessments" value={summary.assessments || assessments.length} />
        <Stat label="Class average" value={analytics?.class_average == null ? '—' : `${analytics.class_average.toFixed(1)}%`} />
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-black">Your gradebooks</h3>
            <p className="mt-1 text-sm text-slate-500">Create a persistent workspace for each class or academic year.</p>
          </div>
          <BookOpen className="h-6 w-6 text-teal-600" />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {gradebooks.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => onSelect(item.id)}
              className="rounded-xl border border-slate-200 p-4 text-left transition hover:border-teal-300 hover:bg-teal-50"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold">{item.title}</span>
                <span className="text-xs font-bold text-slate-400">{item.academic_year}</span>
              </div>
              <p className="mt-2 text-sm text-slate-500">{item.student_count || 0} students · {item.subject || 'General'}</p>
            </button>
          ))}
          {!gradebooks.length && <div className="rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-400 md:col-span-2">No gradebooks yet. Create one from the sidebar.</div>}
        </div>
      </div>
    </div>
  );
}

function ClassesView({ gradebooks, selectedId, onSelect, onCreate, onArchive }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-bold text-white hover:bg-teal-600"
        >
          <Plus className="h-4 w-4" /> New gradebook
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {gradebooks.map((item) => (
          <div
            key={item.id}
            className={`rounded-2xl border bg-white p-5 shadow-sm ${selectedId === item.id ? 'border-teal-400 ring-4 ring-teal-50' : 'border-slate-200'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-black">{item.title}</h3>
                <p className="mt-1 text-sm text-slate-500">{item.subject || 'General'} · {item.academic_year}</p>
              </div>
              <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-700">{item.student_count || 0} students</span>
            </div>
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => onSelect(item.id)} className="min-h-10 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white">
                Open workspace
              </button>
              <button type="button" onClick={() => onArchive(item.id)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-red-200 px-3 text-sm font-bold text-red-700 hover:bg-red-50">
                <Archive className="h-4 w-4" /> Archive
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkspaceView({
  students,
  assessments,
  activeAssessment,
  marks,
  setMarks,
  schemes,
  historicalRecords,
  onAddStudent,
  onEditStudent,
  onAddAssessment,
  onEditAssessment,
  onDeleteAssessment,
  onAddScheme,
  onDeleteScheme,
  onAssessmentChange,
  onSaveMarks,
  onEditRecord,
  onDeleteRecord,
  analytics,
}) {
  const [tab, setTab] = useState('markbook');
  return (
    <div className="mt-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap gap-2 border-b border-slate-100 p-4">
        {[
          ['markbook', 'Markbook'],
          ['students', 'Students'],
          ['assessments', 'Assessments'],
          ['schemes', 'Grading Schemes'],
          ['records', 'Records & History'],
          ['analytics', 'Analytics'],
        ].map(([key, label]) => (
          <button
            type="button"
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-xl px-3 py-2 text-sm font-bold ${tab === key ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'students' && (
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-black">Roster</h3>
            <button type="button" onClick={onAddStudent} className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-teal-700 px-3 text-sm font-bold text-white">
              <Plus className="h-4 w-4" /> Add student
            </button>
          </div>
          <SimpleTable
            headers={['Student ID', 'Name', 'Status', 'Action']}
            rows={students.map((student) => [student.external_student_id || student.id, student.display_name, student.status, (
              <button type="button" key={student.id} onClick={() => onEditStudent?.(student)} className="text-xs font-bold text-teal-700">Edit</button>
            )])}
          />
        </div>
      )}
      {tab === 'assessments' && (
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-black">Assessments</h3>
            <button type="button" onClick={onAddAssessment} className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-teal-700 px-3 text-sm font-bold text-white">
              <Plus className="h-4 w-4" /> Add assessment
            </button>
          </div>
          <SimpleTable
            headers={['Assessment', 'Strand', 'Date', 'Components', 'Actions']}
            rows={assessments.map((assessment) => [
              assessment.title,
              assessment.strand || '—',
              assessment.assessment_date || '—',
              assessment.components?.map((component) => `${component.name} / ${component.maximum_score}`).join(', ') || '—',
              <span key={assessment.id} className="flex gap-2"><button type="button" onClick={() => onEditAssessment(assessment)} className="text-xs font-bold text-teal-700">Edit</button><button type="button" onClick={() => onDeleteAssessment(assessment)} className="text-xs font-bold text-red-700">Delete</button></span>,
            ])}
          />
        </div>
      )}
      {tab === 'markbook' && (
        <Markbook
          students={students}
          assessments={assessments}
          activeAssessment={activeAssessment}
          marks={marks}
          setMarks={setMarks}
          onAssessmentChange={onAssessmentChange}
          onSave={onSaveMarks}
        />
      )}
      {tab === 'schemes' && (
        <SchemesTab schemes={schemes} onAddScheme={onAddScheme} onDeleteScheme={onDeleteScheme} />
      )}
      {tab === 'records' && (
        <RecordsTab records={historicalRecords} onEdit={onEditRecord} onDelete={onDeleteRecord} />
      )}
      {tab === 'analytics' && <Analytics analytics={analytics} students={students} />}
    </div>
  );
}

function Markbook({ students, assessments, activeAssessment, marks, setMarks, onAssessmentChange, onSave }) {
  const updateMark = (studentId, componentId, field, value) =>
    setMarks((current) => ({
      ...current,
      [`${studentId}:${componentId}`]: {
        ...(current[`${studentId}:${componentId}`] || { student_id: studentId, component_id: componentId }),
        [field]: value,
      },
    }));

  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <select
          value={activeAssessment?.id || ''}
          onChange={(event) => onAssessmentChange(Number(event.target.value))}
          className="min-h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold"
        >
          <option value="">Select assessment</option>
          {assessments.map((assessment) => (
            <option key={assessment.id} value={assessment.id}>
              {assessment.title}
            </option>
          ))}
        </select>
        {activeAssessment && (
          <button
            type="button"
            onClick={onSave}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-bold text-white shadow-sm hover:bg-teal-600"
          >
            <Check className="h-4 w-4" /> Save marks
          </button>
        )}
      </div>
      {activeAssessment ? (
        <div className="overflow-x-auto">
          <table className="min-w-190 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-400">
                <th className="px-3 py-3">Student</th>
                {activeAssessment.components.map((component) => (
                  <th key={component.id} className="px-3 py-3">
                    {component.name} / {component.maximum_score}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {students.map((student) => (
                <tr key={student.id}>
                  <td className="px-3 py-3 font-bold">{student.display_name}</td>
                  {activeAssessment.components.map((component) => {
                    const entry = marks[`${student.id}:${component.id}`] || {};
                    return (
                      <td key={component.id} className="px-3 py-3">
                        <input
                          type="number"
                          min="0"
                          max={component.maximum_score}
                          value={entry.score ?? ''}
                          onChange={(event) =>
                            updateMark(student.id, component.id, 'score', event.target.value === '' ? null : Number(event.target.value))
                          }
                          className="w-24 rounded-lg border border-slate-200 px-2 py-2 text-center"
                        />
                        <select
                          value={entry.mark_status || ''}
                          onChange={(event) => updateMark(student.id, component.id, 'mark_status', event.target.value || null)}
                          className="mt-1 w-24 rounded-lg border border-slate-200 px-1 py-1 text-xs"
                        >
                          <option value="">Mark</option>
                          <option value="Absent">Absent</option>
                          <option value="Not started">Not started</option>
                          <option value="Missing">Missing</option>
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl bg-slate-50 p-10 text-center text-sm text-slate-400">
          Create an assessment, then enter marks here.
        </div>
      )}
    </div>
  );
}

function SchemesTab({ schemes, onAddScheme, onDeleteScheme }) {
  return (
    <div className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-black text-lg">Grading Schemes & Thresholds</h3>
          <p className="text-xs text-slate-500">Configure letter grade boundaries (A*, A, B...) and assessment component weights.</p>
        </div>
        <button
          type="button"
          onClick={onAddScheme}
          className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-teal-700 px-3 text-sm font-bold text-white hover:bg-teal-600"
        >
          <Plus className="h-4 w-4" /> New Scheme
        </button>
      </div>

      <div className="space-y-6">
        {schemes.map((scheme) => (
          <div key={scheme.id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Award className="h-5 w-5 text-teal-600" />
                <h4 className="font-black text-slate-900">{scheme.name}</h4>
                {scheme.is_fallback ? (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">Fallback</span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onDeleteScheme(scheme.id)}
                className="text-xs font-bold text-red-600 hover:text-red-800"
              >
                Delete
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {Object.entries(scheme.components || {}).map(([key, comp]) => (
                <div key={key} className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="font-bold text-sm text-slate-800">{comp.label || key}</span>
                    {comp.maximum_score != null && (
                      <span className="text-xs font-semibold text-slate-500">Max: {comp.maximum_score}</span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(comp.thresholds || {}).map(([grade, minScore]) => (
                      <span
                        key={grade}
                        className="inline-flex items-center gap-1 rounded-md bg-teal-50 px-2 py-1 text-xs font-bold text-teal-800"
                      >
                        <span className="text-teal-600">{grade}:</span>
                        <span>{minScore}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {!schemes.length && (
          <div className="rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-400">
            No grading schemes defined yet. Import a workbook with a Gradethreshold sheet or create a custom scheme above.
          </div>
        )}
      </div>
    </div>
  );
}

function recordPayload(record) {
  if (!record) return {};
  if (typeof record.payload !== 'string') return record.payload || {};
  try { return JSON.parse(record.payload); } catch { return {}; }
}

function recordDetails(record) {
  const payload = recordPayload(record);
  const labels = {
    note: 'Note', category: 'Category', title: 'Title', status: 'Status', due_date: 'Due',
    topic: 'Topic', aim: 'Aim', issue: 'Issue', leader: 'Leader', task: 'Task',
    action_plan: 'Action plan', progress: 'Progress', timeline: 'Timeline', date_submitted: 'Submitted',
  };
  return Object.entries(payload)
    .filter(([key, value]) => value != null && value !== '' && key !== 'student_name' && key !== 'source_sheet')
    .map(([key, value]) => `${labels[key] || key.replace(/_/g, ' ')}: ${Array.isArray(value) ? value.join(', ') : String(value)}`);
}

function RecordsTab({ records, onEdit, onDelete }) {
  const [filter, setFilter] = useState('all');
  const filtered = useMemo(() => {
    if (filter === 'all') return records;
    return records.filter((r) => r.record_type === filter);
  }, [records, filter]);

  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-black text-lg">Activity & Historical Records</h3>
          <p className="text-xs text-slate-500">Persisted student conduct notes, assignments, team projects, and historical year archives.</p>
        </div>
        <div className="flex flex-wrap gap-1.5 rounded-xl bg-slate-100 p-1">
          {[
            ['all', 'All'],
            ['behavior', 'Conduct'],
            ['assignment', 'Assignments'],
            ['team_project', 'Team Projects'],
            ['historical', 'Historical'],
          ].map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setFilter(val)}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                filter === val ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-150 text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-400">
              <th className="px-3 py-3">Type</th>
              <th className="px-3 py-3">Student</th>
              <th className="px-3 py-3">Year / Date</th>
              <th className="px-3 py-3">Details</th>
              <th className="px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((record) => {
              const payload = recordPayload(record);
              return (
                <tr key={record.id}>
                  <td className="px-3 py-3">
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold capitalize text-slate-700">
                      {record.record_type.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-bold text-slate-900">
                    {record.student_name || payload.student_name || '—'}
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500">
                    {payload.date || payload.due_date || record.source_year || '—'}
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-600">
                    <div className="space-y-1">{recordDetails(record).map((detail) => <div key={detail}>{detail}</div>)}</div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <button type="button" onClick={() => onEdit(record)} className="mr-3 text-xs font-bold text-teal-700">Edit</button>
                    <button type="button" onClick={() => onDelete(record)} className="text-xs font-bold text-red-700">Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filtered.length && <p className="p-8 text-center text-sm text-slate-400">No records found for this category.</p>}
      </div>
    </div>
  );
}

function Analytics({ analytics, students }) {
  return (
    <div className="grid gap-4 p-5 sm:grid-cols-3">
      <Stat label="Class average" value={analytics?.class_average == null ? '—' : `${analytics.class_average.toFixed(1)}%`} />
      <Stat label="Highest average" value={analytics?.highest == null ? '—' : `${analytics.highest.toFixed(1)}%`} />
      <Stat label="Lowest average" value={analytics?.lowest == null ? '—' : `${analytics.lowest.toFixed(1)}%`} />
      <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600 sm:col-span-3">
        {students.length} students are in this gradebook. Recorded marks are calculated from persisted Aiven data.
      </div>
    </div>
  );
}

function StudentsView({ students, search, setSearch, onAdd, onEdit, onArchive }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search students"
            className="min-h-10 rounded-xl border border-slate-200 pl-9 pr-3 text-sm"
          />
        </div>
        <button type="button" onClick={onAdd} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-bold text-white">
          <Plus className="h-4 w-4" /> Add student
        </button>
      </div>
      <SimpleTable
        headers={['Student ID', 'Name', 'Email', 'Status', 'Action']}
        rows={students.map((student) => [
          student.external_student_id || student.id,
          student.display_name,
          student.email || '—',
          student.status,
          <span key={student.id} className="flex gap-3"><button type="button" onClick={() => onEdit(student)} className="text-xs font-bold text-teal-700">Edit</button><button type="button" onClick={() => onArchive(student.id)} className="text-xs font-bold text-red-700">Archive</button></span>,
        ])}
      />
    </div>
  );
}

function ImportView({
  selectedId,
  importPreview,
  studentResolutions,
  setStudentResolutions,
  existingStudents,
  onAnalyze,
  onToggleSheet,
  onCommit,
  onRestore,
}) {
  const [activeTab, setActiveTab] = useState('preview');

  const pendingAmbiguous = useMemo(() => {
    if (!importPreview?.pkg?.matched_students) return 0;
    return importPreview.pkg.matched_students.filter(
      (m) => m.status === 'ambiguous' && (!studentResolutions[m.key]?.resolution || studentResolutions[m.key]?.resolution === '')
    ).length;
  }, [importPreview, studentResolutions]);

  const updateResolution = (key, resolution) => {
    setStudentResolutions((curr) => ({
      ...curr,
      [key]: {
        ...(curr[key] || {}),
        resolution,
      },
    }));
  };

  const toggleInclude = (key, include) => {
    setStudentResolutions((curr) => ({
      ...curr,
      [key]: {
        ...(curr[key] || {}),
        include,
      },
    }));
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <p className="text-xs font-bold uppercase tracking-wider text-teal-700">Worksheet-aware import</p>
          <h3 className="mt-1 text-xl font-black">Full Excel Workbook Analysis & Import</h3>
          <p className="mt-1 text-sm text-slate-500">
            Automatically detects grades, thresholds, conduct, assignments, and team projects. Review student roster matching before persisting.
          </p>
        </div>
        <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center hover:border-teal-400">
          <FileSpreadsheet className="h-7 w-7 text-teal-600" />
          <span className="mt-2 text-sm font-bold text-slate-700">Choose XLSX, CSV, or TSV</span>
          <span className="text-xs text-slate-400">Multi-sheet workbooks supported</span>
          <input type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" onChange={(event) => onAnalyze(event.target.files?.[0])} className="hidden" />
        </label>

        {importPreview && (
          <div className="mt-6 space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Detected Worksheets" value={importPreview.pkg.summary.totalSheets} />
              <Stat label="Detected Students" value={importPreview.pkg.summary.studentsCount} />
              <Stat label="Assessment Blocks" value={importPreview.pkg.summary.assessmentsCount} />
              <Stat label="Threshold Schemes" value={importPreview.pkg.summary.schemesCount} />
            </div>

            {pendingAmbiguous > 0 && (
              <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                <div className="text-xs leading-relaxed">
                  <span className="font-bold">Attention required: </span>
                  There are {pendingAmbiguous} ambiguous student names that need your manual resolution below.
                </div>
              </div>
            )}

            <div className="flex gap-2 border-b border-slate-100 pb-2">
              {[
                ['preview', '1. Worksheets & Content'],
                ['students', `2. Student Matching (${importPreview.pkg.matched_students?.length || 0})`],
              ].map(([tKey, tLabel]) => (
                <button
                  key={tKey}
                  type="button"
                  onClick={() => setActiveTab(tKey)}
                  className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
                    activeTab === tKey ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tLabel}
                </button>
              ))}
            </div>

            {activeTab === 'preview' && (
              <div className="space-y-4">
                <h4 className="text-sm font-black text-slate-900">Worksheet Classification</h4>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-170 text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                        <th className="px-3 py-3">Import</th>
                        <th className="px-3 py-3">Worksheet Name</th>
                        <th className="px-3 py-3">Classification</th>
                        <th className="px-3 py-3">Rows</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {importPreview.pkg.sheets.map((sheet, index) => (
                        <tr key={sheet.name}>
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={sheet.selected}
                              onChange={(e) => onToggleSheet(index, e.target.checked)}
                              className="h-4 w-4 rounded-sm text-teal-600"
                            />
                          </td>
                          <td className="px-3 py-3 font-bold text-slate-900">{sheet.name}</td>
                          <td className="px-3 py-3">
                            <span className="rounded-md bg-teal-50 px-2 py-0.5 text-xs font-bold text-teal-700">
                              {sheet.label}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-xs text-slate-500">{sheet.rows?.length || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {importPreview.pkg.schemes.length > 0 && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                    <p className="text-xs font-bold uppercase text-emerald-800">Detected Grade Scheme</p>
                    <p className="mt-1 text-sm font-black text-emerald-950">{importPreview.pkg.schemes[0].name}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {Object.keys(importPreview.pkg.schemes[0].components || {}).map((cKey) => (
                        <span key={cKey} className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-emerald-900 border border-emerald-200">
                          {cKey}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'students' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-black text-slate-900">Student Roster Matching</h4>
                    <p className="text-xs text-slate-500">Confirm student mappings. Exact and high-confidence matches are pre-assigned.</p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-180 text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                        <th className="px-3 py-3">Include</th>
                        <th className="px-3 py-3">Imported Name / ID</th>
                        <th className="px-3 py-3">Match Status</th>
                        <th className="px-3 py-3">Resolution</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(importPreview.pkg.matched_students || []).map((m) => {
                        const curRes = studentResolutions[m.key] || { resolution: m.resolution, include: true };
                        return (
                          <tr key={m.key}>
                            <td className="px-3 py-3">
                              <input
                                type="checkbox"
                                checked={curRes.include}
                                onChange={(e) => toggleInclude(m.key, e.target.checked)}
                                className="h-4 w-4 rounded-sm text-teal-600"
                              />
                            </td>
                            <td className="px-3 py-3">
                              <p className="font-bold text-slate-900">{m.display_name}</p>
                              {m.external_student_id && <p className="text-xs text-slate-400">ID: {m.external_student_id}</p>}
                            </td>
                            <td className="px-3 py-3">
                              {m.status === 'exact' && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                                  <Check className="h-3 w-3" /> Exact Match
                                </span>
                              )}
                              {m.status === 'fuzzy' && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-teal-100 px-2 py-0.5 text-xs font-bold text-teal-800">
                                  <Check className="h-3 w-3" /> Fuzzy Match
                                </span>
                              )}
                              {m.status === 'ambiguous' && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                                  <AlertTriangle className="h-3 w-3" /> Ambiguous
                                </span>
                              )}
                              {m.status === 'unmatched' && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-800">
                                  <Plus className="h-3 w-3" /> New Student
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3">
                              {m.status === 'exact' || m.status === 'fuzzy' ? (
                                <span className="text-xs font-medium text-slate-600">
                                  Mapped to: <strong>{m.matchedStudent?.display_name}</strong>
                                </span>
                              ) : m.status === 'ambiguous' ? (
                                <select
                                  value={curRes.resolution || ''}
                                  onChange={(e) => updateResolution(m.key, e.target.value)}
                                  className="min-h-9 rounded-lg border border-amber-300 bg-amber-50/50 px-2 text-xs font-semibold text-amber-900"
                                >
                                  <option value="">-- Choose resolution --</option>
                                  {m.candidates.map((c) => (
                                    <option key={c.id} value={String(c.id)}>
                                      Match: {c.display_name} ({c.external_student_id || c.id})
                                    </option>
                                  ))}
                                  <option value="new">+ Add as new student</option>
                                  <option value="skip">Skip this student</option>
                                </select>
                              ) : (
                                <span className="text-xs text-blue-700 font-medium">
                                  Will be registered as a new student in roster
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={!selectedId || pendingAmbiguous > 0}
              onClick={onCommit}
              className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-teal-700 px-5 text-sm font-bold text-white shadow-sm hover:bg-teal-600 disabled:opacity-50"
            >
              <Upload className="h-4 w-4" /> Persist Selected Data into Madrastak
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="font-black text-lg">Restore a Gradebook Backup</h3>
        <p className="mt-1 text-sm text-slate-500">
          Restore from JSON, XML (<code>.xml</code>), or a standalone self-contained HTML file (<code>.html</code>).
        </p>
        <label className="mt-4 inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:border-teal-300">
          <Download className="h-4 w-4" /> Choose Backup File (.json, .xml, .html)
          <input type="file" accept=".json,.xml,.html" onChange={(event) => onRestore(event.target.files?.[0])} className="hidden" />
        </label>
      </div>
    </div>
  );
}

function ReportsView({
  gradebook,
  students,
  assessments,
  analytics,
  onExportCsv,
  onExportJson,
  onExportXml,
  onExportHtml,
  onOpenPrint,
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-black">Export data</h3>
        <p className="mt-1 text-sm text-slate-500">Create portable backups and printable records from Aiven.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onExportCsv}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-bold text-white shadow-sm hover:bg-teal-600"
          >
            <Download className="h-4 w-4" /> Marks CSV
          </button>
          <button
            type="button"
            onClick={onExportJson}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            <FileCode className="h-4 w-4" /> JSON Backup
          </button>
          <button
            type="button"
            onClick={onExportXml}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            <FileText className="h-4 w-4" /> XML Backup
          </button>
          <button
            type="button"
            onClick={onExportHtml}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" /> HTML Report Copy
          </button>
          <button
            type="button"
            onClick={onOpenPrint}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white shadow-sm hover:bg-slate-800"
          >
            <Printer className="h-4 w-4" /> Print-Ready Report
          </button>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-black">Report snapshot</h3>
        <p className="mt-3 text-sm text-slate-600">
          {gradebook?.title || 'No gradebook selected'} has {students.length} students and {assessments.length} assessments.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Average" value={analytics?.class_average == null ? '—' : `${analytics.class_average.toFixed(1)}%`} />
          <Stat label="Highest" value={analytics?.highest == null ? '—' : `${analytics.highest.toFixed(1)}%`} />
          <Stat label="Lowest" value={analytics?.lowest == null ? '—' : `${analytics.lowest.toFixed(1)}%`} />
        </div>
      </div>
    </div>
  );
}

function SettingsView({ gradebook, onArchive }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-black">Gradebook settings</h3>
      <p className="mt-2 text-sm text-slate-500">
        {gradebook ? `${gradebook.title} · ${gradebook.subject || 'General'} · ${gradebook.academic_year}` : 'Select a gradebook to view settings.'}
      </p>
      {gradebook && (
        <button
          type="button"
          onClick={onArchive}
          className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-xl border border-red-200 px-4 text-sm font-bold text-red-700 hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" /> Archive gradebook
        </button>
      )}
    </div>
  );
}

function PrintReportModal({ gradebook, students, assessments, analytics, schemes, user, onClose }) {
  const activeScheme = schemes[0] || null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs print:static print:bg-white print:p-0"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-8 shadow-2xl print:max-h-none print:w-full print:border-none print:p-0 print:shadow-none"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-slate-200 pb-4 print:hidden">
          <div className="flex items-center gap-2 text-slate-800">
            <Printer className="h-5 w-5 text-teal-700" />
            <span className="font-black text-lg">Print Report Preview</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-teal-700 px-4 text-xs font-bold text-white shadow-sm hover:bg-teal-600"
            >
              <Printer className="h-4 w-4" /> Print Document
            </button>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Printable Paper Content */}
        <div className="mt-6 print:mt-0">
          <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Madrastak Education · 3alamatak Markbook</p>
              <h1 className="mt-1 text-2xl font-black text-slate-900">{gradebook.title}</h1>
              <p className="text-xs text-slate-600">Subject: {gradebook.subject || 'General'} · Academic Year: {gradebook.academic_year}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-slate-500">Date Generated</p>
              <p className="text-sm font-bold text-slate-800">{new Date().toLocaleDateString()}</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-3 border-b border-slate-200 py-3 text-center">
            <div>
              <p className="text-[10px] font-bold uppercase text-slate-400">Total Enrolled</p>
              <p className="text-lg font-black text-slate-800">{students.length}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-slate-400">Assessments</p>
              <p className="text-lg font-black text-slate-800">{assessments.length}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-slate-400">Class Average</p>
              <p className="text-lg font-black text-teal-700">
                {analytics?.class_average != null ? `${analytics.class_average.toFixed(1)}%` : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-slate-400">Active Scheme</p>
              <p className="text-sm font-bold text-slate-700">{activeScheme?.name || 'Default'}</p>
            </div>
          </div>

          <div className="mt-6">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">Student Performance Summary</h3>
            <table className="w-full border-collapse border border-slate-200 text-left text-xs">
              <thead>
                <tr className="bg-slate-100 font-bold text-slate-700">
                  <th className="border border-slate-200 px-3 py-2">ID</th>
                  <th className="border border-slate-200 px-3 py-2">Student Name</th>
                  {assessments.slice(0, 5).map((a) => (
                    <th key={a.id} className="border border-slate-200 px-2 py-2 text-center">
                      {a.title}
                    </th>
                  ))}
                  <th className="border border-slate-200 px-3 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id} className="border-b border-slate-200">
                    <td className="border border-slate-200 px-3 py-2 text-slate-500 font-mono text-[11px]">
                      {student.external_student_id || student.id}
                    </td>
                    <td className="border border-slate-200 px-3 py-2 font-bold text-slate-900">
                      {student.display_name}
                    </td>
                    {assessments.slice(0, 5).map((a) => {
                      const state = assessmentState(a, student.id);
                      return (
                        <td key={a.id} className="border border-slate-200 px-2 py-2 text-center">
                          {state.score != null ? state.score : '—'}
                        </td>
                      );
                    })}
                    <td className="border border-slate-200 px-3 py-2 text-center capitalize font-semibold text-slate-700">
                      {student.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Teacher Signature Line */}
          <div className="mt-12 flex items-center justify-between border-t border-slate-300 pt-6 text-xs text-slate-600">
            <div>
              <p>Instructor: <strong className="text-slate-900">{user?.full_name || 'Instructor'}</strong></p>
              <p className="mt-1">Role: Teacher / Admin</p>
            </div>
            <div className="w-64 text-right">
              <p className="border-b border-slate-400 pb-1">Signature: __________________________</p>
              <p className="mt-1">Date: __________________________</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GradebookForm({ onCancel, onSubmit }) {
  const [form, setForm] = useState({ title: '', subject: 'ESL', academic_year: '2025-2026' });
  return (
    <Modal title="New gradebook" onCancel={onCancel}>
      <Field label="Title" value={form.title} onChange={(value) => setForm({ ...form, title: value })} placeholder="Year 10 ESL" />
      <Field label="Subject" value={form.subject} onChange={(value) => setForm({ ...form, subject: value })} placeholder="ESL" />
      <Field label="Academic year" value={form.academic_year} onChange={(value) => setForm({ ...form, academic_year: value })} placeholder="2025-2026" />
      <FormActions onCancel={onCancel} onSubmit={() => onSubmit(form)} label="Create gradebook" />
    </Modal>
  );
}

function StudentForm({ student, onCancel, onSubmit }) {
  const [form, setForm] = useState(() => student ? {
    first_name: student.first_name || student.display_name?.split(' ')[0] || '',
    last_name: student.last_name || student.display_name?.split(' ').slice(1).join(' ') || '',
    external_student_id: student.external_student_id || '', email: student.email || '', notes: student.notes || '',
  } : { first_name: '', last_name: '', external_student_id: '', email: '', notes: '' });
  return (
    <Modal title={student ? 'Edit student' : 'Add student'} onCancel={onCancel}>
      <Field label="First name" value={form.first_name} onChange={(value) => setForm({ ...form, first_name: value })} />
      <Field label="Last name" value={form.last_name} onChange={(value) => setForm({ ...form, last_name: value })} />
      <Field label="Student ID" value={form.external_student_id} onChange={(value) => setForm({ ...form, external_student_id: value })} />
      <Field label="Email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
      <label className="block text-xs font-bold text-slate-600">
        Notes
        <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="mt-1 min-h-20 w-full rounded-xl border border-slate-200 p-3 text-sm" />
      </label>
      <FormActions onCancel={onCancel} onSubmit={() => onSubmit(form)} label={student ? 'Save student' : 'Add student'} />
    </Modal>
  );
}

function AssessmentForm({ assessment, onCancel, onSubmit }) {
  const [form, setForm] = useState(() => assessment ? {
    title: assessment.title || '', strand: assessment.strand || 'General', topic: assessment.topic || '',
    assessment_date: assessment.assessment_date || '', components: assessment.components?.map((component) => ({ ...component })) || [],
  } : { title: '', strand: 'General', topic: '', assessment_date: '', components: [{ name: 'Total', maximum_score: 20 }] });
  const updateComponent = (index, key, value) =>
    setForm({
      ...form,
      components: form.components.map((component, itemIndex) =>
        itemIndex === index ? { ...component, [key]: key === 'maximum_score' ? Number(value) : value } : component
      ),
    });
  return (
    <Modal title={assessment ? 'Edit assessment' : 'New assessment'} onCancel={onCancel}>
      <Field label="Title" value={form.title} onChange={(value) => setForm({ ...form, title: value })} placeholder="Writing exercise" />
      <Field label="Strand" value={form.strand} onChange={(value) => setForm({ ...form, strand: value })} />
      <Field label="Topic" value={form.topic} onChange={(value) => setForm({ ...form, topic: value })} />
      <Field label="Date" type="date" value={form.assessment_date} onChange={(value) => setForm({ ...form, assessment_date: value })} />
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-600">Components</span>
          <button type="button" onClick={() => setForm({ ...form, components: [...form.components, { name: '', maximum_score: 10 }] })} className="text-xs font-bold text-teal-700">
            + Add component
          </button>
        </div>
        {form.components.map((component, index) => (
          <div key={component.id || index} className="flex gap-2">
            <input value={component.name} onChange={(event) => updateComponent(index, 'name', event.target.value)} placeholder="Component" className="min-h-10 flex-1 rounded-xl border border-slate-200 px-3 text-sm" />
            <input type="number" value={component.maximum_score} onChange={(event) => updateComponent(index, 'maximum_score', event.target.value)} className="min-h-10 w-24 rounded-xl border border-slate-200 px-3 text-sm" />
          </div>
        ))}
      </div>
      <FormActions onCancel={onCancel} onSubmit={() => onSubmit(form)} label={assessment ? 'Save assessment' : 'Create assessment'} />
    </Modal>
  );
}

function RecordForm({ record, onCancel, onSubmit }) {
  const [payload, setPayload] = useState(() => recordPayload(record));
  const set = (key, value) => setPayload((current) => ({ ...current, [key]: value }));
  const fields = ['title', 'status', 'note', 'category', 'topic', 'aim', 'issue', 'leader', 'task', 'action_plan', 'progress', 'timeline', 'due_date', 'date_submitted'];
  return (
    <Modal title={`Edit ${String(record.record_type || 'record').replace('_', ' ')}`} onCancel={onCancel}>
      {fields.map((key) => (
        <Field key={key} label={key.replace(/_/g, ' ')} value={payload[key] || ''} onChange={(value) => set(key, value)} />
      ))}
      <FormActions onCancel={onCancel} onSubmit={() => onSubmit({ record_type: record.record_type, source_year: record.source_year, student_id: record.student_id, payload })} label="Save record" />
    </Modal>
  );
}

function SchemeForm({ onCancel, onSubmit }) {
  const [name, setName] = useState('IGCSE Standard Scheme');
  const [components, setComponents] = useState({
    Overall: {
      label: 'Overall Grade',
      maximum_score: 100,
      thresholds: { 'A*': 90, A: 80, B: 70, C: 60, D: 50, E: 40, U: 0 },
    },
  });

  return (
    <Modal title="New Grading Scheme" onCancel={onCancel}>
      <Field label="Scheme Name" value={name} onChange={setName} placeholder="Cambridge 0500 Scheme" />
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-bold text-slate-700">Threshold Boundaries for Overall (0 - 100)</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {['A*', 'A', 'B', 'C', 'D', 'E', 'U'].map((grade) => (
            <label key={grade} className="text-xs font-semibold text-slate-600">
              Min {grade}:
              <input
                type="number"
                value={components.Overall.thresholds[grade] ?? ''}
                onChange={(e) =>
                  setComponents({
                    ...components,
                    Overall: {
                      ...components.Overall,
                      thresholds: {
                        ...components.Overall.thresholds,
                        [grade]: Number(e.target.value),
                      },
                    },
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-1 text-center text-xs"
              />
            </label>
          ))}
        </div>
      </div>
      <FormActions onCancel={onCancel} onSubmit={() => onSubmit({ name, is_fallback: false, components })} label="Create Scheme" />
    </Modal>
  );
}

function Modal({ title, children, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-2xl" role="dialog" aria-modal="true">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-black">{title}</h2>
          <button type="button" onClick={onCancel} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder = '', type = 'text' }) {
  return (
    <label className="mb-4 block text-xs font-bold text-slate-600">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-400 focus:ring-4 focus:ring-teal-50"
      />
    </label>
  );
}

function FormActions({ onCancel, onSubmit, label }) {
  return (
    <div className="mt-6 flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="min-h-10 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 hover:bg-slate-50">
        Cancel
      </button>
      <button type="button" onClick={onSubmit} className="min-h-10 rounded-xl bg-teal-700 px-4 text-sm font-bold text-white shadow-sm hover:bg-teal-600">
        {label}
      </button>
    </div>
  );
}

function SimpleTable({ headers, rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-150 text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-400">
            {headers.map((header) => (
              <th key={header} className="px-3 py-3">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-3 text-slate-600">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="p-8 text-center text-sm text-slate-400">No records yet.</p>}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
    </div>
  );
}

function UnauthorizedThreeAlamatak() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="max-w-md text-center">
        <Users className="mx-auto h-12 w-12 text-teal-700" />
        <h1 className="mt-5 text-3xl font-black">Teacher access required</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">3alamatak is available to active teachers and administrators.</p>
      </div>
    </main>
  );
}

function viewTitle(view, gradebook) {
  if (view === 'dashboard') return 'Dashboard';
  if (view === 'classes') return gradebook?.title || 'Gradebooks';
  return views.find(([key]) => key === view)?.[1] || 'Workspace';
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function safeFilename(value) {
  return String(value || '3alamatak').replace(/[^\w-]+/g, '_');
}

function downloadText(text, name, type) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function backupToImportPackage(backup) {
  const students = (backup.students || []).map((student) => ({
    key: String(student.id || student.key || student.display_name),
    display_name: student.display_name,
    first_name: student.first_name,
    last_name: student.last_name,
    external_student_id: student.external_student_id,
    email: student.email,
    notes: student.notes,
  }));
  const componentsByAssessment = new Map();
  (backup.components || []).forEach((component) => {
    if (!componentsByAssessment.has(component.assessment_id)) componentsByAssessment.set(component.assessment_id, []);
    componentsByAssessment.get(component.assessment_id).push(component);
  });
  const marks = backup.marks || [];
  const assessments = (backup.assessments || []).map((assessment) => ({
    title: assessment.title,
    strand: assessment.strand,
    topic: assessment.topic,
    assessment_date: assessment.assessment_date,
    source_year: assessment.source_year,
    components: (componentsByAssessment.get(assessment.id) || []).map((component) => ({
      name: component.name,
      maximum_score: component.maximum_score,
    })),
    marks: marks
      .filter((mark) => (componentsByAssessment.get(assessment.id) || []).some((component) => component.id === mark.component_id))
      .map((mark) => ({
        student_key: String(mark.student_id),
        component_index: (componentsByAssessment.get(assessment.id) || []).findIndex((component) => component.id === mark.component_id),
        score: mark.score,
        mark_status: mark.mark_status,
        comment: mark.comment,
        follow_up_required: mark.follow_up_required,
      })),
  }));
  return {
    original_filename: '3alamatak-backup',
    academic_year: backup.gradebook?.academic_year || '2025-2026',
    detected_class: backup.gradebook?.title,
    detected_subject: backup.gradebook?.subject,
    workbook_type: 'backup',
    metadata: { restored_from: '3alamatak backup', original_exported_at: backup.exported_at },
    sheets: [],
    students,
    assessments,
    schemes: backup.schemes || [],
    historical_records: backup.historical_records || [],
  };
}
