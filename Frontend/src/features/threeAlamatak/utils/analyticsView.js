export function formatAnalyticsPercent(value) {
  return value == null ? '—' : `${Number(value).toFixed(1)}%`;
}

export function analyticsBarWidth(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

export function buildAnalyticsDashboardModel(data = {}, studentId = '') {
  const percent = formatAnalyticsPercent;
  return {
    cards: [
      ['Class average', percent(data.class_average)],
      ['Median', percent(data.median)],
      ['Highest', percent(data.highest)],
      ['Lowest', percent(data.lowest)],
      ['Completion', percent(data.summary?.completion_percent)],
      ['Missing', data.summary?.missing_count || 0],
      ['Absent', data.summary?.absent_count || 0],
    ],
    assessmentRows: (data.assessments || []).map((item) => [item.title, percent(item.average), percent(item.median), percent(item.highest), percent(item.lowest), percent(item.completion_percent), item.missing_count, item.absent_count]),
    componentRows: (data.components || []).map((item) => [`${item.assessment_title} · ${item.name}`, percent(item.average_percent), percent(item.highest_percent), percent(item.lowest_percent), item.valid_marks, percent(item.completion_percent), item.missing_count, item.absent_count]),
    attentionRows: (data.needs_attention || []).map((row) => [row.display_name, percent(row.percent), row.missing_marks, row.absent_marks, (row.attention_reasons || []).join('; ')]),
    finalGradeRows: Object.entries(data.final_grades?.grade_counts || {}).map(([label, count]) => [label, count]),
    progressRows: studentId ? (data.student_progress?.rows || []).map((item) => [item.title, item.assessment_date || '—', percent(item.percent), `${item.recorded_marks}/${item.expected_marks}`, item.absent_marks]) : [],
  };
}
