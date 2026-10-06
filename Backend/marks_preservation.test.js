const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('./db');
const { calculateComponentMarks } = require('./componentCalculation');

test('CRITICAL P0: Marks preservation regression suite across component mutations', async () => {
  // Use Teacher A (id: 3 or first available teacher)
  const [teachers] = await db.query("SELECT id, email, role FROM users WHERE role = 'teacher' LIMIT 1");
  assert.ok(teachers.length > 0, 'Must have at least one teacher user in DB');
  const teacher = teachers[0];

  // 1. Create isolated test gradebook
  const [gbRes] = await db.query(
    "INSERT INTO alamatak_gradebooks (owner_user_id, title, academic_year, status) VALUES (?, 'P0 Marks Preservation Test', '2026-2027', 'active')",
    [teacher.id]
  );
  const gradebookId = gbRes.insertId;

  try {
    // 2. Create student
    const [stRes] = await db.query(
      "INSERT INTO alamatak_students (gradebook_id, display_name, status) VALUES (?, 'Ahmad Alshara', 'active')",
      [gradebookId]
    );
    const studentId = stRes.insertId;

    // 3. Create assessment with Q1 (/5) and Q2 (/10)
    const [assRes] = await db.query(
      "INSERT INTO alamatak_assessments (gradebook_id, title) VALUES (?, 'Midterm Exam')",
      [gradebookId]
    );
    const assessmentId = assRes.insertId;

    const [q1Res] = await db.query(
      "INSERT INTO alamatak_assessment_components (assessment_id, name, maximum_score, sort_order, component_type) VALUES (?, 'Q1', 5, 0, 'input')",
      [assessmentId]
    );
    const q1Id = q1Res.insertId;

    const [q2Res] = await db.query(
      "INSERT INTO alamatak_assessment_components (assessment_id, name, maximum_score, sort_order, component_type) VALUES (?, 'Q2', 10, 1, 'input')",
      [assessmentId]
    );
    const q2Id = q2Res.insertId;

    // 4. Enter marks: Q1 = 4, Q2 = 8
    await db.query(
      "INSERT INTO alamatak_marks (component_id, student_id, score) VALUES (?, ?, 4), (?, ?, 8)",
      [q1Id, studentId, q2Id, studentId]
    );

    // Verify initial marks
    const [initialMarks] = await db.query(
      "SELECT component_id, student_id, score FROM alamatak_marks WHERE student_id = ? ORDER BY component_id",
      [studentId]
    );
    assert.equal(initialMarks.length, 2);
    assert.equal(Number(initialMarks.find((m) => m.component_id === q1Id).score), 4);
    assert.equal(Number(initialMarks.find((m) => m.component_id === q2Id).score), 8);

    // 5. Simulate Teacher adding Total component: Total = Q1 + Q2 (via PUT assessment logic)
    const componentsPayload = [
      { id: String(q1Id), rawId: q1Id, name: 'Q1', maximum_score: 5, sort_order: 0, component_type: 'input' },
      { id: String(q2Id), rawId: q2Id, name: 'Q2', maximum_score: 10, sort_order: 1, component_type: 'input' },
      { id: 'comp_new_total', name: 'Total', maximum_score: 15, sort_order: 2, component_type: 'calculated', calculation_type: 'sum', source_component_ids: [String(q1Id), String(q2Id)] },
    ];

    // Emulate PUT assessment endpoint logic
    const [existingComponents] = await db.query(
      'SELECT id, name, maximum_score, sort_order, component_type, calculation_type, source_component_ids, formula_definition FROM alamatak_assessment_components WHERE assessment_id = ? ORDER BY sort_order, id',
      [assessmentId]
    );
    const existingIds = new Set(existingComponents.map((c) => Number(c.id)));
    const retainedIds = new Set();
    const idMapping = new Map();
    const pendingCalculated = [];

    for (const component of componentsPayload) {
      const numId = component.rawId ? Number(component.rawId) : (component.id && Number.isInteger(Number(component.id))) ? Number(component.id) : null;
      if (numId !== null && existingIds.has(numId)) {
        retainedIds.add(numId);
        idMapping.set(String(component.id), numId);
        if (component.rawId) idMapping.set(String(component.rawId), numId);
        await db.query(
          `UPDATE alamatak_assessment_components
           SET name = ?, maximum_score = ?, sort_order = ?, component_type = ?, calculation_type = ?, source_component_ids = ?, formula_definition = ?
           WHERE id = ? AND assessment_id = ?`,
          [component.name, component.maximum_score, component.sort_order, component.component_type || 'input', component.calculation_type || null, component.source_component_ids ? JSON.stringify(component.source_component_ids) : null, null, numId, assessmentId]
        );
      } else {
        const [created] = await db.query(
          `INSERT INTO alamatak_assessment_components
           (assessment_id, name, maximum_score, sort_order, component_type, calculation_type, source_component_ids, formula_definition)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [assessmentId, component.name, component.maximum_score, component.sort_order, component.component_type || 'input', component.calculation_type || null, component.source_component_ids ? JSON.stringify(component.source_component_ids) : null, null]
        );
        const insertedId = Number(created.insertId);
        retainedIds.add(insertedId);
        idMapping.set(String(component.id), insertedId);
        if (component.component_type === 'calculated') {
          pendingCalculated.push({ compId: insertedId, sourceIds: component.source_component_ids });
        }
      }
    }
    for (const calc of pendingCalculated) {
      const remapped = (calc.sourceIds || []).map((sId) => idMapping.get(String(sId)) || (Number.isInteger(Number(sId)) ? Number(sId) : sId));
      await db.query(
        'UPDATE alamatak_assessment_components SET source_component_ids = ? WHERE id = ? AND assessment_id = ?',
        [JSON.stringify(remapped), calc.compId, assessmentId]
      );
    }
    const removedIds = [...existingIds].filter((id) => !retainedIds.has(id));
    if (removedIds.length) {
      await db.query(
        `DELETE FROM alamatak_assessment_components WHERE assessment_id = ? AND id IN (${removedIds.map(() => '?').join(',')})`,
        [assessmentId, ...removedIds]
      );
    }

    // 6. VERIFY MARKS AFTER ADDING TOTAL
    const [marksAfterTotal] = await db.query(
      "SELECT component_id, student_id, score FROM alamatak_marks WHERE student_id = ? ORDER BY component_id",
      [studentId]
    );
    assert.equal(marksAfterTotal.length, 2, 'Marks must NOT be deleted after adding Total component!');
    assert.equal(Number(marksAfterTotal.find((m) => m.component_id === q1Id).score), 4, 'Q1 mark must remain 4');
    assert.equal(Number(marksAfterTotal.find((m) => m.component_id === q2Id).score), 8, 'Q2 mark must remain 8');

    // 7. Verify dynamic calculation of Total: 4 + 8 = 12/15
    const [allCompsAfterTotal] = await db.query(
      'SELECT id, name, maximum_score, sort_order, component_type, calculation_type, source_component_ids FROM alamatak_assessment_components WHERE assessment_id = ? ORDER BY sort_order, id',
      [assessmentId]
    );
    const totalComp = allCompsAfterTotal.find((c) => c.component_type === 'calculated');
    assert.ok(totalComp, 'Total component must exist');

    // Pass components with string IDs to test calculator resilience
    const computed = calculateComponentMarks(allCompsAfterTotal, marksAfterTotal);
    assert.equal(computed[String(totalComp.id)].score, 12, 'Calculated total score must be 12 (4 + 8)');

    // 8. Update Q1 mark from 4 to 5
    await db.query(
      "UPDATE alamatak_marks SET score = 5 WHERE component_id = ? AND student_id = ?",
      [q1Id, studentId]
    );
    const [marksAfterUpdate] = await db.query(
      "SELECT component_id, student_id, score FROM alamatak_marks WHERE student_id = ? ORDER BY component_id",
      [studentId]
    );
    assert.equal(Number(marksAfterUpdate.find((m) => m.component_id === q1Id).score), 5);
    assert.equal(Number(marksAfterUpdate.find((m) => m.component_id === q2Id).score), 8);

    const recomputed = calculateComponentMarks(allCompsAfterTotal, marksAfterUpdate);
    assert.equal(recomputed[String(totalComp.id)].score, 13, 'Calculated total score must now be 13 (5 + 8)');

    // 9. Reorder components (e.g. Q2 before Q1)
    await db.query("UPDATE alamatak_assessment_components SET sort_order = 1 WHERE id = ?", [q1Id]);
    await db.query("UPDATE alamatak_assessment_components SET sort_order = 0 WHERE id = ?", [q2Id]);
    const [marksAfterReorder] = await db.query(
      "SELECT component_id, student_id, score FROM alamatak_marks WHERE student_id = ? ORDER BY component_id",
      [studentId]
    );
    assert.equal(Number(marksAfterReorder.find((m) => m.component_id === q1Id).score), 5);
    assert.equal(Number(marksAfterReorder.find((m) => m.component_id === q2Id).score), 8);

    // 10. Delete Total component (only the calculated component)
    await db.query("DELETE FROM alamatak_assessment_components WHERE id = ?", [totalComp.id]);
    const [marksAfterDeleteTotal] = await db.query(
      "SELECT component_id, student_id, score FROM alamatak_marks WHERE student_id = ? ORDER BY component_id",
      [studentId]
    );
    assert.equal(marksAfterDeleteTotal.length, 2, 'Q1 and Q2 marks must remain 100% intact after deleting Total');
    assert.equal(Number(marksAfterDeleteTotal.find((m) => m.component_id === q1Id).score), 5);
    assert.equal(Number(marksAfterDeleteTotal.find((m) => m.component_id === q2Id).score), 8);

  } finally {
    // Cleanup test gradebook
    await db.query('DELETE FROM alamatak_gradebooks WHERE id = ?', [gradebookId]);
    await db.end();
  }
});
