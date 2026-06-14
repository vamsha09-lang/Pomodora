const API = '';

let settings = { focusDuration:25, shortBreak:5, longBreak:15, interval:4, autoBreak:false, autoPomo:false, countUp:false, alarm:'bell', theme:'aurora', volume:80 };
let projects = [];
let tasks = [];
let mode = 'focus';
let totalSecs = 25*60;
let remaining = 25*60;
let running = false;
let ticker = null;
let activeProjectId = null;
let activeTaskId = null;
let sessionPomos = 0;
let estVal = 1;
let editingProjectId = null;
let projGoalVal = 4;
let statPeriod = 'week';
let reportPeriod = 'week';
let focusModeOn = false;
const COLORS = ['#6366f1','#f472b6','#34d399','#60a5fa','#fb923c','#f59e0b','#a78bfa','#ec4899','#14b8a6'];
let selectedColor = COLORS[0];

async function api(path, method='GET', body) {
  try {
    const r = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return await r.json();
  } catch (e) {
    console.warn('API error', e);
    return null;
  }
}

async function init() {
  const [s, p, t] = await Promise.all([api('/api/settings'), api('/api/projects'), api('/api/tasks')]);
  if (s) settings = s;
  if (p) projects = p;
  if (t) tasks = t;

  const hist = await api('/api/history');
  if (hist && Object.keys(hist).length < 3) await api('/api/history/seed', 'POST');

  applySettings();
  renderProjects();
  renderTasks();
  updateTimerFace();
  loadStats(statPeriod);
  buildTrackerDots();
}

function applySettings() {
  document.body.setAttribute('data-theme', settings.theme || 'aurora');
  document.querySelectorAll('.theme-swatch').forEach(s => s.classList.toggle('active', s.getAttribute('data-t') === settings.theme));
  document.getElementById('s-focus').textContent = settings.focusDuration;
  document.getElementById('s-short').textContent = settings.shortBreak;
  document.getElementById('s-long').textContent = settings.longBreak;
  document.getElementById('s-interval').textContent = settings.interval;
  document.getElementById('t-autobreak').checked = settings.autoBreak;
  document.getElementById('t-autopomo').checked = settings.autoPomo;
  document.getElementById('t-countup').checked = settings.countUp;
  document.getElementById('s-volume').value = settings.volume || 80;
  document.getElementById('vol-display').textContent = (settings.volume || 80) + '%';
  syncAlarmButtons();
  totalSecs = settings[mode === 'focus' ? 'focusDuration' : mode === 'short' ? 'shortBreak' : 'longBreak'] * 60;
  if (!running) remaining = totalSecs;
}

function syncAlarmButtons() {
  document.querySelectorAll('.alarm-chip').forEach(c => {
    const txt = c.textContent.toLowerCase();
    c.classList.toggle('active', txt.includes(settings.alarm || 'bell'));
  });
}

function adjDur(key, delta) {
  const min = 1, max = key === 'interval' ? 10 : 99;
  settings[key] = Math.max(min, Math.min(max, (settings[key] || 25) + delta));
  const ids = { focusDuration: 's-focus', shortBreak: 's-short', longBreak: 's-long', interval: 's-interval' };
  document.getElementById(ids[key]).textContent = settings[key];
  if ((key === 'focusDuration' && mode === 'focus') || (key === 'shortBreak' && mode === 'short') || (key === 'longBreak' && mode === 'long')) {
    totalSecs = settings[key] * 60;
    if (!running) {
      remaining = totalSecs;
      updateTimerFace();
    }
  }
}

function selectAlarm(name, el) {
  settings.alarm = name;
  document.querySelectorAll('.alarm-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  playAlarm(name, settings.volume);
}

function setTheme(t) {
  settings.theme = t;
  document.body.setAttribute('data-theme', t);
  document.querySelectorAll('.theme-swatch').forEach(s => s.classList.toggle('active', s.getAttribute('data-t') === t));
}

async function saveSettings() {
  settings.autoBreak = document.getElementById('t-autobreak').checked;
  settings.autoPomo = document.getElementById('t-autopomo').checked;
  settings.countUp = document.getElementById('t-countup').checked;
  settings.volume = parseInt(document.getElementById('s-volume').value, 10);
  await api('/api/settings', 'PUT', settings);
  applySettings();
  closeModal('settings-modal');
  toast('Settings saved', 'success');
}

function openSettings() {
  applySettings();
  document.getElementById('settings-modal').classList.remove('hidden');
}

const CIRC = 2 * Math.PI * 118;

function fmt(s) {
  const m = Math.floor(Math.abs(s) / 60), sec = Math.abs(s) % 60;
  return (s < 0 ? '-' : '') + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

function setMode(m2, auto = false) {
  mode = m2;
  ['focus', 'short', 'long'].forEach(k => document.getElementById('pill-' + k).classList.toggle('active', k === m2));
  const wrap = document.getElementById('timer-ring-wrap');
  wrap.className = 'timer-ring-wrap mode-' + m2;
  totalSecs = settings[m2 === 'focus' ? 'focusDuration' : m2 === 'short' ? 'shortBreak' : 'longBreak'] * 60;
  if (!auto) {
    running = false;
    clearInterval(ticker);
    setRunBtn(false);
  }
  remaining = totalSecs;
  const labels = { focus: 'FOCUS', short: 'SHORT BREAK', long: 'LONG BREAK' };
  document.getElementById('timer-session-lbl').textContent = labels[m2];
  updateTimerFace();
}

function updateTimerFace() {
  const disp = settings.countUp ? (totalSecs - remaining) : remaining;
  const str = fmt(disp);
  document.getElementById('timer-digits').textContent = str;
  document.getElementById('focus-big-digits').textContent = str;
  document.title = str + ' – PomoBalance';

  const pct = totalSecs ? remaining / totalSecs : 0;
  const offset = CIRC * (settings.countUp ? 1 - (totalSecs - remaining) / totalSecs : pct);
  document.getElementById('ring-prog').setAttribute('stroke-dashoffset', isFinite(offset) ? offset.toFixed(2) : '0');
  document.getElementById('top-prog').style.width = ((1 - pct) * 100) + '%';
}

function setRunBtn(isRun) {
  const icon = document.getElementById('ctrl-icon');
  icon.innerHTML = isRun
    ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
    : '<polygon points="5 3 19 12 5 21 5 3"/>';
}

function toggleTimer() {
  if (!running) {
    running = true;
    setRunBtn(true);
    ticker = setInterval(() => {
      if (settings.countUp) remaining++;
      else remaining--;
      updateTimerFace();
      if (!settings.countUp && remaining <= 0) {
        clearInterval(ticker);
        running = false;
        onSessionEnd();
      }
    }, 1000);
  } else {
    running = false;
    clearInterval(ticker);
    setRunBtn(false);
  }
}

function resetTimer() {
  running = false;
  clearInterval(ticker);
  remaining = settings.countUp ? 0 : totalSecs;
  setRunBtn(false);
  updateTimerFace();
}

function skipSession() {
  running = false;
  clearInterval(ticker);
  setRunBtn(false);
  onSessionEnd(true);
}

async function onSessionEnd(skipped = false) {
  playAlarm(settings.alarm, settings.volume);

  if (mode === 'focus' && !skipped) {
    sessionPomos++;
    buildTrackerDots();
    await api('/api/sessions', 'POST', {
      projectId: activeProjectId,
      taskId: activeTaskId,
      duration: settings.focusDuration,
      type: 'focus'
    });
    tasks = await api('/api/tasks') || tasks;
    renderTasks();
    loadStats(statPeriod);
    toast('Pomodoro complete! 🍅', 'success');
  }

  const isLong = sessionPomos > 0 && sessionPomos % (settings.interval || 4) === 0;
  const next = mode === 'focus' ? (isLong ? 'long' : 'short') : 'focus';
  setMode(next, true);

  if ((next === 'short' || next === 'long') && settings.autoBreak) setTimeout(toggleTimer, 800);
  if (next === 'focus' && settings.autoPomo) setTimeout(toggleTimer, 800);
}

function buildTrackerDots() {
  const n = settings.interval || 4;
  const wrap = document.getElementById('session-tracker');
  wrap.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'tracker-dot' + (i < (sessionPomos % n) ? ' done' : '');
    wrap.appendChild(d);
    if (i < n - 1) {
      const sep = document.createElement('div');
      sep.className = 'tracker-sep';
      sep.style.width = '12px';
      sep.style.height = '1px';
      sep.style.background = 'var(--surface3)';
      wrap.appendChild(sep);
    }
  }
}

function playAlarm(type, vol = 80) {
  if (type === 'none') return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const gain = ctx.createGain();
    gain.gain.value = (vol || 80) / 100;
    gain.connect(ctx.destination);

    const seqs = {
      bell: [[523, .1, 0], [659, .15, .12], [784, .2, .28], [1047, .25, .5]],
      digital: [[880, .04, 0], [880, .04, .08], [1320, .06, .16]],
      kitchen: [[440, .15, 0], [660, .1, .18], [550, .12, .32], [440, .08, .46]],
      birds: [[800, .05, 0], [1000, .05, .08], [1200, .08, .16], [900, .06, .28], [1100, .1, .38]]
    };

    const seq = seqs[type] || seqs.bell;
    seq.forEach(([f, d, t]) => {
      const o = ctx.createOscillator(), g2 = ctx.createGain();
      o.connect(g2);
      g2.connect(gain);
      o.frequency.value = f;
      o.type = type === 'birds' ? 'sine' : 'triangle';
      g2.gain.setValueAtTime(0.4, ctx.currentTime + t);
      g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + d);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + d + .05);
    });
  } catch (e) {}
}

function renderProjects() {
  const list = document.getElementById('project-list');
  const groups = {};
  projects.forEach(p => {
    const g = p.group || 'General';
    if (!groups[g]) groups[g] = [];
    groups[g].push(p);
  });

  const allProjects = Object.entries(groups).map(([g, ps]) => `
    <div class="group-label">${g}</div>
    ${ps.map(p => `
      <div class="project-item${activeProjectId === p.id ? ' active' : ''}" onclick="selectProject('${p.id}')" ondblclick="editProject('${p.id}')">
        <div class="project-icon">${p.icon || '📁'}</div>
        <div class="project-dot" style="background:${p.color || '#6366f1'}"></div>
        <div class="project-name">${p.name}</div>
        <div class="project-count">${getProjectPomoCount(p.id)}</div>
      </div>
    `).join('')}
  `).join('');

  list.innerHTML = allProjects || '<div class="empty-tasks">No projects yet</div>';
  renderTodayGoals();

  if (projects.length && !activeProjectId) {
    const first = projects[0];
    setActiveProject(first.id, false);
  }
}

function getProjectPomoCount(pid) {
  return tasks.filter(t => t.projectId === pid).reduce((s, t) => s + (t.pomoDone || 0), 0);
}

function setActiveProject(id, rerender = true) {
  activeProjectId = id;
  const proj = projects.find(p => p.id === id);
  if (proj) {
    document.getElementById('badge-dot').style.background = proj.color || '#6366f1';
    document.getElementById('badge-name').textContent = (proj.icon ? proj.icon + ' ' : '') + proj.name;
  }
  document.getElementById('proj-picker-overlay').classList.add('hidden');
  if (rerender) renderProjects();
  renderTasks();
}

function selectProject(id) {
  setActiveProject(id, true);
}

function renderTodayGoals() {
  const panel = document.getElementById('today-goal-panel');
  if (!projects.length) {
    panel.innerHTML = '<div style="font-size:12px;color:var(--text3)">No projects yet</div>';
    return;
  }
  panel.innerHTML = projects.map(p => {
    const done = getProjectPomoCount(p.id);
    const goal = p.goal || 4;
    const pct = Math.min(100, Math.round(done / goal * 100));
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:12px;color:var(--text2)">${p.icon || ''} ${p.name}</span>
        <span style="font-size:11px;color:var(--text3)">${done}/${goal}</span>
      </div>
      <div style="height:4px;background:var(--surface3);border-radius:3px">
        <div style="height:100%;width:${pct}%;background:${p.color};border-radius:3px;transition:width .4s"></div>
      </div>
    </div>`;
  }).join('');
}

function openProjectModal(proj = null) {
  editingProjectId = proj ? proj.id : null;
  projGoalVal = proj ? (proj.goal || 4) : 4;
  selectedColor = proj ? (proj.color || COLORS[0]) : COLORS[0];
  document.getElementById('proj-modal-title').textContent = proj ? 'Edit Project' : 'New Project';
  document.getElementById('proj-name').value = proj ? proj.name : '';
  document.getElementById('proj-icon').value = proj ? (proj.icon || '') : '';
  document.getElementById('proj-group').value = proj ? (proj.group || '') : '';
  document.getElementById('proj-goal-val').textContent = projGoalVal;
  document.getElementById('delete-proj-btn').style.display = proj ? 'block' : 'none';
  renderColorRow();
  document.getElementById('project-modal').classList.remove('hidden');
}

function editProject(id) {
  openProjectModal(projects.find(p => p.id === id));
}

function renderColorRow() {
  document.getElementById('proj-color-row').innerHTML = COLORS.map(c => `
    <div class="color-chip${selectedColor === c ? ' active' : ''}" style="background:${c}" onclick="selectedColor='${c}';renderColorRow()"></div>
  `).join('');
}

function changeGoal(d) {
  projGoalVal = Math.max(1, Math.min(20, projGoalVal + d));
  document.getElementById('proj-goal-val').textContent = projGoalVal;
}

async function saveProject() {
  const data = {
    name: document.getElementById('proj-name').value.trim() || 'Untitled',
    icon: document.getElementById('proj-icon').value.trim() || '📁',
    group: document.getElementById('proj-group').value.trim() || 'General',
    color: selectedColor,
    goal: projGoalVal
  };

  if (editingProjectId) await api('/api/projects/' + editingProjectId, 'PUT', data);
  else await api('/api/projects', 'POST', data);

  projects = await api('/api/projects') || projects;
  renderProjects();
  closeModal('project-modal');
  toast(editingProjectId ? 'Project updated' : 'Project created', 'success');
}

async function deleteProject() {
  if (!editingProjectId) return;
  await api('/api/projects/' + editingProjectId, 'DELETE');

  if (activeProjectId === editingProjectId) {
    activeProjectId = null;
    document.getElementById('badge-dot').style.background = 'var(--text3)';
    document.getElementById('badge-name').textContent = 'Select a project';
  }

  projects = await api('/api/projects') || [];
  tasks = await api('/api/tasks') || [];
  renderProjects();
  renderTasks();
  closeModal('project-modal');
  toast('Project deleted', 'info');
}

function showProjectPicker() {
  const list = document.getElementById('proj-picker-list');
  list.innerHTML = [
    `<div class="project-item" onclick="clearProject()"><div style="width:10px;height:10px;border-radius:50%;background:var(--text3)"></div><div class="project-name">None</div></div>`,
    ...projects.map(p => `<div class="project-item${activeProjectId === p.id ? ' active' : ''}" onclick="selectProject('${p.id}')">
      <div class="project-icon">${p.icon || '📁'}</div>
      <div class="project-dot" style="background:${p.color}"></div>
      <div class="project-name">${p.name}</div>
    </div>`)
  ].join('');
  document.getElementById('proj-picker-overlay').classList.remove('hidden');
}

function clearProject() {
  activeProjectId = null;
  document.getElementById('badge-dot').style.background = 'var(--text3)';
  document.getElementById('badge-name').textContent = 'Select a project';
  document.getElementById('proj-picker-overlay').classList.add('hidden');
  renderProjects();
  renderTasks();
}

function closeProjPicker(e) {
  if (!e || e.target.id === 'proj-picker-overlay') document.getElementById('proj-picker-overlay').classList.add('hidden');
}

function renderTasks() {
  const list = document.getElementById('task-list');
  const filtered = activeProjectId ? tasks.filter(t => t.projectId === activeProjectId) : tasks;

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-tasks">No tasks yet — add one above</div>';
    return;
  }

  list.innerHTML = filtered.map(t => {
    const proj = projects.find(p => p.id === t.projectId);
    const pct = t.pomoEst ? Math.min(100, Math.round((t.pomoDone || 0) / t.pomoEst * 100)) : 0;
    return `<div class="task-item${activeTaskId === t.id ? ' active' : ''}${t.completed ? ' done' : ''}" onclick="selectTask('${t.id}')">
      <div class="task-check">${t.completed ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}</div>
      <div style="flex:1">
        <div class="task-name">${t.name}</div>
        ${pct > 0 && !t.completed ? `<div style="height:3px;background:var(--surface3);border-radius:2px;margin-top:5px"><div style="height:100%;width:${pct}%;background:${proj?.color || 'var(--accent)'};border-radius:2px"></div></div>` : ''}
      </div>
      <div class="task-meta">
        ${proj ? `<div style="font-size:10px;color:var(--text3);padding:2px 7px;background:var(--surface3);border-radius:8px">${proj.icon}</div>` : ''}
        <div class="task-pomo">🍅 ${t.pomoDone || 0}/${t.pomoEst || 1}</div>
      </div>
      <button class="task-del" onclick="deleteTask('${t.id}',event)">×</button>
    </div>`;
  }).join('');
}

function selectTask(id) {
  activeTaskId = activeTaskId === id ? null : id;
  const task = tasks.find(t => t.id === id);
  if (task) document.getElementById('focus-big-task').textContent = task.name;
  renderTasks();
}

async function deleteTask(id, e) {
  e.stopPropagation();
  await api('/api/tasks/' + id, 'DELETE');
  tasks = tasks.filter(t => t.id !== id);
  if (activeTaskId === id) activeTaskId = null;
  renderTasks();
}

function showTaskForm() {
  document.getElementById('task-form').classList.remove('hidden');
  document.getElementById('task-input').focus();
}

function hideTaskForm() {
  document.getElementById('task-form').classList.add('hidden');
  document.getElementById('task-input').value = '';
  estVal = 1;
  document.getElementById('est-val').textContent = 1;
}

function changeEst(d) {
  estVal = Math.max(1, Math.min(20, estVal + d));
  document.getElementById('est-val').textContent = estVal;
}

async function saveTask() {
  const name = document.getElementById('task-input').value.trim();
  if (!name) return;

  const task = await api('/api/tasks', 'POST', {
    name,
    pomoEst: estVal,
    pomoDone: 0,
    projectId: activeProjectId
  });

  if (task) {
    tasks.push(task);
    renderTasks();
    renderProjects();
    hideTaskForm();
    toast('Task saved', 'success');
  }
}

async function loadStats(period) {
  const data = await api('/api/stats/' + period);
  if (!data) return;

  document.getElementById('st-pomos').textContent = data.total || 0;
  const hrs = Math.floor((data.minutes || 0) / 60);
  const mins = (data.minutes || 0) % 60;
  document.getElementById('st-hrs').innerHTML = hrs + '<span>h ' + mins + 'm</span>';
  document.getElementById('st-avg').textContent = data.dailyAvg || 0;
  document.getElementById('st-streak').innerHTML = (data.streak || 0) + '<span>🔥</span>';
  renderBarChart('stats-bar-chart', 'bar-labels', data.dates, data.byDay, period);
  renderBreakdown('project-breakdown', data.byProject, data.total);

  const todayKey = new Date().toISOString().slice(0, 10);
  const todayCount = data.byDay?.[todayKey] || 0;
  document.getElementById('today-summary').innerHTML = `
    <b>${todayCount}</b> pomodoros today &bull; <b>${todayCount * settings.focusDuration}</b> minutes focused<br>
    ${todayCount >= 6 ? '🔥 Amazing focus day!' : todayCount >= 3 ? '💪 Good progress!' : todayCount > 0 ? '🌱 Keep going!' : '⏰ Ready to start?'}
  `;
}

function setPeriod(p, el) {
  statPeriod = p;
  document.querySelectorAll('.period-switch .period-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  loadStats(p);
}

function renderBarChart(chartId, labelId, dates, byDay, period) {
  if (!dates || !dates.length) return;

  const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const vals = dates.map(d => byDay?.[d] || 0);
  const maxV = Math.max(...vals, 1);
  const maxH = period === 'month' ? 60 : 80;
  const chartEl = document.getElementById(chartId);
  const labelEl = document.getElementById(labelId);
  if (!chartEl) return;

  chartEl.innerHTML = vals.map(v => `
    <div class="bar-col">
      <div class="bar-val">${v || ''}</div>
      <div class="bar-fill" style="height:${Math.round((v / maxV) * maxH)}px;background:var(--accent)"></div>
    </div>
  `).join('');

  if (labelEl) {
    labelEl.innerHTML = dates.map((d, i) => {
      let lbl = '';
      if (period === 'week') lbl = DAY_ABBR[new Date(d + 'T12:00:00').getDay()];
      else if (period === 'month') lbl = d.slice(8);
      else lbl = MONTH_ABBR[new Date(d + 'T12:00:00').getMonth()];
      return `<div style="flex:1;font-size:9px;color:var(--text3);text-align:center">${lbl}</div>`;
    }).join('');
  }
}

function renderBreakdown(id, byProject, total) {
  const el = document.getElementById(id);
  if (!el) return;

  const sorted = Object.entries(byProject || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!sorted.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text3)">No data yet</div>';
    return;
  }

  el.innerHTML = sorted.map(([pid, count]) => {
    const proj = projects.find(p => p.id === pid);
    const pct = total ? Math.round(count / total * 100) : 0;
    return `<div class="pb-item">
      <div class="pb-dot" style="background:${proj?.color || 'var(--accent)'}"></div>
      <div class="pb-name">${proj?.icon || ''} ${proj?.name || 'Unknown'}</div>
      <div class="pb-bar-wrap"><div class="pb-bar" style="width:${pct}%;background:${proj?.color || 'var(--accent)'}"></div></div>
      <div class="pb-count">${count}</div>
    </div>`;
  }).join('');
}

async function openReport() {
  document.getElementById('report-modal').classList.remove('hidden');
  await loadReport(reportPeriod);
}

async function setReportPeriod(p, el) {
  reportPeriod = p;
  document.querySelectorAll('#report-modal .period-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  await loadReport(p);
}

async function loadReport(period) {
  const data = await api('/api/stats/' + period);
  if (!data) return;

  document.getElementById('rp-pomos').textContent = data.total || 0;
  const h = Math.floor((data.minutes || 0) / 60), m = (data.minutes || 0) % 60;
  document.getElementById('rp-time').textContent = h + 'h ' + m + 'm';
  document.getElementById('rp-avg').textContent = data.dailyAvg || 0;
  document.getElementById('rp-streak').innerHTML = (data.streak || 0) + '<span>🔥</span>';

  const labels = { week: 'Pomodoros per day this week', month: 'Pomodoros per day this month', year: 'Pomodoros per month this year' };
  document.getElementById('rp-chart-lbl').textContent = labels[period];

  renderBarChart('report-bar-chart', 'report-bar-labels', data.dates, data.byDay, period);
  renderBreakdown('report-breakdown', data.byProject, data.total);
}

function toggleFocusMode() {
  focusModeOn = !focusModeOn;
  document.getElementById('focus-overlay').classList.toggle('hidden', !focusModeOn);
  document.getElementById('focus-mode-btn').classList.toggle('active', focusModeOn);
  if (focusModeOn) updateTimerFace();
}

function closeModal(id, e) {
  if (!e || e.target.id === id) document.getElementById(id).classList.add('hidden');
}

function toast(msg, type = 'info') {
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${type === 'success' ? '✓' : 'ℹ'}</span>${msg}`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

init();
