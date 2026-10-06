/**
 * 3alamatak Frontend Assessment Component Calculation Engine
 */

export function normalizeSourceComponentIds(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

export function validateComponentDefinitions(rawComponents) {
  if (!Array.isArray(rawComponents) || rawComponents.length === 0) {
    return { valid: false, errors: ['Assessment must have at least one component.'], components: [], topologicalOrder: [] };
  }

  const errors = [];
  const componentMap = new Map();

  const components = rawComponents.map((c, index) => {
    const id = c.id !== undefined && c.id !== null ? String(c.id) : `comp_${index}`;
    const name = String(c.name || '').trim();
    const type = c.component_type === 'calculated' ? 'calculated' : 'input';
    const calcType = type === 'calculated' ? (c.calculation_type || 'sum').toLowerCase() : null;
    const sourceIds = type === 'calculated' ? normalizeSourceComponentIds(c.source_component_ids) : [];
    const max = Number(c.maximum_score ?? c.max ?? 0);

    const item = {
      ...c,
      id,
      rawId: c.id !== undefined && c.id !== null ? c.id : null,
      name,
      component_type: type,
      calculation_type: calcType,
      source_component_ids: sourceIds,
      maximum_score: Number.isFinite(max) ? max : 0,
      sort_order: Number.isInteger(c.sort_order) ? c.sort_order : index,
      formula_definition: c.formula_definition || null,
    };
    componentMap.set(id, item);
    return item;
  });

  // Basic validation
  components.forEach((c) => {
    if (!c.name) errors.push(`Component at position ${c.sort_order + 1} is missing a name.`);
    if (c.component_type === 'input') {
      if (c.maximum_score <= 0) {
        errors.push(`Input component "${c.name || 'Unnamed'}" must have a maximum score greater than 0.`);
      }
    } else {
      if (!c.source_component_ids.length) {
        errors.push(`Calculated component "${c.name || 'Unnamed'}" must select at least one source component.`);
      }
      for (const srcId of c.source_component_ids) {
        if (srcId === c.id) {
          errors.push(`Calculated component "${c.name}" cannot depend on itself.`);
        } else if (!componentMap.has(srcId)) {
          errors.push(`Calculated component "${c.name}" references non-existent component.`);
        }
      }
    }
  });

  if (errors.length) {
    return { valid: false, errors, components, topologicalOrder: [] };
  }

  // Cycle detection & Topological Sort via DFS
  const visited = new Map();
  const order = [];

  function visit(nodeId, path = []) {
    const state = visited.get(nodeId) || 0;
    if (state === 1) {
      const cyclePath = [...path, nodeId].map((id) => componentMap.get(id)?.name || id).join(' -> ');
      errors.push(`Circular dependency detected: ${cyclePath}`);
      return false;
    }
    if (state === 2) return true;

    visited.set(nodeId, 1);
    const node = componentMap.get(nodeId);
    if (node && node.component_type === 'calculated') {
      for (const depId of node.source_component_ids) {
        if (componentMap.has(depId)) {
          if (!visit(depId, [...path, nodeId])) return false;
        }
      }
    }
    visited.set(nodeId, 2);
    order.push(nodeId);
    return true;
  }

  for (const c of components) {
    if (!visited.get(c.id)) {
      if (!visit(c.id)) break;
    }
  }

  if (errors.length) {
    return { valid: false, errors, components, topologicalOrder: [] };
  }

  // Auto-calculate maximum_score for calculated sum components
  for (const nodeId of order) {
    const comp = componentMap.get(nodeId);
    if (comp.component_type === 'calculated' && (comp.calculation_type === 'sum' || comp.calculation_type === 'total')) {
      const sumMax = comp.source_component_ids.reduce((sum, srcId) => {
        const src = componentMap.get(srcId);
        return sum + (src ? Number(src.maximum_score || 0) : 0);
      }, 0);
      comp.maximum_score = sumMax;
    }
  }

  return { valid: true, errors: [], components, topologicalOrder: order };
}

export function calculateComponentMarks(components, studentMarks) {
  const validation = validateComponentDefinitions(components);
  const compMap = new Map(validation.components.map((c) => [c.id, c]));

  const marksMap = {};
  if (Array.isArray(studentMarks)) {
    studentMarks.forEach((m) => {
      marksMap[String(m.component_id)] = {
        score: m.score === '' || m.score === null || m.score === undefined ? null : Number(m.score),
        mark_status: m.mark_status || null,
        comment: m.comment || null,
        follow_up_required: Boolean(m.follow_up_required),
      };
    });
  } else if (studentMarks && typeof studentMarks === 'object') {
    Object.entries(studentMarks).forEach(([k, v]) => {
      if (typeof v === 'object' && v !== null) {
        marksMap[String(k)] = {
          score: v.score === '' || v.score === null || v.score === undefined ? null : Number(v.score),
          mark_status: v.mark_status || null,
          comment: v.comment || null,
          follow_up_required: Boolean(v.follow_up_required),
        };
      } else {
        marksMap[String(k)] = {
          score: v === '' || v === null || v === undefined ? null : Number(v),
          mark_status: null,
          comment: null,
          follow_up_required: false,
        };
      }
    });
  }

  const result = { ...marksMap };

  // Calculate in topological order
  for (const compId of validation.topologicalOrder || []) {
    const comp = compMap.get(compId);
    if (!comp || comp.component_type !== 'calculated') continue;

    const sourceMarks = comp.source_component_ids.map((srcId) => result[srcId] || { score: null, mark_status: null });

    const allExempt = sourceMarks.length > 0 && sourceMarks.every((m) => /exempt/i.test(m.mark_status || ''));
    if (allExempt) {
      result[compId] = { score: null, mark_status: 'exempt', is_calculated: true };
      continue;
    }

    const allAbsent = sourceMarks.length > 0 && sourceMarks.every((m) => /absent/i.test(m.mark_status || '') && (m.score === null || m.score === undefined));
    if (allAbsent) {
      result[compId] = { score: null, mark_status: 'absent', is_calculated: true };
      continue;
    }

    let sum = 0;
    let anyScore = false;
    let hasMissing = false;

    for (const m of sourceMarks) {
      if (m.score !== null && m.score !== undefined && Number.isFinite(Number(m.score))) {
        sum += Number(m.score);
        anyScore = true;
      } else if (!/exempt/i.test(m.mark_status || '')) {
        hasMissing = true;
      }
    }

    if (!anyScore && hasMissing) {
      result[compId] = { score: null, mark_status: null, is_calculated: true };
    } else {
      result[compId] = {
        score: Math.round(sum * 100) / 100,
        mark_status: hasMissing ? 'partial' : null,
        is_calculated: true,
      };
    }
  }

  return result;
}
