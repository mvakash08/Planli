import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule, makeUniformAvailability, weeklyMinutes } from '../src/lib/scheduler.js';
import master from '../src/data/striver180.json' with { type: 'json' };
import striverA2Z from '../src/data/striverA2Z.json' with { type: 'json' };

const allHours = makeUniformAvailability(2);

test('striverA2Z dataset contains 496 unique items and 11518 estimated minutes', () => {
  assert.equal(striverA2Z.questions.length, 496);
  assert.equal(new Set(striverA2Z.questions.map(q => q.taskId)).size, 496);
  assert.equal(striverA2Z.questions.reduce((n, q) => n + q.estimatedMinutes, 0), 11518);
});

test('scheduler correctly processes all 496 items in striverA2Z', () => {
  const result = generateSchedule({ questions: striverA2Z.questions, startDate: '2026-11-24', availability: makeUniformAvailability(2.2) });
  assert.equal(result.pendingCount, 496);
  assert.ok(result.sprints.length > 0);
  const scheduledIds = result.taskDays.flatMap(d => d.questions.map(q => q.taskId));
  assert.equal(scheduledIds.length, 496);
  assert.deepEqual(scheduledIds, striverA2Z.questions.map(q => q.taskId));
});

test('source dataset contains 179 unique questions and 3938 estimated minutes', () => {
  assert.equal(master.questions.length, 179);
  assert.equal(new Set(master.questions.map(q => q.taskId)).size, 179);
  assert.equal(master.questions.reduce((n, q) => n + q.estimatedMinutes, 0), 3938);
});

test('scheduler preserves strict question order', () => {
  const result = generateSchedule({ questions: master.questions, startDate: '2026-11-20', availability: allHours });
  const ids = result.taskDays.flatMap(d => d.questions.map(q => q.taskId));
  assert.deepEqual(ids, master.questions.map(q => q.taskId));
});

test('completed questions stay out of the pending schedule', () => {
  const completed = master.questions.slice(0, 3).map(q => q.taskId);
  const result = generateSchedule({ questions: master.questions, completedTaskIds: completed, startDate: '2026-11-20', availability: allHours });
  const ids = result.taskDays.flatMap(d => d.questions.map(q => q.taskId));
  assert.equal(ids.length, 176);
  assert.ok(completed.every(id => !ids.includes(id)));
  assert.deepEqual(ids, master.questions.slice(3).map(q => q.taskId));
});

test('paused calendar day is retained but has no tasks; work shifts to next available day', () => {
  const questions = master.questions.slice(0, 4);
  const result = generateSchedule({ questions, startDate: '2026-11-20', availability: allHours, pausedDates: ['2026-11-20'] });
  assert.equal(result.days[0].date, '2026-11-20');
  assert.equal(result.days[0].questions.length, 0);
  assert.equal(result.days[0].isPaused, true);
  assert.equal(result.taskDays[0].date, '2026-11-21');
});

test('weekly availability changes completion date and sprint grouping', () => {
  const low = generateSchedule({ questions: master.questions, startDate: '2026-11-20', availability: makeUniformAvailability(1) });
  const high = generateSchedule({ questions: master.questions, startDate: '2026-11-20', availability: makeUniformAvailability(4) });
  assert.ok(high.completionDate <= low.completionDate);
  assert.ok(high.sprints.length <= low.sprints.length);
});

test('sprints are seven-calendar-day windows, including rest days', () => {
  const availability = { mon: 120, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };
  const result = generateSchedule({ questions: master.questions.slice(0, 8), startDate: '2026-11-16', availability });
  assert.equal(result.sprints[0].days.length, 7);
  assert.equal(result.sprints[0].days[1].isRestDay, true);
});

test('weekly minutes sums weekday commitments', () => {
  assert.equal(weeklyMinutes(makeUniformAvailability(2)), 840);
});

test('two-hour original availability reproduces supplied six-sprint baseline', () => {
  const result = generateSchedule({
    questions: master.questions,
    startDate: master.originalPlan.startDate,
    availability: makeUniformAvailability(2)
  });
  assert.equal(result.sprints.length, master.originalPlan.sprintCount);
  assert.equal(result.completionDate, master.originalPlan.initialCompletionDate);
  assert.equal(result.days.length, master.originalPlan.plannedDays);
  for (const originalSprint of master.originalPlan.sprints) {
    const actualSprint = result.sprints[originalSprint.sprintNumber - 1];
    assert.equal(actualSprint.startDate, originalSprint.startDate);
    assert.equal(actualSprint.endDate, originalSprint.endDate);
    for (const originalDay of originalSprint.days) {
      const actualDay = result.days.find(day => day.date === originalDay.date);
      assert.deepEqual(actualDay.questions.map(q => q.taskId), originalDay.questionIds);
      assert.equal(actualDay.estimatedMinutes, originalDay.estimatedMinutes);
    }
  }
});
