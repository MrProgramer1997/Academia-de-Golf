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
  groupId: "", professorId: "", selected: new Set(),
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
    supabase.from("golf_attendance").select("session_id,student_id,created_at")
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
  state.selected = new Set([...state.selected].filter(id => studentsForGroup(state.groupId).some(s => s.id === id)));
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
  return `<div class="page-heading"><div><h2>Registrar asistencia</h2><p>Crea la clase y marca los golfistas que asistieron.</p></div></div>
    <div class="grid two">
      <section class="card"><h3>Información de la clase</h3><div class="form-grid">
        <div class="field"><label for="class-date">Fecha</label><input id="class-date" type="date" value="${state.date}"></div>
        <div class="field"><label for="class-group">Grupo</label><select id="class-group">${groupOptions(state.groupId)}</select></div>
        <div class="field"><label for="class-professor">Profesor</label><select id="class-professor">${professorOptions(state.professorId)}</select></div>
        <div class="field"><label>Tipo de clase</label><div class="readonly-field">${escapeHtml(groupName(state.groupId))}</div></div>
      </div><div class="notice" style="margin-top:16px">Los alumnos se muestran según el grupo seleccionado. Una asistencia guardada puede actualizarse volviendo a elegir la misma fecha, profesor, grupo y tipo de clase.</div></section>
      <section class="card"><div class="student-toolbar"><strong>Presentes: ${state.selected.size} de ${students.length}</strong><button class="link-btn" id="toggle-all">${state.selected.size === students.length && students.length ? "Desmarcar todos" : "Marcar todos"}</button></div>
        ${students.length ? `<div class="student-list">${students.map(s => `<label class="student-check ${state.selected.has(s.id) ? "selected" : ""}"><input type="checkbox" data-student="${s.id}" ${state.selected.has(s.id) ? "checked" : ""}><span><span class="student-name">${escapeHtml(s.name)}</span><br><span class="student-action">Acción ${escapeHtml(s.action_code)}</span></span><span class="badge">${escapeHtml(groupName(s.group_id))}</span></label>`).join("")}</div><div class="actions"><button class="btn btn-primary" id="save-attendance" ${state.saving ? "disabled" : ""}>${state.saving ? "Guardando…" : "Guardar asistencia"}</button></div>` : empty("⛳", "Este grupo todavía no tiene golfistas activos.")}
      </section>
    </div>`;
}

function groupsView() {
  const groups = state.groups.filter(g => g.active).sort(byName);
  return `<div class="page-heading"><div><h2>Golfistas por grupos</h2><p>Consulta la acción, nombre, grupo y asistencias acumuladas.</p></div></div>
    <section class="card">${groups.length ? groups.map(group => {
      const members = studentsForGroup(group.id);
      return `<div class="group-block"><div class="group-title"><h3>${escapeHtml(group.name)}</h3><span class="badge">${members.length} golfista${members.length === 1 ? "" : "s"}</span></div>
        ${members.length ? `<div class="table-wrap"><table><thead><tr><th>Acción</th><th>Golfista</th><th>Grupo</th><th>Asistencias</th></tr></thead><tbody>${members.map(s => `<tr><td>${escapeHtml(s.action_code)}</td><td><strong>${escapeHtml(s.name)}</strong></td><td>${escapeHtml(group.name)}</td><td>${state.attendance.filter(a => a.student_id === s.id).length}</td></tr>`).join("")}</tbody></table></div>` : empty("🏌️", "No hay golfistas en este grupo.")}</div>`;
    }).join("") : empty("📁", "Crea el primer grupo desde Administrar.")}</section>`;
}

function historyView() {
  const sessions = state.sessions.filter(s => state.historyGroup === "all" || s.group_id === state.historyGroup);
  return `<div class="page-heading"><div><h2>Historial de clases</h2><p>Revisa quién asistió, con qué profesor y en qué tipo de clase.</p></div><div><label for="history-group">Filtrar por grupo</label><select id="history-group"><option value="all">Todos los grupos</option>${groupOptions(state.historyGroup)}</select></div></div>
    <section class="card">${sessions.length ? `<div class="history-list">${sessions.map(session => {
      const ids = attendanceFor(session.id).map(a => a.student_id);
      const names = ids.map(id => state.students.find(s => s.id === id)?.name).filter(Boolean).sort((a,b) => a.localeCompare(b, "es"));
      return `<article class="session"><div class="session-top"><div><h3>${escapeHtml(session.class_type)} · ${escapeHtml(groupName(session.group_id))}</h3><div class="session-meta">${escapeHtml(formatDate(session.class_date))} · Profesor: ${escapeHtml(professorName(session.professor_id))}</div></div><span class="badge">${names.length} presentes</span></div><p class="session-students">${names.length ? names.map(escapeHtml).join(" · ") : "Sin asistentes registrados"}</p></article>`;
    }).join("")}</div>` : empty("📋", "No hay clases registradas para este filtro.")}</section>`;
}

function summaryView() {
  const sessions = state.sessions.filter(s => state.summaryGroup === "all" || s.group_id === state.summaryGroup);
  const sessionIds = new Set(sessions.map(s => s.id));
  const attendance = state.attendance.filter(a => sessionIds.has(a.session_id));
  const eligibleStudents = state.students.filter(s => s.active && (state.summaryGroup === "all" || s.group_id === state.summaryGroup)).sort(byName);
  const activeGroups = new Set(sessions.map(s => s.group_id)).size;
  const professorRows = state.professors.filter(p => p.active).sort(byName).map(professor => ({
    name: professor.name,
    total: sessions.filter(session => session.professor_id === professor.id).length
  }));
  return `<div class="page-heading"><div><h2>Resumen de asistencia</h2><p>Indicadores reales de clases y participaciones por grupo.</p></div><div><label for="summary-group">Filtrar por grupo</label><select id="summary-group"><option value="all">Todos los grupos</option>${groupOptions(state.summaryGroup)}</select></div></div>
    <div class="stats"><div class="stat"><span class="stat-value">${sessions.length}</span><span class="stat-label">Clases realizadas</span></div><div class="stat"><span class="stat-value">${attendance.length}</span><span class="stat-label">Asistencias registradas</span></div><div class="stat"><span class="stat-value">${eligibleStudents.length}</span><span class="stat-label">Golfistas activos</span></div><div class="stat"><span class="stat-value">${activeGroups}</span><span class="stat-label">Grupos con actividad</span></div></div>
    <div class="grid two summary-detail"><section class="card"><h3>Clases por profesor</h3>${professorRows.length ? `<div class="professor-list">${professorRows.map(row => `<div class="professor-row"><strong>${escapeHtml(row.name)}</strong><span class="badge">${row.total} clase${row.total === 1 ? "" : "s"}</span></div>`).join("")}</div>` : empty("🏌️", "No hay profesores activos.")}</section>
    <section class="card"><h3>Detalle por golfista</h3>${eligibleStudents.length ? `<div class="table-wrap"><table><thead><tr><th>Acción</th><th>Golfista</th><th>Grupo</th><th>Asistencias</th><th>Clases del grupo</th><th>Participación</th></tr></thead><tbody>${eligibleStudents.map(student => {
      const ownSessions = sessions.filter(s => s.group_id === student.group_id);
      const ownSessionIds = new Set(ownSessions.map(s => s.id));
      const present = state.attendance.filter(a => a.student_id === student.id && ownSessionIds.has(a.session_id)).length;
      const rate = ownSessions.length ? Math.round((present / ownSessions.length) * 100) : 0;
      return `<tr><td>${escapeHtml(student.action_code)}</td><td><strong>${escapeHtml(student.name)}</strong></td><td>${escapeHtml(groupName(student.group_id))}</td><td>${present}</td><td>${ownSessions.length}</td><td><span class="badge">${rate}%</span></td></tr>`;
    }).join("")}</tbody></table></div>` : empty("📊", "No hay golfistas para calcular el resumen.")}</section></div>`;
}

function manageView() {
  const groups = state.groups.filter(g => g.active).sort(byName);
  const professors = state.professors.filter(p => p.active).sort(byName);
  const students = state.students.filter(s => s.active).sort(byName);
  return `<div class="page-heading"><div><h2>Administrar academia</h2><p>Añade golfistas, profesores y grupos desde cero.</p></div></div>
    <div class="notice" style="margin-bottom:18px"><strong>Módulo público:</strong> no hay contraseña. Toda persona con el enlace podrá consultar y modificar esta información.</div>
    <div class="manage-grid">
      <section class="card"><h3>Nuevo golfista</h3><form id="student-form"><div class="field"><label for="student-action">Acción</label><input id="student-action" required maxlength="30" autocomplete="off" placeholder="Ej. 12345"></div><div class="field"><label for="student-name">Nombre completo</label><input id="student-name" required maxlength="120" autocomplete="off" placeholder="Nombre del golfista"></div><div class="field"><label for="student-group">Grupo</label><select id="student-group" required>${groupOptions(state.groupId)}</select></div><button class="btn btn-secondary" type="submit">Añadir golfista</button></form><div class="manage-list">${students.slice(0, 10).map(s => manageItem(s.name, `Acción ${s.action_code} · ${groupName(s.group_id)}`, "student", s.id)).join("")}${students.length > 10 ? `<small class="muted">Y ${students.length - 10} más en Alumnos por grupos.</small>` : ""}</div></section>
      <section class="card"><h3>Nuevo profesor</h3><form id="professor-form"><div class="field"><label for="professor-name">Nombre completo</label><input id="professor-name" required maxlength="120" autocomplete="off" placeholder="Nombre del profesor"></div><button class="btn btn-secondary" type="submit">Añadir profesor</button></form><div class="manage-list">${professors.map(p => manageItem(p.name, "Profesor activo", "professor", p.id)).join("")}</div></section>
      <section class="card"><h3>Nuevo grupo</h3><form id="group-form"><div class="field"><label for="group-name">Nombre del grupo</label><input id="group-name" required maxlength="80" autocomplete="off" placeholder="Ej. Semillero 1"></div><button class="btn btn-secondary" type="submit">Añadir grupo</button></form><div class="manage-list">${groups.map(g => manageItem(g.name, `${studentsForGroup(g.id).length} golfistas`, "group", g.id)).join("")}</div></section>
    </div>`;
}

function manageItem(title, meta, type, id) {
  return `<div class="manage-item"><span class="manage-main"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta)}</small></span><button class="icon-btn" data-deactivate="${type}" data-id="${id}">Desactivar</button></div>`;
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
  document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => { state.tab = button.dataset.tab; state.selected.clear(); render(); window.scrollTo(0, 0); }));
  document.querySelector("#class-date")?.addEventListener("change", e => { state.date = e.target.value; });
  document.querySelector("#class-group")?.addEventListener("change", e => { state.groupId = e.target.value; state.selected.clear(); render(); });
  document.querySelector("#class-professor")?.addEventListener("change", e => { state.professorId = e.target.value; });
  document.querySelectorAll("[data-student]").forEach(box => box.addEventListener("change", () => { box.checked ? state.selected.add(box.dataset.student) : state.selected.delete(box.dataset.student); render(); }));
  document.querySelector("#toggle-all")?.addEventListener("click", () => { const students = studentsForGroup(state.groupId); state.selected = state.selected.size === students.length ? new Set() : new Set(students.map(s => s.id)); render(); });
  document.querySelector("#save-attendance")?.addEventListener("click", saveAttendance);
  document.querySelector("#history-group")?.addEventListener("change", e => { state.historyGroup = e.target.value; render(); });
  document.querySelector("#summary-group")?.addEventListener("change", e => { state.summaryGroup = e.target.value; render(); });
  document.querySelector("#student-form")?.addEventListener("submit", addStudent);
  document.querySelector("#professor-form")?.addEventListener("submit", addProfessor);
  document.querySelector("#group-form")?.addEventListener("submit", addGroup);
  document.querySelectorAll("[data-deactivate]").forEach(btn => btn.addEventListener("click", () => deactivate(btn.dataset.deactivate, btn.dataset.id)));
}

async function saveAttendance() {
  if (!state.groupId || !state.professorId) return toast("Primero crea un grupo y un profesor.", "error");
  if (!state.selected.size) return toast("Selecciona al menos un golfista presente.", "error");
  state.saving = true; render();
  const payload = { class_date: state.date, group_id: state.groupId, professor_id: state.professorId, class_type: groupName(state.groupId) };
  const { data: session, error: sessionError } = await supabase.from("golf_sessions").upsert(payload, { onConflict: "class_date,group_id,professor_id,class_type" }).select("id").single();
  if (sessionError) { state.saving = false; render(); return toast(sessionError.message, "error"); }
  const { error: deleteError } = await supabase.from("golf_attendance").delete().eq("session_id", session.id);
  const rows = [...state.selected].map(student_id => ({ session_id: session.id, student_id }));
  const { error: insertError } = deleteError ? { error: deleteError } : await supabase.from("golf_attendance").insert(rows);
  state.saving = false;
  if (insertError) { render(); return toast(`No se guardó la asistencia: ${insertError.message}`, "error"); }
  toast(`Asistencia guardada: ${rows.length} golfista${rows.length === 1 ? "" : "s"}.`);
  state.selected.clear(); await loadAll({ quiet: true });
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
async function deactivate(type, id) {
  const tables = { student: "golf_students", professor: "golf_professors", group: "golf_groups" };
  if (!confirm("Se ocultará de los listados activos, pero se conservará su historial. ¿Continuar?")) return;
  const { error } = await supabase.from(tables[type]).update({ active: false }).eq("id", id);
  if (error) return toast(error.message, "error");
  toast("Registro desactivado; el historial se conserva."); await loadAll({ quiet: true });
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
