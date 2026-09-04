import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm";

const config = window.APP_CONFIG || {};
const configured = /^https:\/\/.+\.supabase\.co$/.test(config.SUPABASE_URL || "") &&
  !String(config.SUPABASE_PUBLISHABLE_KEY || "").startsWith("PEGA_");

if (!configured) {
  document.querySelector("#app").innerHTML = `<section class="error-screen"><h1>Falta conectar Supabase</h1><p>Abre <strong>config.js</strong> y pega la URL del proyecto y la clave pública de Supabase.</p><code>SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY</code></section>`;
  throw new Error("Supabase no está configurado");
}

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 10 } }
});

const $app = document.querySelector("#app");
const state = {
  tab: "attendance",
  loading: true,
  saving: false,
  groups: [], professors: [], students: [], sessions: [], attendance: [],
  date: new Date().toISOString().slice(0, 10),
  groupId: "", professorId: "", attendanceDraft: new Map(), editingSessionId: "",
  historyGroup: "all", summaryGroup: "all"
};

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
}[char]));
const formatDate = date => new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const byName = (a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" });
const groupName = id => state.groups.find(g => g.id === id)?.name || "Sin grupo";
const professorName = id => state.professors.find(p => p.id === id)?.name || "Profesor retirado";
const studentsForGroup = id => state.students.filter(s => s.active && s.group_id === id).sort(byName);
const attendanceFor = sessionId => state.attendance.filter(a => a.session_id === sessionId);
const draftFor = studentId => state.attendanceDraft.get(studentId) || { status: "absent", arrivalTime: "" };
const attendedDraftCount = () => [...state.attendanceDraft.values()].filter(item => item.status !== "absent").length;

function toast(message, type = "success") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  document.querySelector("#toast-region").append(node);
  setTimeout(() => node.remove(), 3500);
}

async function loadAll({ quiet = false } = {}) {
  if (!quiet) { state.loading = true; render(); }
  const [groups, professors, students, sessions, attendance] = await Promise.all([
    supabase.from("golf_groups").select("id,name,active,created_at").order("name"),
    supabase.from("golf_professors").select("id,name,active,created_at").order("name"),
    supabase.from("golf_students").select("id,action_code,name,group_id,active,created_at").order("name"),
    supabase.from("golf_sessions").select("id,class_date,class_type,group_id,professor_id,created_at").order("class_date", { ascending: false }).limit(250),
    supabase.from("golf_attendance").select("session_id,student_id,status,arrival_time,created_at,updated_at")
  ]);
  const error = [groups, professors, students, sessions, attendance].find(result => result.error)?.error;
  if (error) {
    state.loading = false;
    $app.innerHTML = `<section class="error-screen"><h1>No fue posible cargar la información</h1><p>Verifica que ejecutaste <strong>supabase/setup.sql</strong> y que la URL y la clave sean correctas.</p><code>${escapeHtml(error.message)}</code></section>`;
    return;
  }
  state.groups = groups.data.map(g => ({ ...g, name: g.name }));
  state.professors = professors.data.map(p => ({ ...p, name: p.name }));
  state.students = students.data.map(s => ({ ...s, name: s.name }));
  state.sessions = sessions.data;
  state.attendance = attendance.data;
  const activeGroups = state.groups.filter(g => g.active).sort(byName);
  const activeProfessors = state.professors.filter(p => p.active).sort(byName);
  if (!activeGroups.some(g => g.id === state.groupId)) state.groupId = activeGroups[0]?.id || "";
  if (!activeProfessors.some(p => p.id === state.professorId)) state.professorId = activeProfessors[0]?.id || "";
  const validStudentIds = new Set(studentsForGroup(state.groupId).map(student => student.id));
  state.attendanceDraft = new Map([...state.attendanceDraft].filter(([id]) => validStudentIds.has(id)));
  state.loading = false;
  render();
}

function header() {
  const tabs = [
    ["attendance", "Tomar asistencia"], ["groups", "Alumnos por grupos"],
    ["history", "Historial"], ["summary", "Resumen"], ["manage", "Administrar"]
  ];
  return `<header class="topbar"><div class="topbar-inner"><div class="brand-row"><div><p class="eyebrow">Club Campestre de Pereira</p><h1>Academia de Golf</h1><p class="subtitle">Asistencia, clases y seguimiento por grupos</p></div><div class="live-pill"><span class="live-dot"></span><span>Actualización en tiempo real</span></div></div></div></header>
    <nav class="tab-nav" aria-label="Módulos"><div class="nav-inner">${tabs.map(([id, label]) => `<button class="tab-btn ${state.tab === id ? "active" : ""}" data-tab="${id}">${label}</button>`).join("")}</div></nav>`;
}

const empty = (icon, text) => `<div class="empty"><span class="empty-icon">${icon}</span>${escapeHtml(text)}</div>`;

function attendanceView() {
  const students = studentsForGroup(state.groupId);
  const editing = state.sessions.find(session => session.id === state.editingSessionId);
  const attended = attendedDraftCount();
  return `<div class="page-heading"><div><h2>${editing ? "Modificar clase" : "Registrar asistencia"}</h2><p>${editing ? "Corrige la fecha, el profesor o la asistencia guardada." : "Crea la clase y registra el estado de cada golfista."}</p></div>${editing ? `<button class="btn btn-secondary" id="cancel-edit">Cancelar modificación</button>` : ""}</div>
    <div class="grid two">
      <section class="card"><h3>Información de la clase</h3><div class="form-grid">
        <div class="field"><label for="class-date">Fecha</label><input id="class-date" type="date" value="${state.date}"></div>
        <div class="field"><label for="class-group">Grupo</label><select id="class-group" ${editing ? "disabled" : ""}>${groupOptions(state.groupId)}</select></div>
        <div class="field"><label for="class-professor">Profesor</label><select id="class-professor">${professorOptions(state.professorId)}</select></div>
        <div class="field"><label>Tipo de clase</label><div class="readonly-field">${escapeHtml(groupName(state.groupId))}</div></div>
      </div><div class="notice" style="margin-top:16px">${editing ? "El grupo se mantiene bloqueado para no mezclar golfistas. Puedes cambiar la fecha, el profesor y el estado de asistencia." : "Selecciona Presente o Llegó tarde. Los alumnos que queden como Ausente no suman asistencia."}</div></section>
      <section class="card"><div class="student-toolbar"><strong>Asistieron: ${attended} de ${students.length}</strong><div><button class="link-btn" id="mark-all-present">Todos presentes</button><button class="link-btn" id="mark-all-absent">Limpiar</button></div></div>
        ${students.length ? `<div class="student-list">${students.map(student => {
          const draft = draftFor(student.id);
          return `<div class="student-status ${draft.status !== "absent" ? "selected" : ""}"><span><span class="student-name">${escapeHtml(student.name)}</span><br><span class="student-action">Acción ${escapeHtml(student.action_code)}</span></span><div class="attendance-controls"><select data-attendance-status="${student.id}" aria-label="Asistencia de ${escapeHtml(student.name)}"><option value="absent" ${draft.status === "absent" ? "selected" : ""}>Ausente</option><option value="present" ${draft.status === "present" ? "selected" : ""}>Presente</option><option value="late" ${draft.status === "late" ? "selected" : ""}>Llegó tarde</option></select>${draft.status === "late" ? `<input type="time" data-arrival-time="${student.id}" value="${escapeHtml(draft.arrivalTime)}" aria-label="Hora de llegada de ${escapeHtml(student.name)}">` : ""}</div></div>`;
        }).join("")}</div><div class="actions"><button class="btn btn-primary" id="save-attendance" ${state.saving ? "disabled" : ""}>${state.saving ? "Guardando…" : editing ? "Guardar modificaciones" : "Guardar asistencia"}</button></div>` : empty("⛳", "Este grupo todavía no tiene golfistas activos.")}
      </section>
    </div>`;
}

function groupsView() {
  const groups = state.groups.filter(g => g.active).sort(byName);
  return `<div class="page-heading"><div><h2>Golfistas por grupos</h2><p>Consulta la acción, nombre, grupo y asistencias acumuladas.</p></div></div>
    <section class="card">${groups.length ? groups.map(group => {
      const members = studentsForGroup(group.id);
      return `<div class="group-block"><div class="group-title"><h3>${escapeHtml(group.name)}</h3><span class="badge">${members.length} golfista${members.length === 1 ? "" : "s"}</span></div>
        ${members.length ? `<div class="table-wrap"><table><thead><tr><th>Acción</th><th>Golfista</th><th>Grupo</th><th>Asistencias</th><th>Llegadas tarde</th></tr></thead><tbody>${members.map(s => `<tr><td>${escapeHtml(s.action_code)}</td><td><strong>${escapeHtml(s.name)}</strong></td><td>${escapeHtml(group.name)}</td><td>${state.attendance.filter(a => a.student_id === s.id).length}</td><td>${state.attendance.filter(a => a.student_id === s.id && a.status === "late").length}</td></tr>`).join("")}</tbody></table></div>` : empty("🏌️", "No hay golfistas en este grupo.")}</div>`;
    }).join("") : empty("📁", "Crea el primer grupo desde Administrar.")}</section>`;
}

function historyView() {
  const sessions = state.sessions.filter(s => state.historyGroup === "all" || s.group_id === state.historyGroup);
  return `<div class="page-heading"><div><h2>Historial de clases</h2><p>Revisa quién asistió, con qué profesor y en qué tipo de clase.</p></div><div><label for="history-group">Filtrar por grupo</label><select id="history-group"><option value="all">Todos los grupos</option>${groupOptions(state.historyGroup)}</select></div></div>
    <section class="card">${sessions.length ? `<div class="history-list">${sessions.map(session => {
      const records = attendanceFor(session.id).map(record => ({ ...record, student: state.students.find(student => student.id === record.student_id) })).filter(record => record.student).sort((a,b) => byName(a.student, b.student));
      const late = records.filter(record => record.status === "late").length;
      const names = records.map(record => `${escapeHtml(record.student.name)}${record.status === "late" ? ` <span class="late-label">(Tarde${record.arrival_time ? ` ${escapeHtml(record.arrival_time.slice(0, 5))}` : ""})</span>` : ""}`);
      return `<article class="session"><div class="session-top"><div><h3>${escapeHtml(session.class_type)} · ${escapeHtml(groupName(session.group_id))}</h3><div class="session-meta">${escapeHtml(formatDate(session.class_date))} · Profesor: ${escapeHtml(professorName(session.professor_id))}</div></div><div class="session-actions"><span class="badge">${records.length} asistieron${late ? ` · ${late} tarde` : ""}</span><button class="btn btn-secondary btn-small" data-edit-session="${session.id}">Modificar</button></div></div><p class="session-students">${names.length ? names.join(" · ") : "Sin asistentes registrados"}</p></article>`;
    }).join("")}</div>` : empty("📋", "No hay clases registradas para este filtro.")}</section>`;
}

function summaryView() {
  const sessions = state.sessions.filter(s => state.summaryGroup === "all" || s.group_id === state.summaryGroup);
  const sessionIds = new Set(sessions.map(s => s.id));
  const attendance = state.attendance.filter(a => sessionIds.has(a.session_id));
  const lateAttendance = attendance.filter(record => record.status === "late");
  const eligibleStudents = state.students.filter(s => s.active && (state.summaryGroup === "all" || s.group_id === state.summaryGroup)).sort(byName);
  const activeGroups = new Set(sessions.map(s => s.group_id)).size;
  const professorRows = state.professors.filter(p => p.active).sort(byName).map(professor => ({
    name: professor.name,
    total: sessions.filter(session => session.professor_id === professor.id).length
  }));
  return `<div class="page-heading"><div><h2>Resumen de asistencia</h2><p>Indicadores reales de clases y participaciones por grupo.</p></div><div><label for="summary-group">Filtrar por grupo</label><select id="summary-group"><option value="all">Todos los grupos</option>${groupOptions(state.summaryGroup)}</select></div></div>
    <div class="stats"><div class="stat"><span class="stat-value">${sessions.length}</span><span class="stat-label">Clases realizadas</span></div><div class="stat"><span class="stat-value">${attendance.length}</span><span class="stat-label">Asistencias registradas</span></div><div class="stat"><span class="stat-value">${lateAttendance.length}</span><span class="stat-label">Llegadas tarde</span></div><div class="stat"><span class="stat-value">${eligibleStudents.length}</span><span class="stat-label">Golfistas activos</span></div></div>
    <div class="grid two summary-detail"><section class="card"><h3>Clases por profesor</h3>${professorRows.length ? `<div class="professor-list">${professorRows.map(row => `<div class="professor-row"><strong>${escapeHtml(row.name)}</strong><span class="badge">${row.total} clase${row.total === 1 ? "" : "s"}</span></div>`).join("")}</div>` : empty("🏌️", "No hay profesores activos.")}</section>
    <section class="card"><h3>Detalle por golfista</h3>${eligibleStudents.length ? `<div class="table-wrap"><table><thead><tr><th>Acción</th><th>Golfista</th><th>Grupo</th><th>Asistencias</th><th>Llegadas tarde</th><th>Clases del grupo</th><th>Participación</th></tr></thead><tbody>${eligibleStudents.map(student => {
      const ownSessions = sessions.filter(s => s.group_id === student.group_id);
      const ownSessionIds = new Set(ownSessions.map(s => s.id));
      const present = state.attendance.filter(a => a.student_id === student.id && ownSessionIds.has(a.session_id)).length;
      const late = state.attendance.filter(a => a.student_id === student.id && a.status === "late" && ownSessionIds.has(a.session_id)).length;
      const rate = ownSessions.length ? Math.round((present / ownSessions.length) * 100) : 0;
      return `<tr><td>${escapeHtml(student.action_code)}</td><td><strong>${escapeHtml(student.name)}</strong></td><td>${escapeHtml(groupName(student.group_id))}</td><td>${present}</td><td>${late}</td><td>${ownSessions.length}</td><td><span class="badge">${rate}%</span></td></tr>`;
    }).join("")}</tbody></table></div>` : empty("📊", "No hay golfistas para calcular el resumen.")}</section></div>`;
}

function manageView() {
  const groups = state.groups.filter(g => g.active).sort(byName);
  const professors = state.professors.filter(p => p.active).sort(byName);
  const students = state.students.filter(s => s.active).sort(byName);
  return `<div class="page-heading"><div><h2>Administrar academia</h2><p>Añade golfistas, profesores y grupos desde cero.</p></div></div>
    <div class="notice" style="margin-bottom:18px"><strong>Módulo público:</strong> no hay contraseña. Toda persona con el enlace podrá consultar, registrar y modificar clases y asistencias, además de añadir información.</div>
    <div class="manage-grid">
      <section class="card"><h3>Nuevo golfista</h3><form id="student-form"><div class="field"><label for="student-action">Acción</label><input id="student-action" required maxlength="30" autocomplete="off" placeholder="Ej. 12345"></div><div class="field"><label for="student-name">Nombre completo</label><input id="student-name" required maxlength="120" autocomplete="off" placeholder="Nombre del golfista"></div><div class="field"><label for="student-group">Grupo</label><select id="student-group" required>${groupOptions(state.groupId)}</select></div><button class="btn btn-secondary" type="submit">Añadir golfista</button></form><div class="manage-list">${students.slice(0, 10).map(s => manageItem(s.name, `Acción ${s.action_code} · ${groupName(s.group_id)}`, "student", s.id)).join("")}${students.length > 10 ? `<small class="muted">Y ${students.length - 10} más en Alumnos por grupos.</small>` : ""}</div></section>
      <section class="card"><h3>Nuevo profesor</h3><form id="professor-form"><div class="field"><label for="professor-name">Nombre completo</label><input id="professor-name" required maxlength="120" autocomplete="off" placeholder="Nombre del profesor"></div><button class="btn btn-secondary" type="submit">Añadir profesor</button></form><div class="manage-list">${professors.map(p => manageItem(p.name, "Profesor activo", "professor", p.id)).join("")}</div></section>
      <section class="card"><h3>Nuevo grupo</h3><form id="group-form"><div class="field"><label for="group-name">Nombre del grupo</label><input id="group-name" required maxlength="80" autocomplete="off" placeholder="Ej. Semillero 1"></div><button class="btn btn-secondary" type="submit">Añadir grupo</button></form><div class="manage-list">${groups.map(g => manageItem(g.name, `${studentsForGroup(g.id).length} golfistas`, "group", g.id)).join("")}</div></section>
    </div>`;
}

function manageItem(title, meta, type, id) {
  return `<div class="manage-item"><span class="manage-main"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta)}</small></span></div>`;
}
function groupOptions(selected) { return state.groups.filter(g => g.active).sort(byName).map(g => `<option value="${g.id}" ${g.id === selected ? "selected" : ""}>${escapeHtml(g.name)}</option>`).join(""); }
function professorOptions(selected) { return state.professors.filter(p => p.active).sort(byName).map(p => `<option value="${p.id}" ${p.id === selected ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join(""); }

function render() {
  if (state.loading) { $app.innerHTML = `<div class="startup"><span class="spinner"></span><p>Cargando información…</p></div>`; return; }
  const views = { attendance: attendanceView, groups: groupsView, history: historyView, summary: summaryView, manage: manageView };
  $app.innerHTML = `${header()}<main class="content">${views[state.tab]()}</main>`;
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => { state.tab = button.dataset.tab; render(); window.scrollTo(0, 0); }));
  document.querySelector("#class-date")?.addEventListener("change", e => { state.date = e.target.value; });
  document.querySelector("#class-group")?.addEventListener("change", e => { state.groupId = e.target.value; state.attendanceDraft.clear(); render(); });
  document.querySelector("#class-professor")?.addEventListener("change", e => { state.professorId = e.target.value; });
  document.querySelectorAll("[data-attendance-status]").forEach(select => select.addEventListener("change", () => {
    const current = draftFor(select.dataset.attendanceStatus);
    state.attendanceDraft.set(select.dataset.attendanceStatus, { status: select.value, arrivalTime: select.value === "late" ? current.arrivalTime : "" });
    render();
  }));
  document.querySelectorAll("[data-arrival-time]").forEach(input => input.addEventListener("change", () => {
    state.attendanceDraft.set(input.dataset.arrivalTime, { status: "late", arrivalTime: input.value });
  }));
  document.querySelector("#mark-all-present")?.addEventListener("click", () => { state.attendanceDraft = new Map(studentsForGroup(state.groupId).map(student => [student.id, { status: "present", arrivalTime: "" }])); render(); });
  document.querySelector("#mark-all-absent")?.addEventListener("click", () => { state.attendanceDraft.clear(); render(); });
  document.querySelector("#save-attendance")?.addEventListener("click", saveAttendance);
  document.querySelector("#cancel-edit")?.addEventListener("click", cancelEdit);
  document.querySelectorAll("[data-edit-session]").forEach(button => button.addEventListener("click", () => editSession(button.dataset.editSession)));
  document.querySelector("#history-group")?.addEventListener("change", e => { state.historyGroup = e.target.value; render(); });
  document.querySelector("#summary-group")?.addEventListener("change", e => { state.summaryGroup = e.target.value; render(); });
  document.querySelector("#student-form")?.addEventListener("submit", addStudent);
  document.querySelector("#professor-form")?.addEventListener("submit", addProfessor);
  document.querySelector("#group-form")?.addEventListener("submit", addGroup);
}

async function saveAttendance() {
  if (!state.groupId || !state.professorId) return toast("Primero crea un grupo y un profesor.", "error");
  const attendance = [...state.attendanceDraft].filter(([, item]) => item.status !== "absent").map(([studentId, item]) => ({ student_id: studentId, status: item.status, arrival_time: item.status === "late" && item.arrivalTime ? item.arrivalTime : null }));
  if (!attendance.length) return toast("Registra al menos un golfista presente o que llegó tarde.", "error");
  state.saving = true; render();
  const { error: saveError } = await supabase.rpc("save_golf_session", {
    p_session_id: state.editingSessionId || null,
    p_class_date: state.date,
    p_group_id: state.groupId,
    p_professor_id: state.professorId,
    p_attendance: attendance
  });
  state.saving = false;
  if (saveError) {
    render();
    const duplicate = saveError.code === "23505";
    return toast(duplicate ? "Ya existe otra clase con esa fecha, grupo y profesor." : `No se guardaron los cambios: ${saveError.message}`, "error");
  }
  toast(state.editingSessionId ? "Clase modificada correctamente." : `Asistencia guardada: ${attendance.length} golfista${attendance.length === 1 ? "" : "s"}.`);
  state.editingSessionId = "";
  state.attendanceDraft.clear();
  state.tab = "history";
  await loadAll({ quiet: true });
}

function editSession(sessionId) {
  const session = state.sessions.find(item => item.id === sessionId);
  if (!session) return toast("No se encontró la clase seleccionada.", "error");
  state.editingSessionId = session.id;
  state.date = session.class_date;
  state.groupId = session.group_id;
  state.professorId = session.professor_id;
  state.attendanceDraft = new Map(attendanceFor(session.id).map(record => [record.student_id, {
    status: record.status || "present",
    arrivalTime: record.arrival_time ? record.arrival_time.slice(0, 5) : ""
  }]));
  state.tab = "attendance";
  render();
  window.scrollTo(0, 0);
}

function cancelEdit() {
  state.editingSessionId = "";
  state.attendanceDraft.clear();
  state.date = new Date().toISOString().slice(0, 10);
  state.tab = "history";
  render();
}

async function addStudent(event) {
  event.preventDefault();
  const action_code = document.querySelector("#student-action").value.trim();
  const name = document.querySelector("#student-name").value.trim();
  const group_id = document.querySelector("#student-group").value;
  const { error } = await supabase.from("golf_students").insert({ action_code, name, group_id });
  if (error) return toast(error.code === "23505" ? "Ese golfista ya está registrado con la misma acción." : error.message, "error");
  toast("Golfista añadido correctamente."); await loadAll({ quiet: true });
}
async function addProfessor(event) {
  event.preventDefault(); const name = document.querySelector("#professor-name").value.trim();
  const { error } = await supabase.from("golf_professors").insert({ name });
  if (error) return toast(error.code === "23505" ? "Ese profesor ya existe." : error.message, "error");
  toast("Profesor añadido correctamente."); await loadAll({ quiet: true });
}
async function addGroup(event) {
  event.preventDefault(); const name = document.querySelector("#group-name").value.trim();
  const { error } = await supabase.from("golf_groups").insert({ name });
  if (error) return toast(error.code === "23505" ? "Ese grupo ya existe." : error.message, "error");
  toast("Grupo añadido correctamente."); await loadAll({ quiet: true });
}
let realtimeTimer;
supabase.channel("academia-golf-publica")
  .on("postgres_changes", { event: "*", schema: "public", table: "golf_groups" }, scheduleRealtimeLoad)
  .on("postgres_changes", { event: "*", schema: "public", table: "golf_professors" }, scheduleRealtimeLoad)
  .on("postgres_changes", { event: "*", schema: "public", table: "golf_students" }, scheduleRealtimeLoad)
  .on("postgres_changes", { event: "*", schema: "public", table: "golf_sessions" }, scheduleRealtimeLoad)
  .on("postgres_changes", { event: "*", schema: "public", table: "golf_attendance" }, scheduleRealtimeLoad)
  .subscribe();
function scheduleRealtimeLoad() { clearTimeout(realtimeTimer); realtimeTimer = setTimeout(() => loadAll({ quiet: true }), 250); }

loadAll();
