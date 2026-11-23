const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(dateString, count) {
  const d = new Date(`${dateString}T12:00:00`);
  d.setDate(d.getDate() + count);
  return dateKey(d);
}

export function weekdayKey(dateString) {
  return DAY_KEYS[new Date(`${dateString}T12:00:00`).getDay()];
}

/**
 * Creates a forward-only plan for PENDING (not completed) questions.
 * Completed tasks are excluded and never moved.
 * Questions are always scheduled in source sequence.
 * Sprints are seven calendar day windows.
 */
export function generateSchedule({ questions, completedTaskIds = [], startDate, availability, pausedDates = [] }) {
  const completed = new Set(completedTaskIds);
  const pending = questions
    .filter(q => !completed.has(q.taskId))
    .slice()
    .sort((a, b) => a.sequence - b.sequence);
  const paused = new Set(pausedDates);
  const calendarDays = [];
  let cursor = 0;
  let date = startDate;
  let safety = 0;

  while (cursor < pending.length && safety < 5000) {
    safety += 1;
    const weekday = weekdayKey(date);
    // FIX 5: Ensure capacity is always a whole number of minutes (no floating point hours)
    const rawMins = Number(availability?.[weekday] || 0);
    const capacity = Math.max(0, Math.round(rawMins));
    const assigned = [];
    let used = 0;

    if (!paused.has(date) && capacity > 0) {
      while (cursor < pending.length) {
        const q = pending[cursor];
        // Strict ordering: never skip an earlier question to fit a later one.
        if (assigned.length && used + q.estimatedMinutes > capacity) break;
        assigned.push(q);
        used += q.estimatedMinutes;
        cursor += 1;
        // An oversized question is scheduled alone, never split.
        if (used >= capacity) break;
      }
    }

    calendarDays.push({
      date,
      weekday,
      capacityMinutes: capacity,
      estimatedMinutes: used,
      questions: assigned,
      isPaused: paused.has(date),
      isRestDay: capacity === 0 && !paused.has(date)
    });
    date = addDays(date, 1);
  }

  if (cursor < pending.length) throw new Error('Could not schedule all questions within the planning horizon.');

  const sprints = [];
  for (let i = 0; i < calendarDays.length; i += 7) {
    const sprintDays = calendarDays.slice(i, i + 7);
    const taskDays = sprintDays.filter(d => d.questions.length > 0);
    sprints.push({
      sprintNumber: sprints.length + 1,
      startDate: sprintDays[0]?.date,
      endDate: sprintDays[sprintDays.length - 1]?.date,
      estimatedMinutes: sprintDays.reduce((n, d) => n + d.estimatedMinutes, 0),
      questionCount: sprintDays.reduce((n, d) => n + d.questions.length, 0),
      days: sprintDays,
      taskDays
    });
  }

  const taskDays = calendarDays.filter(d => d.questions.length > 0);
  return {
    days: calendarDays,
    taskDays,
    sprints,
    pendingCount: pending.length,
    totalEstimatedMinutes: pending.reduce((n, q) => n + q.estimatedMinutes, 0),
    completionDate: taskDays.at(-1)?.date ?? startDate,
    calendarDays: calendarDays.length
  };
}

/**
 * FIX 5: makeUniformAvailability now accepts decimal hours and stores exact minutes.
 * e.g. 2.2 hrs -> 132 mins. The stepper steps in 30-min increments only.
 * Direct float input (e.g. 2.2) is preserved correctly.
 */
export function makeUniformAvailability(hoursPerDay) {
  const h = Number(hoursPerDay);
  if (isNaN(h)) return Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map(k => [k, 120]));
  // Store as integer minutes (round to nearest minute)
  const minutes = Math.max(0, Math.round(h * 60));
  return Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map(k => [k, minutes]));
}

export function weeklyMinutes(availability) {
  return Object.values(availability || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
}
