/**
 * Planli – Striver 180 Sprint Schedule PDF Generator
 * Run: node generate-pdf.js
 * Output: planli-sprint-schedule.html  (open in browser → Print → Save as PDF)
 *
 * Schedule: 2.2 hrs (132 min) per day, starting Nov 23, 2026
 */

const fs = require('fs');
const path = require('path');

// Load questions
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/data/striver180.json'), 'utf8'));
const questions = data.questions.slice().sort((a, b) => a.sequence - b.sequence);

// Schedule settings
const DAILY_MINS = 132; // 2.2 hrs
const START_DATE = '2026-11-23';

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtDate(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
  });
}

function fmtMins(m) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? `${h}h ${min > 0 ? min + 'm' : ''}`.trim() : `${min}m`;
}

// Build schedule
const days = [];
let cursor = 0;
let dayNum = 0;

while (cursor < questions.length && dayNum < 500) {
  const date = addDays(START_DATE, dayNum);
  const assigned = [];
  let used = 0;

  while (cursor < questions.length) {
    const q = questions[cursor];
    if (assigned.length > 0 && used + q.estimatedMinutes > DAILY_MINS) break;
    assigned.push(q);
    used += q.estimatedMinutes;
    cursor++;
    if (used >= DAILY_MINS) break;
  }

  if (assigned.length > 0) {
    days.push({ date, questions: assigned, totalMins: used });
  }
  dayNum++;
}

// Group into sprints (7-day blocks)
const sprints = [];
for (let i = 0; i < days.length; i += 7) {
  sprints.push(days.slice(i, i + 7));
}

// Total stats
const totalMins = questions.reduce((s, q) => s + q.estimatedMinutes, 0);
const completionDate = days[days.length - 1]?.date;

// Build HTML
function buildSprintHTML(sprint, sprintNum) {
  const sprintMins = sprint.reduce((s, d) => s + d.totalMins, 0);
  const sprintQCount = sprint.reduce((s, d) => s + d.questions.length, 0);
  const sprintStart = sprint[0].date;
  const sprintEnd = sprint[sprint.length - 1].date;

  const daysHTML = sprint.map(day => {
    const qRows = day.questions.map(q => `
      <tr>
        <td class="seq">${q.sequence}</td>
        <td class="cb"><span class="checkbox"></span></td>
        <td class="qtitle">${q.title.trim()}</td>
        <td class="mins">${q.estimatedMinutes} min</td>
      </tr>`).join('');

    return `
      <div class="day-block">
        <div class="day-header">
          <span class="day-name">${fmtDate(day.date)}</span>
          <span class="day-time">${fmtMins(day.totalMins)} · ${day.questions.length} questions</span>
        </div>
        <table class="q-table">
          <thead>
            <tr>
              <th class="seq">#</th>
              <th class="cb">Done</th>
              <th class="qtitle">Question</th>
              <th class="mins">Est. Time</th>
            </tr>
          </thead>
          <tbody>${qRows}</tbody>
        </table>
      </div>`;
  }).join('');

  return `
    <div class="sprint-block">
      <div class="sprint-header">
        <div class="sprint-title-row">
          <span class="sprint-label">Sprint ${sprintNum}</span>
          <span class="sprint-dates">${fmtDate(sprintStart)} → ${fmtDate(sprintEnd)}</span>
        </div>
        <div class="sprint-meta-row">
          <span>${sprintQCount} questions</span>
          <span>${fmtMins(sprintMins)} total</span>
          <span class="sprint-progress-box">Progress: <span class="progress-blank">________</span> / ${sprintQCount}</span>
        </div>
      </div>
      <div class="sprint-days">${daysHTML}</div>
    </div>`;
}

const sprintsHTML = sprints.map((s, i) => buildSprintHTML(s, i + 1)).join('\n<div class="page-break"></div>\n');

// All questions list at the end
const allQRows = questions.map(q => `
  <tr>
    <td class="seq">${q.sequence}</td>
    <td class="cb"><span class="checkbox"></span></td>
    <td class="qtitle">${q.title.trim()}</td>
    <td class="mins">${q.estimatedMinutes} min</td>
  </tr>`).join('');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Planli – Striver 180 Sprint Schedule</title>
<style>
  @page { margin: 18mm 15mm; size: A4; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #1a1a2e; line-height: 1.4; background: #fff; }

  /* Cover page */
  .cover { text-align: center; padding: 60px 40px; min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; }
  .cover-logo { width: 70px; height: 70px; border-radius: 20px; background: linear-gradient(145deg, #4388ff, #2f74ec); display: flex; align-items: center; justify-content: center; font-size: 36pt; font-weight: 900; color: white; margin: 0 auto 24px; }
  .cover h1 { font-size: 28pt; font-weight: 800; color: #111; letter-spacing: -1px; margin-bottom: 8px; }
  .cover h2 { font-size: 14pt; color: #4466aa; font-weight: 600; margin-bottom: 32px; }
  .cover-stats { display: flex; gap: 40px; justify-content: center; flex-wrap: wrap; margin-bottom: 32px; }
  .cover-stat { text-align: center; }
  .cover-stat .val { font-size: 22pt; font-weight: 800; color: #2255cc; display: block; }
  .cover-stat .lbl { font-size: 8pt; color: #666; letter-spacing: 1px; text-transform: uppercase; margin-top: 4px; display: block; }
  .cover-note { font-size: 9pt; color: #888; border-top: 1px solid #ddd; padding-top: 20px; max-width: 400px; line-height: 1.6; }

  /* Page breaks */
  .page-break { page-break-after: always; break-after: always; }

  /* Sprint blocks */
  .sprint-block { margin-bottom: 24px; }
  .sprint-header { background: #1a2a4a; color: white; padding: 12px 15px; border-radius: 8px 8px 0 0; }
  .sprint-title-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
  .sprint-label { font-size: 14pt; font-weight: 800; letter-spacing: -.5px; }
  .sprint-dates { font-size: 9pt; color: #aac4ff; }
  .sprint-meta-row { display: flex; gap: 20px; font-size: 9pt; color: #ccd9ff; }
  .sprint-progress-box { margin-left: auto; }
  .progress-blank { letter-spacing: 2px; color: #aac4ff; }

  /* Day blocks */
  .sprint-days { border: 1px solid #dee2ee; border-top: 0; border-radius: 0 0 8px 8px; overflow: hidden; }
  .day-block { border-bottom: 1px solid #e8eaf2; }
  .day-block:last-child { border-bottom: 0; }
  .day-header { display: flex; justify-content: space-between; align-items: center; padding: 7px 12px; background: #f4f6fb; }
  .day-name { font-weight: 700; font-size: 9.5pt; color: #223; }
  .day-time { font-size: 8.5pt; color: #667; }

  /* Question table */
  .q-table { width: 100%; border-collapse: collapse; }
  .q-table th { font-size: 7.5pt; color: #667; font-weight: 600; padding: 4px 8px; text-align: left; background: #f9fafb; border-bottom: 1px solid #e8eaf2; }
  .q-table td { padding: 5px 8px; border-bottom: 1px solid #f0f1f7; vertical-align: middle; }
  .q-table tr:last-child td { border-bottom: 0; }
  .q-table tr:hover td { background: #f7f8ff; }
  td.seq, th.seq { width: 28px; color: #889; font-size: 8pt; }
  td.cb, th.cb { width: 36px; text-align: center; }
  td.mins, th.mins { width: 60px; color: #667; font-size: 8.5pt; text-align: right; }
  td.qtitle { font-size: 9.5pt; color: #1a1a2e; }

  /* Checkbox */
  .checkbox { display: inline-block; width: 13px; height: 13px; border: 1.5px solid #8899bb; border-radius: 3px; vertical-align: middle; }

  /* All questions section */
  .allq-section { margin-top: 24px; }
  .allq-header { background: #111827; color: white; padding: 14px 16px; border-radius: 8px 8px 0 0; }
  .allq-header h2 { font-size: 15pt; font-weight: 800; margin-bottom: 4px; }
  .allq-header p { font-size: 9pt; color: #aab8d8; }
  .allq-table-wrap { border: 1px solid #dee2ee; border-top: 0; border-radius: 0 0 8px 8px; overflow: hidden; }

  /* Footer stamp */
  .footer-stamp { margin-top: 30px; text-align: center; font-size: 8pt; color: #aaa; padding-top: 15px; border-top: 1px solid #eee; }
  @media print {
    .cover { page-break-after: always; }
    .sprint-block { page-break-inside: avoid; }
    .day-block { page-break-inside: avoid; }
  }
</style>
</head>
<body>

<!-- COVER PAGE -->
<div class="cover">
  <div class="cover-logo">P</div>
  <h1>Striver's 180</h1>
  <h2>Master DSA Patterns – Sprint Schedule</h2>
  <div class="cover-stats">
    <div class="cover-stat"><span class="val">${questions.length}</span><span class="lbl">Total Questions</span></div>
    <div class="cover-stat"><span class="val">${sprints.length}</span><span class="lbl">Sprints</span></div>
    <div class="cover-stat"><span class="val">${days.length}</span><span class="lbl">Study Days</span></div>
    <div class="cover-stat"><span class="val">2.2h</span><span class="lbl">Per Day</span></div>
    <div class="cover-stat"><span class="val">${fmtMins(totalMins)}</span><span class="lbl">Total Time</span></div>
  </div>
  <div class="cover-stats" style="margin-bottom:16px;">
    <div class="cover-stat"><span class="val" style="font-size:14pt;">${fmtDate(START_DATE)}</span><span class="lbl">Start Date</span></div>
    <div class="cover-stat"><span class="val" style="font-size:14pt;">${fmtDate(completionDate)}</span><span class="lbl">Est. Completion</span></div>
  </div>
  <div class="cover-note">
    This is your printable study planner. Use the checkboxes to track questions as you complete them.
    Each sprint covers 7 days. Daily target: 2.2 hours (132 minutes).
    Generated by Planli – your personal DSA study companion.
  </div>
</div>

<div class="page-break"></div>

<!-- SPRINT SCHEDULES -->
${sprintsHTML}

<div class="page-break"></div>

<!-- ALL QUESTIONS MASTER LIST -->
<div class="allq-section">
  <div class="allq-header">
    <h2>All Questions – Master Checklist</h2>
    <p>${questions.length} questions · Striver's 180 Master DSA Patterns · Use this as your overall reference</p>
  </div>
  <div class="allq-table-wrap">
    <table class="q-table">
      <thead>
        <tr>
          <th class="seq">#</th>
          <th class="cb">Done</th>
          <th class="qtitle">Question</th>
          <th class="mins">Est. Time</th>
        </tr>
      </thead>
      <tbody>${allQRows}</tbody>
    </table>
  </div>
</div>

<div class="footer-stamp">
  Planli Sprint Schedule · Generated ${new Date().toLocaleDateString('en-IN', { day:'numeric',month:'short',year:'numeric' })} ·
  Striver's 180 – Master DSA Patterns · takeuforward.org
</div>

</body>
</html>`;

const outPath = path.join(__dirname, 'planli-sprint-schedule.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log(`✅ HTML generated: ${outPath}`);
console.log(`📋 Total: ${questions.length} questions, ${sprints.length} sprints, ${days.length} days`);
console.log(`📅 ${fmtDate(START_DATE)} → ${fmtDate(completionDate)}`);
console.log('\nTo create PDF:');
console.log('  1. Open planli-sprint-schedule.html in Chrome');
console.log('  2. Press Ctrl+P → Save as PDF → A4 → Print');
