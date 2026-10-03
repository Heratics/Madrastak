export function toEditableClassState(classRecord) {
  if (!classRecord || classRecord.id == null) return null;
  const start = classRecord.start_time ? new Date(classRecord.start_time) : null;
  const localStart = start && !Number.isNaN(start.getTime())
    ? new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : '';
  const isNoLimitDuration = Number(classRecord.duration_minutes) >= 999999;
  return {
    open: true,
    classId: classRecord.id,
    title: classRecord.title || '',
    description: classRecord.description || '',
    startTime: localStart,
    isNoLimitDuration,
    durationMinutes: isNoLimitDuration ? '60' : String(classRecord.duration_minutes || 60),
    studentLimit: String(classRecord.student_limit || 20),
    submitting: false,
  };
}

export function toClassUpdatePayload(editState) {
  if (!editState || !editState.startTime) throw new Error('A scheduled start time is required.');
  const startTime = new Date(editState.startTime);
  if (Number.isNaN(startTime.getTime())) throw new Error('A valid scheduled start time is required.');
  return {
    title: editState.title.trim(),
    description: editState.description.trim(),
    start_time: startTime.toISOString(),
    duration_minutes: editState.isNoLimitDuration ? 999999 : parseInt(editState.durationMinutes, 10),
    student_limit: Number(editState.studentLimit),
  };
}
