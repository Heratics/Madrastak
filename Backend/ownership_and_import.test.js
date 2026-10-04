const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const db = require('./db');
const app = require('./server');

function makeToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET || 'fallback_secret',
    { expiresIn: '1h' }
  );
}

test('3alamatak Multi-Teacher Isolation & Import Compatibility Suite', async (t) => {
  // Start server on an ephemeral port
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let teacherA, teacherB, adminUser;
  let gradebookAId, gradebookBId, assessmentBId;

  try {
    // 1. Fetch existing accounts from DB
    const [teachers] = await db.query(
      "SELECT id, email, role, full_name, account_status FROM users WHERE role = 'teacher' AND account_status = 'active' ORDER BY id ASC"
    );
    assert.ok(teachers.length >= 2, 'Need at least 2 active teacher accounts in database to verify isolation');
    teacherA = teachers[0]; // e.g. User 3 (Ahmad)
    teacherB = teachers[1]; // e.g. User 6 (Moayad)

    const [admins] = await db.query(
      "SELECT id, email, role, full_name, account_status FROM users WHERE role = 'admin' AND account_status = 'active' ORDER BY id ASC"
    );
    assert.ok(admins.length >= 1, 'Need at least 1 active admin account in database');
    adminUser = admins[0]; // e.g. User 20 (Heratics)

    const tokenA = makeToken(teacherA);
    const tokenB = makeToken(teacherB);
    const tokenAdmin = makeToken(adminUser);

    console.log(`Testing with Teacher A (${teacherA.id}: ${teacherA.email}), Teacher B (${teacherB.id}: ${teacherB.email}), Admin (${adminUser.id}: ${adminUser.email})`);

    // 2. Create Gradebook for Teacher A
    const resCreateA = await fetch(`${baseUrl}/api/3alamatak/gradebooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        title: `Isolation Test Gradebook A ${Date.now()}`,
        subject: 'Math',
        academic_year: '2026-2027',
      }),
      signal: AbortSignal.timeout(5000),
    });
    assert.strictEqual(resCreateA.status, 201);
    const createdA = await resCreateA.json();
    gradebookAId = createdA.id;
    assert.strictEqual(createdA.owner_user_id, teacherA.id);

    // 3. Create Gradebook for Teacher B
    const resCreateB = await fetch(`${baseUrl}/api/3alamatak/gradebooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenB}`,
      },
      body: JSON.stringify({
        title: `Isolation Test Gradebook B ${Date.now()}`,
        subject: 'Physics',
        academic_year: '2026-2027',
      }),
      signal: AbortSignal.timeout(5000),
    });
    assert.strictEqual(resCreateB.status, 201);
    const createdB = await resCreateB.json();
    gradebookBId = createdB.id;
    assert.strictEqual(createdB.owner_user_id, teacherB.id);

    // Add an assessment to Gradebook B
    const resAssB = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}/assessments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenB}`,
      },
      body: JSON.stringify({
        title: 'Quiz 1 Physics',
        components: [{ name: 'Part A', maximum_score: 20, sort_order: 0 }],
      }),
      signal: AbortSignal.timeout(5000),
    });
    assert.strictEqual(resAssB.status, 201);
    const createdAssB = await resAssB.json();
    assessmentBId = createdAssB.id;

    // Add a student to Gradebook B
    const resStudentB = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}/students`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenB}`,
      },
      body: JSON.stringify({
        first_name: 'Test',
        last_name: 'Student',
        display_name: 'Test Student',
        external_student_id: `STU-B-${Date.now()}`,
      }),
      signal: AbortSignal.timeout(5000),
    });
    assert.strictEqual(resStudentB.status, 201);

    // ----------------------------------------------------------------------
    // TEST 1: Teacher A gradebook listing ONLY includes Teacher A's gradebooks
    // ----------------------------------------------------------------------
    await t.test('Teacher A sees only their own gradebooks in list', async () => {
      const res = await fetch(`${baseUrl}/api/3alamatak/gradebooks`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        signal: AbortSignal.timeout(5000),
      });
      assert.strictEqual(res.status, 200);
      const listA = await res.json();
      assert.ok(Array.isArray(listA));
      assert.ok(listA.some((g) => g.id === gradebookAId), 'Teacher A must see their own gradebook');
      assert.ok(!listA.some((g) => g.id === gradebookBId), 'Teacher A must NOT see Teacher B gradebook');
      for (const g of listA) {
        assert.strictEqual(g.owner_user_id, teacherA.id, 'All listed gradebooks must belong to Teacher A');
      }
    });

    // ----------------------------------------------------------------------
    // TEST 2: Teacher B gradebook listing ONLY includes Teacher B's gradebooks
    // ----------------------------------------------------------------------
    await t.test('Teacher B sees only their own gradebooks in list', async () => {
      const res = await fetch(`${baseUrl}/api/3alamatak/gradebooks`, {
        headers: { Authorization: `Bearer ${tokenB}` },
        signal: AbortSignal.timeout(5000),
      });
      assert.strictEqual(res.status, 200);
      const listB = await res.json();
      assert.ok(Array.isArray(listB));
      assert.ok(listB.some((g) => g.id === gradebookBId), 'Teacher B must see their own gradebook');
      assert.ok(!listB.some((g) => g.id === gradebookAId), 'Teacher B must NOT see Teacher A gradebook');
      for (const g of listB) {
        assert.strictEqual(g.owner_user_id, teacherB.id, 'All listed gradebooks must belong to Teacher B');
      }
    });

    // ----------------------------------------------------------------------
    // TEST 3: Teacher A CANNOT access Teacher B's gradebook by ID (404)
    // ----------------------------------------------------------------------
    await t.test('Teacher A cannot access Teacher B gradebook details', async () => {
      const res = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        signal: AbortSignal.timeout(5000),
      });
      assert.strictEqual(res.status, 404, 'Direct access to other teacher gradebook must return 404');
    });

    // ----------------------------------------------------------------------
    // TEST 4: Teacher A CANNOT access Teacher B's sub-resources (students, assessments, analytics, export)
    // ----------------------------------------------------------------------
    await t.test('Teacher A cannot access Teacher B sub-resources', async () => {
      // Students
      const resStudents = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}/students`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        signal: AbortSignal.timeout(5000),
      });
      assert.strictEqual(resStudents.status, 404);

      // Assessments
      const resAssessments = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}/assessments`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        signal: AbortSignal.timeout(5000),
      });
      assert.strictEqual(resAssessments.status, 404);

      // Analytics
      const resAnalytics = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}/analytics`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        signal: AbortSignal.timeout(5000),
      });
      assert.strictEqual(resAnalytics.status, 404);

      // Export
      const resExport = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}/export`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        signal: AbortSignal.timeout(5000),
      });
      assert.strictEqual(resExport.status, 404);

      // Schemes
      const resSchemes = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}/schemes`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        signal: AbortSignal.timeout(5000),
      });
      assert.strictEqual(resSchemes.status, 404);

      // Historical records
      const resHistory = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}/historical-records`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        signal: AbortSignal.timeout(5000),
      });
      assert.strictEqual(resHistory.status, 404);

      // Assessment marks
      const resMarks = await fetch(`${baseUrl}/api/3alamatak/assessments/${assessmentBId}/marks`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        signal: AbortSignal.timeout(5000),
      });
      assert.strictEqual(resMarks.status, 404);
    });

    // ----------------------------------------------------------------------
    // TEST 5: Teacher A CANNOT import or analyze into Teacher B's gradebook
    // ----------------------------------------------------------------------
    await t.test('Teacher A cannot import into Teacher B gradebook', async () => {
      const boundary = '----WebKitFormBoundaryTestImport';
      const fileHeader = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.csv"\r\nContent-Type: text/csv\r\n\r\nName,ID\nStudent 1,S01\r\n--${boundary}--\r\n`
      );

      const resAnalyze = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}/imports/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          Authorization: `Bearer ${tokenA}`,
        },
        body: fileHeader,
        signal: AbortSignal.timeout(5000),
      });
      assert.strictEqual(resAnalyze.status, 404);

      const resImport = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}/imports`, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          Authorization: `Bearer ${tokenA}`,
        },
        body: fileHeader,
        signal: AbortSignal.timeout(5000),
      });
      assert.strictEqual(resImport.status, 404);
    });

    // ----------------------------------------------------------------------
    // TEST 6: BUG 1 Regression Test — Analyze & Import with status = 'active'
    // ----------------------------------------------------------------------
    await t.test('Analyze & Import executes without Unknown column active error', async () => {
      const boundary = '----WebKitFormBoundaryValidImport';
      const csvContent = 'Student Name,ID,Quiz 1\nTest Student,STU-B-01,18\nNew Student,STU-B-02,15';
      const fileHeader = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="grade_test.csv"\r\nContent-Type: text/csv\r\n\r\n${csvContent}\r\n--${boundary}--\r\n`
      );

      // Analyze endpoint on Teacher B's own gradebook
      const resAnalyze = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}/imports/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          Authorization: `Bearer ${tokenB}`,
        },
        body: fileHeader,
        signal: AbortSignal.timeout(5000),
      });

      const analyzeJson = await resAnalyze.json();
      assert.strictEqual(resAnalyze.status, 200, `Expected 200 OK, got ${resAnalyze.status}: ${JSON.stringify(analyzeJson)}`);
      assert.ok(analyzeJson.pkg, 'Must return parsed pkg');
      assert.strictEqual(analyzeJson.sheets.length, 1);
      assert.ok(analyzeJson.pkg.summary.studentsCount > 0);

      // Import commit endpoint
      const resImport = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}/imports`, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          Authorization: `Bearer ${tokenB}`,
        },
        body: fileHeader,
        signal: AbortSignal.timeout(5000),
      });

      const importJson = await resImport.json();
      assert.strictEqual(resImport.status, 201, `Expected 201 Created, got ${resImport.status}: ${JSON.stringify(importJson)}`);
      assert.ok(importJson.import_id > 0);
    });

    await t.test('Gradebook lifecycle supports edit, archive filtering, restore, and permanent deletion', async () => {
      const headersA = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` };
      const editResponse = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookAId}`, {
        method: 'PUT', headers: headersA,
        body: JSON.stringify({ title: 'Edited Lifecycle Gradebook', description: 'Persistent description', subject: 'Biology', academic_year: '2027-2028' }),
      });
      assert.strictEqual(editResponse.status, 200);
      const edited = await editResponse.json();
      assert.equal(edited.title, 'Edited Lifecycle Gradebook');
      assert.equal(edited.description, 'Persistent description');

      const invalidEdit = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookAId}`, {
        method: 'PUT', headers: headersA,
        body: JSON.stringify({ title: '', academic_year: '2027-2028' }),
      });
      assert.strictEqual(invalidEdit.status, 400);
      const editOther = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}`, {
        method: 'PUT', headers: headersA,
        body: JSON.stringify({ title: 'Unauthorized edit', academic_year: '2027-2028' }),
      });
      assert.strictEqual(editOther.status, 404, 'Another teacher cannot edit this gradebook');

      const archiveResponse = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}`, { method: 'DELETE', headers: headersA });
      assert.strictEqual(archiveResponse.status, 404, 'Another teacher cannot archive this gradebook');
      const ownArchive = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokenB}` } });
      assert.strictEqual(ownArchive.status, 200);

      const activeList = await (await fetch(`${baseUrl}/api/3alamatak/gradebooks?status=active`, { headers: { Authorization: `Bearer ${tokenB}` } })).json();
      assert.ok(!activeList.some((gradebook) => gradebook.id === gradebookBId));
      const archivedList = await (await fetch(`${baseUrl}/api/3alamatak/gradebooks?status=archived`, { headers: { Authorization: `Bearer ${tokenB}` } })).json();
      assert.ok(archivedList.some((gradebook) => gradebook.id === gradebookBId));

      const restoreResponse = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}/restore`, { method: 'POST', headers: { Authorization: `Bearer ${tokenB}` } });
      assert.strictEqual(restoreResponse.status, 200);
      const restored = await restoreResponse.json();
      assert.equal(restored.status, 'active');
      const restoredAssessments = await (await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}/assessments`, { headers: { Authorization: `Bearer ${tokenB}` } })).json();
      assert.ok(restoredAssessments.some((assessment) => assessment.id === assessmentBId), 'Archive/restore preserves gradebook data');

      const archiveA = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookAId}`, { method: 'DELETE', headers: headersA });
      assert.strictEqual(archiveA.status, 200);
      const deleteOther = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookBId}/permanent`, { method: 'DELETE', headers: headersA });
      assert.strictEqual(deleteOther.status, 404, 'Another teacher cannot permanently delete this gradebook');
      const tempCreate = await fetch(`${baseUrl}/api/3alamatak/gradebooks`, {
        method: 'POST', headers: headersA,
        body: JSON.stringify({ title: `Permanent Delete Test ${Date.now()}`, academic_year: '2027-2028' }),
      });
      const tempGradebook = await tempCreate.json();
      const tempArchive = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${tempGradebook.id}`, { method: 'DELETE', headers: headersA });
      assert.strictEqual(tempArchive.status, 200);
      const permanentDelete = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${tempGradebook.id}/permanent`, { method: 'DELETE', headers: headersA });
      assert.strictEqual(permanentDelete.status, 200);
      const gone = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${tempGradebook.id}`, { headers: headersA });
      assert.strictEqual(gone.status, 404);
    });

    // ----------------------------------------------------------------------
    // TEST 7: Admin access rules
    // ----------------------------------------------------------------------
    await t.test('Admin gradebook listing & authorized access', async () => {
      // Default listing without ?all=true only shows admin's own gradebooks
      const resDefault = await fetch(`${baseUrl}/api/3alamatak/gradebooks`, {
        headers: { Authorization: `Bearer ${tokenAdmin}` },
        signal: AbortSignal.timeout(5000),
      });
      assert.strictEqual(resDefault.status, 200);
      const adminDefaultList = await resDefault.json();
      for (const g of adminDefaultList) {
        assert.strictEqual(g.owner_user_id, adminUser.id);
      }

      // Listing with ?all=true includes all gradebooks across the system
      const resAll = await fetch(`${baseUrl}/api/3alamatak/gradebooks?all=true`, {
        headers: { Authorization: `Bearer ${tokenAdmin}` },
        signal: AbortSignal.timeout(5000),
      });
      assert.strictEqual(resAll.status, 200);
      const adminAllList = await resAll.json();
      assert.ok(adminAllList.some((g) => g.id === gradebookAId));
      assert.ok(adminAllList.some((g) => g.id === gradebookBId));

      // Admin can view any gradebook details (authorized)
      const resDetailA = await fetch(`${baseUrl}/api/3alamatak/gradebooks/${gradebookAId}`, {
        headers: { Authorization: `Bearer ${tokenAdmin}` },
        signal: AbortSignal.timeout(5000),
      });
      assert.strictEqual(resDetailA.status, 200);
    });

  } finally {
    // Cleanup temporary test gradebooks
    if (gradebookAId) {
      await db.query('DELETE FROM alamatak_gradebooks WHERE id = ?', [gradebookAId]).catch(() => {});
    }
    if (gradebookBId) {
      await db.query('DELETE FROM alamatak_gradebooks WHERE id = ?', [gradebookBId]).catch(() => {});
    }
    server.close();
    await db.end();
  }
});
