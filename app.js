// ============================================
// RUTACOBRO v2 — app.js
// Mejoras: cobrador agrega clientes/préstamos,
// flujo de caja por ruta, base cualquier día,
// diseño responsive móvil
// ============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, setDoc, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAimlF93zHOjxrS9mbaq2NTp9rSNP9Nnms",
  authDomain: "control-credito.firebaseapp.com",
  projectId: "control-credito",
  storageBucket: "control-credito.firebasestorage.app",
  messagingSenderId: "585926324259",
  appId: "1:585926324259:web:fd27831c3c6faf803d4196"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ── Constantes ────────────────────────────────
const HOY   = new Date();
const ISO   = HOY.toISOString().slice(0, 10);
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const CATS  = {
  transporte:     { label:'Transporte',   color:'#1565C0', bg:'#E3F2FD' },
  nomina:         { label:'Nómina',       color:'#2E7D32', bg:'#E8F5E9' },
  oficina:        { label:'Oficina',      color:'#6A1B9A', bg:'#F3E5F5' },
  comunicaciones: { label:'Comunicac.',   color:'#E65100', bg:'#FBE9E7' },
  otros:          { label:'Otros',        color:'#616161', bg:'#F5F5F5' },
};

// ── Estado ────────────────────────────────────
let CU     = null;
let mesSel = ISO.slice(0, 7);
let flujoMesSel = ISO.slice(0, 7);
let STATE  = { usuarios:[], rutas:[], clientes:[], prestamos:[], gastos:[], cierres:[], bases:[] };
let unsubs = [];

// ── Helpers ───────────────────────────────────
const fm  = n  => '$' + Math.round(n).toLocaleString('es-CO');
const fd  = d  => { try { return new Date(d).toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'}); } catch(e){return d||'';} };
const gR  = id => STATE.rutas.find(r => r.id === id);
const gC  = id => STATE.clientes.find(c => c.id === id);
const gP  = id => STATE.prestamos.find(p => p.id === id);

const myP = () => {
  if (!CU || CU.rol === 'admin') return STATE.prestamos;
  const ids = STATE.clientes.filter(c => c.rutaId === CU.rutaId).map(c => c.id);
  return STATE.prestamos.filter(p => ids.includes(p.clienteId));
};
const myC = () => {
  if (!CU || CU.rol === 'admin') return STATE.clientes;
  return STATE.clientes.filter(c => c.rutaId === CU.rutaId);
};
const myG = mes => {
  let g = STATE.gastos.filter(g => g.fecha && g.fecha.slice(0,7) === mes);
  if (CU && CU.rol === 'ruta') g = g.filter(g => g.rutaId === CU.rutaId || !g.rutaId);
  return g;
};
const myB = mes => {
  let b = STATE.bases.filter(b => b.fecha && b.fecha.slice(0,7) === mes);
  if (CU && CU.rol === 'ruta') b = b.filter(b => b.rutaId === CU.rutaId || !b.rutaId);
  return b;
};

function pInfo(p) {
  const tot   = p.capital * (1 + p.interes / 100);
  const c     = tot / p.dias;
  const ini   = new Date(p.fechaInicio);
  const pagos = p.pagos || {};
  const pag   = Object.values(pagos).filter(v => v).length;
  const venc  = [];
  for (let i = 1; i <= p.dias; i++) {
    const d = new Date(ini); d.setDate(d.getDate() + i - 1);
    if (d.toISOString().slice(0,10) < ISO && !pagos[i]) venc.push(i);
  }
  let est = 'activo';
  if (pag >= p.dias)      est = 'completado';
  else if (venc.length >= 3) est = 'moroso';
  else if (venc.length > 0)  est = 'atraso';
  return { tot, c, pag, venc, prog:(pag/p.dias)*100, est };
}

function getMeses() {
  const s = new Set();
  STATE.prestamos.forEach(p => {
    if (!p.fechaInicio) return;
    const ini = new Date(p.fechaInicio);
    for (let i = 0; i < p.dias; i++) {
      const d = new Date(ini); d.setDate(d.getDate() + i);
      s.add(d.toISOString().slice(0,7));
    }
  });
  STATE.gastos.forEach(g => g.fecha && s.add(g.fecha.slice(0,7)));
  STATE.bases.forEach(b => b.fecha && s.add(b.fecha.slice(0,7)));
  s.add(ISO.slice(0,7));
  return [...s].sort().reverse();
}

function getIngresosMes(mes, rutaId) {
  let t = 0;
  let pres = rutaId
    ? STATE.prestamos.filter(p => { const c = gC(p.clienteId); return c && c.rutaId === rutaId; })
    : myP();
  pres.forEach(p => {
    const info  = pInfo(p);
    const ini   = new Date(p.fechaInicio);
    const pagos = p.pagos || {};
    for (let n = 1; n <= p.dias; n++) {
      const d = new Date(ini); d.setDate(d.getDate() + n - 1);
      if (d.toISOString().slice(0,7) === mes && pagos[n]) t += info.c;
    }
  });
  return t;
}
function getGastosMes(mes, rutaId) {
  let g = STATE.gastos.filter(g => g.fecha && g.fecha.slice(0,7) === mes);
  if (rutaId) g = g.filter(g => g.rutaId === rutaId);
  return g.reduce((s, g) => s + (g.monto||0), 0);
}
function getBasesMes(mes, rutaId) {
  let b = STATE.bases.filter(b => b.fecha && b.fecha.slice(0,7) === mes);
  if (rutaId) b = b.filter(b => b.rutaId === rutaId);
  const entradas = b.filter(b => b.tipo !== 'retiro').reduce((s,b) => s+(b.monto||0), 0);
  const salidas  = b.filter(b => b.tipo === 'retiro').reduce((s,b) => s+(b.monto||0), 0);
  return { entradas, salidas, neto: entradas - salidas };
}

// ── Toast ─────────────────────────────────────
function toast(msg, type='') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' '+type : '');
  setTimeout(() => el.className='toast', 3200);
}

// ── Sync status ───────────────────────────────
function setSyncStatus(s) {
  const dot = document.getElementById('sync-dot');
  const txt = document.getElementById('sync-text');
  if (!dot) return;
  dot.className = 'sync-dot' + (s==='online'?'':s==='offline'?' offline':' connecting');
  txt.textContent = s==='online'?'Sincronizado':s==='offline'?'Sin conexión':'Conectando...';
}

// ── Sidebar móvil ─────────────────────────────
window.toggleSidebar = function() {
  const sb  = document.getElementById('sidebar');
  const btn = document.getElementById('hamburger-btn');
  const ov  = document.getElementById('sidebar-overlay');
  const open = sb.classList.toggle('open');
  btn.classList.toggle('open', open);
  ov.classList.toggle('show', open);
};
window.closeSidebar = function() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('hamburger-btn').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('show');
};

// ── LOGIN ─────────────────────────────────────
function buildLoginUsers() {
  const users = STATE.usuarios.length > 0 ? STATE.usuarios
    : [{id:'admin',nombre:'Administrador',rol:'admin',rutaId:null}];
  document.getElementById('login-users').innerHTML = users.map(u =>
    `<div class="user-chip" id="chip-${u.id}" onclick="selectUser('${u.id}')">
      <div class="uc-name">${u.nombre.split(' ')[0]}</div>
      <div class="uc-role">${u.rol==='admin'?'Admin':'Ruta '+(gR(u.rutaId)||{nombre:''}).nombre}</div>
    </div>`
  ).join('');
}
window.selectUser = function(id) {
  window._selUserId = id;
  document.querySelectorAll('.user-chip').forEach(c => c.classList.remove('selected'));
  const el = document.getElementById('chip-'+id);
  if (el) el.classList.add('selected');
  document.getElementById('login-pass').focus();
  document.getElementById('login-error').textContent = '';
};
window.doLogin = function() {
  const id   = window._selUserId;
  const pass = document.getElementById('login-pass').value;
  if (!id)   { document.getElementById('login-error').textContent='Selecciona un usuario'; return; }
  const u = STATE.usuarios.find(x => x.id === id);
  if (!u)    { document.getElementById('login-error').textContent='Usuario no encontrado'; return; }
  if (pass !== u.pass) { document.getElementById('login-error').textContent='Contraseña incorrecta'; return; }
  CU = u;
  document.getElementById('view-login').style.display = 'none';
  document.getElementById('view-app').style.display   = 'block';
  document.getElementById('sb-user').textContent      = CU.nombre;
  document.getElementById('sb-role').textContent      = CU.rol==='admin'?'Administrador':'Ruta '+(gR(CU.rutaId)||{nombre:''}).nombre;
  document.getElementById('mobile-user').textContent  = CU.nombre.split(' ')[0];
  mesSel = flujoMesSel = ISO.slice(0,7);
  buildNav();
  goto('dashboard');
  subscribeAll();
};
window.logout = function() {
  unsubs.forEach(fn => fn()); unsubs = [];
  CU = null; window._selUserId = null;
  document.getElementById('view-app').style.display   = 'none';
  document.getElementById('view-login').style.display = 'flex';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-error').textContent = '';
  buildLoginUsers();
};

// ── Firebase listeners ────────────────────────
async function subscribeAll() {
  setSyncStatus('connecting');
  ['rutas','clientes','prestamos','gastos','cierres','bases'].forEach(col => {
    const q = query(collection(db,col), orderBy('createdAt','asc'));
    const u = onSnapshot(q,
      snap => { STATE[col]=snap.docs.map(d=>({id:d.id,...d.data()})); setSyncStatus('online'); refreshCurrentScreen(); },
      err  => { console.error(col,err); setSyncStatus('offline'); }
    );
    unsubs.push(u);
  });
  const uU = onSnapshot(collection(db,'usuarios'),
    snap => { STATE.usuarios=snap.docs.map(d=>({id:d.id,...d.data()})); buildLoginUsers(); },
    err  => console.error('usuarios',err)
  );
  unsubs.push(uU);
}
function refreshCurrentScreen() {
  const a = document.querySelector('.screen.active');
  if (a) SCREENS[a.id.replace('sc-','')]?.();
}

// ── Navegación ────────────────────────────────
const SCREENS = {
  dashboard: renderDashboard,
  clientes:  renderClientes,
  cobros:    renderCobros,
  recaudos:  renderRecaudos,
  prestamos: renderPrestamos,
  gastos:    renderGastos,
  ganancias: renderGanancias,
  flujo:     renderFlujo,
  cierre:    renderCierre,
  morosos:   renderMorosos,
  rutas:     renderRutas,
  usuarios:  renderUsuarios,
  reportes:  () => {},
};

const I = {
  home: '<rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor"/><rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" opacity=".7"/><rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" opacity=".7"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" opacity=".5"/>',
  cobros:'<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M8 4v4l3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  warn:  '<path d="M8 1L1 14h14L8 1z" stroke="currentColor" stroke-width="1.5"/><path d="M8 6v4M8 11v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  cli:   '<circle cx="6" cy="5" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M1 14c0-3 2-5 5-5s5 2 5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  pre:   '<rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M1 7h14" stroke="currentColor" stroke-width="1.5"/>',
  rec:   '<path d="M2 12V5l5-3 5 3v7l-5 3-5-3z" stroke="currentColor" stroke-width="1.5"/>',
  ruta:  '<circle cx="4" cy="4" r="2" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="2" stroke="currentColor" stroke-width="1.5"/><path d="M4 6v3a3 3 0 003 3h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  usr:   '<circle cx="5" cy="5" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M1 14c0-3 2-5 4-5M10 8h5M12.5 5.5v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  gas:   '<path d="M3 13V7M7 13V4M11 13V9M15 13V2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  gan:   '<path d="M1 12l4-4 4 3 6-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  flujo: '<path d="M1 8h14M11 4l4 4-4 4M5 4L1 8l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  cierre:'<rect x="2" y="1" width="12" height="14" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 6h6M5 9h4M5 12h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  exp:   '<path d="M3 3h10v10H3zM3 7h10M7 3v10" stroke="currentColor" stroke-width="1.5"/>',
};

const ADMIN_NAV = [
  { sec:'General', items:[
    {id:'dashboard',l:'Inicio',ic:I.home},{id:'cobros',l:'Cobros del día',ic:I.cobros},{id:'morosos',l:'Morosos',ic:I.warn}
  ]},
  { sec:'Gestión', items:[
    {id:'clientes',l:'Clientes',ic:I.cli},{id:'prestamos',l:'Préstamos',ic:I.pre},{id:'recaudos',l:'Recaudos',ic:I.rec},
    {id:'rutas',l:'Rutas',ic:I.ruta},{id:'usuarios',l:'Usuarios',ic:I.usr}
  ]},
  { sec:'Finanzas', items:[
    {id:'gastos',l:'Gastos',ic:I.gas},{id:'ganancias',l:'Ganancias',ic:I.gan},
    {id:'flujo',l:'Flujo de caja',ic:I.flujo},{id:'cierre',l:'Cierre del día',ic:I.cierre},{id:'reportes',l:'Exportar Excel',ic:I.exp}
  ]},
];
const RUTA_NAV = [
  { sec:'Mi ruta', items:[
    {id:'dashboard',l:'Inicio',ic:I.home},{id:'cobros',l:'Cobros del día',ic:I.cobros},
    {id:'clientes',l:'Mis clientes',ic:I.cli},{id:'prestamos',l:'Préstamos',ic:I.pre},
    {id:'recaudos',l:'Recaudos',ic:I.rec},{id:'gastos',l:'Mis gastos',ic:I.gas},
    {id:'cierre',l:'Cierre del día',ic:I.cierre}
  ]},
];

function buildNav() {
  const nav = CU.rol==='admin' ? ADMIN_NAV : RUTA_NAV;
  let h = '';
  nav.forEach(sec => {
    h += `<div class="nav-section">${sec.sec}</div>`;
    sec.items.forEach(it => {
      h += `<button class="nav-item" id="ni-${it.id}" onclick="goto('${it.id}')">`+
           `<svg viewBox="0 0 16 16" fill="none">${it.ic}</svg>${it.l}</button>`;
    });
  });
  document.getElementById('sidebar-nav').innerHTML = h;
}

window.goto = function(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  const sc  = document.getElementById('sc-'+id);
  const btn = document.getElementById('ni-'+id);
  if (sc)  sc.classList.add('active');
  if (btn) btn.classList.add('active');
  SCREENS[id]?.();
  closeSidebar();
};

// ── DASHBOARD ─────────────────────────────────
function renderDashboard() {
  const isA = CU.rol==='admin', ruta = isA ? null : gR(CU.rutaId);
  document.getElementById('dash-title').textContent = isA ? 'Resumen general' : 'Ruta '+(ruta?.nombre||'');
  document.getElementById('dash-fecha').textContent  = HOY.toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long'});
  const pres = myP();
  let cap=0,esp=0,rec=0,pend=0,mora=0;
  pres.forEach(p => {
    const i=pInfo(p); cap+=p.capital; esp+=i.tot; rec+=i.pag*i.c;
    if(i.est==='moroso'||i.est==='atraso') mora++;
    const ini=new Date(p.fechaInicio), pagos=p.pagos||{};
    for(let n=1;n<=p.dias;n++){const d=new Date(ini);d.setDate(d.getDate()+n-1);if(d.toISOString().slice(0,10)===ISO&&!pagos[n])pend++;}
  });
  const ganMes=getIngresosMes(ISO.slice(0,7))-getGastosMes(ISO.slice(0,7));
  document.getElementById('dash-metrics').innerHTML=`
    <div class="metric"><div class="lbl">Capital en calle</div><div class="val">${fm(cap)}</div></div>
    <div class="metric"><div class="lbl">Total a recaudar</div><div class="val">${fm(esp)}</div></div>
    <div class="metric"><div class="lbl">Cobros pend. hoy</div><div class="val">${pend}</div></div>
    <div class="metric"><div class="lbl">Ganancia del mes</div><div class="val ${ganMes>=0?'gan-pos':'gan-neg'}">${fm(ganMes)}</div></div>`;
  document.getElementById('dash-alert').innerHTML = mora>0
    ? `<div class="alert-banner">⚠ <strong>${mora} cliente(s) en mora.</strong>${isA?`<button class="btn-cobrar" onclick="goto('morosos')">Ver morosos</button>`:''}</div>` : '';
  let ch='';
  pres.forEach(p=>{
    const c=gC(p.clienteId); if(!c) return;
    const i=pInfo(p),ini=new Date(p.fechaInicio),pagos=p.pagos||{};
    for(let n=1;n<=p.dias;n++){const d=new Date(ini);d.setDate(d.getDate()+n-1);
      if(d.toISOString().slice(0,10)===ISO){const pg=pagos[n];
        ch+=`<div class="pay-row"><div class="pay-num ${pg?'pay-ok':'pay-hoy'}">${n}</div>
          <div style="flex:1;min-width:0"><div class="pay-name">${c.nombre}</div><div class="pay-sub">Cuota ${n}/${p.dias}</div></div>
          <div class="pay-monto">${fm(i.c)}</div>
          ${!pg?`<button class="btn-cobrar" onclick="cobrar('${p.id}',${n})">Cobrar</button>`:'<span class="badge badge-green">OK</span>'}
        </div>`;}}
  });
  document.getElementById('dash-cobros').innerHTML=ch||'<div class="empty">Sin cobros para hoy</div>';
  let mh='';
  pres.forEach(p=>{const i=pInfo(p);if(!i.venc.length)return;const c=gC(p.clienteId);if(!c)return;const r=gR(c.rutaId);
    mh+=`<div class="pay-row"><div style="flex:1;min-width:0"><div class="pay-name">${c.nombre} <span class="badge ${i.venc.length>=5?'badge-red':'badge-amber'}">${i.venc.length} vencidas</span></div><div class="pay-sub">${fm(i.venc.length*i.c)} en mora${r?' · Ruta '+r.nombre:''}</div></div></div>`;
  });
  document.getElementById('dash-mora').innerHTML=mh||'<div class="empty">Sin alertas de mora</div>';
}

// ── CLIENTES ──────────────────────────────────
function renderClientes() {
  const q=(document.getElementById('srch-cli')||{}).value||'';
  const list=myC().filter(c=>c.nombre.toLowerCase().includes(q.toLowerCase())||(c.cedula||'').includes(q));
  document.getElementById('tb-clientes').innerHTML=list.map(c=>{
    const r=gR(c.rutaId);
    const ps=myP().filter(p=>p.clienteId===c.id);
    const act=ps.filter(p=>['activo','atraso','moroso'].includes(pInfo(p).est)).length;
    return`<tr><td><div class="td-name">${c.nombre}</div><div class="td-sub">${c.cedula||''}${c.tel?' · '+c.tel:''}</div></td>
      <td>${c.tel||''}</td>
      <td>${r?`<span class="ruta-dot" style="background:${r.color}"></span>${r.nombre}`:'—'}</td>
      <td><span class="badge ${act>0?'badge-blue':'badge-green'}">${act>0?act+' activos':'Al día'}</span>
      <button class="btn-ver" style="margin-left:4px" onclick="verCliente('${c.id}')">Ver</button></td></tr>`;
  }).join('')||'<tr><td colspan="4"><div class="empty">Sin clientes</div></td></tr>';
}

// ── COBROS ────────────────────────────────────
function renderCobros() {
  const pres=myP();let ph=0,pc=0,th=0,tc=0,html='';
  pres.forEach(p=>{const c=gC(p.clienteId);if(!c)return;const i=pInfo(p),r=gR(c.rutaId),ini=new Date(p.fechaInicio),pagos=p.pagos||{};
    for(let n=1;n<=p.dias;n++){const d=new Date(ini);d.setDate(d.getDate()+n-1);
      if(d.toISOString().slice(0,10)===ISO){const pg=pagos[n];th+=i.c;if(pg){pc++;tc+=i.c;}else ph++;
        html+=`<div class="pay-row"><div class="pay-num ${pg?'pay-ok':'pay-hoy'}">${n}</div>
          <div style="flex:1;min-width:0"><div class="pay-name">${c.nombre}</div><div class="pay-sub">Cuota ${n}/${p.dias}${r?' · '+r.nombre:''}</div></div>
          <div class="pay-monto">${fm(i.c)}</div>
          ${pg?'<span class="badge badge-green">OK</span>':`<button class="btn-cobrar" onclick="cobrar('${p.id}',${n})">Cobrar</button>`}
        </div>`;}}
  });
  document.getElementById('cobros-metrics').innerHTML=`
    <div class="metric"><div class="lbl">Por cobrar hoy</div><div class="val">${fm(th)}</div></div>
    <div class="metric"><div class="lbl">Cobrado</div><div class="val">${fm(tc)}</div></div>
    <div class="metric"><div class="lbl">Pendientes</div><div class="val">${ph}</div></div>
    <div class="metric"><div class="lbl">Completados</div><div class="val">${pc}</div></div>`;
  document.getElementById('cobros-lista').innerHTML=html||'<div class="empty">Sin cobros para hoy</div>';
}

// ── RECAUDOS ──────────────────────────────────
function renderRecaudos() {
  const pres=myP();let tot=0,cnt=0,pend=0;const rows=[];
  pres.forEach(p=>{const c=gC(p.clienteId);if(!c)return;const i=pInfo(p),ini=new Date(p.fechaInicio);
    for(let n=1;n<=p.dias;n++){const d=new Date(ini);d.setDate(d.getDate()+n-1);if(d<=HOY)rows.push({fecha:d,cli:c.nombre,monto:i.c,cuota:n+'/'+p.dias,pag:!!(p.pagos||{})[n]});}
  });
  rows.sort((a,b)=>b.fecha-a.fecha);
  rows.forEach(r=>{if(r.pag){tot+=r.monto;cnt++;}else pend++;});
  document.getElementById('rec-metrics').innerHTML=`
    <div class="metric"><div class="lbl">Total recaudado</div><div class="val">${fm(tot)}</div></div>
    <div class="metric"><div class="lbl">Pagos</div><div class="val">${cnt}</div></div>
    <div class="metric"><div class="lbl">Pendientes</div><div class="val">${pend}</div></div>
    <div class="metric"><div class="lbl">Mora estimada</div><div class="val">${fm(pend*(tot/(cnt||1)/30))}</div></div>`;
  document.getElementById('tb-recaudos').innerHTML=rows.slice(0,60).map(r=>`<tr>
    <td>${fd(r.fecha)}</td><td>${r.cli}</td><td>${fm(r.monto)}</td>
    <td><span class="badge ${r.pag?'badge-green':'badge-amber'}">${r.pag?'Pagado':'Pendiente'}</span></td>
  </tr>`).join('')||'<tr><td colspan="4"><div class="empty">Sin registros</div></td></tr>';
}

// ── PRÉSTAMOS ─────────────────────────────────
function renderPrestamos() {
  const q=(document.getElementById('srch-pre')||{}).value||'';
  const list=myP().filter(p=>{const c=gC(p.clienteId);return c&&c.nombre.toLowerCase().includes(q.toLowerCase());});
  const BDG={completado:'badge-green',moroso:'badge-red',atraso:'badge-amber',activo:'badge-blue'};
  const TXT={completado:'Completado',moroso:'Moroso',atraso:'Atraso',activo:'Activo'};
  document.getElementById('tb-prestamos').innerHTML=list.map(p=>{
    const c=gC(p.clienteId);if(!c)return'';const i=pInfo(p);
    return`<tr><td><div class="td-name">${c.nombre}</div></td>
      <td>${fm(p.capital)}</td><td>${fm(i.c)}</td>
      <td><div class="pbar"><div class="pbar-fill" style="width:${i.prog.toFixed(0)}%"></div></div><div class="td-sub">${i.pag}/${p.dias}</div></td>
      <td><span class="badge ${BDG[i.est]}">${TXT[i.est]}</span></td></tr>`;
  }).join('')||'<tr><td colspan="5"><div class="empty">Sin préstamos</div></td></tr>';
}

// ── MES SELECTOR ──────────────────────────────
function buildMesSel(elId, selVar, onChange) {
  const meses=getMeses(); if(!meses.includes(selVar)) selVar=meses[0]||ISO.slice(0,7);
  document.getElementById(elId).innerHTML=meses.slice(0,8).map(m=>
    `<button class="mes-btn ${m===selVar?'active':''}" onclick="${onChange}('${m}')">${MESES[parseInt(m.slice(5,7))-1]} ${m.slice(0,4)}</button>`
  ).join('');
  return selVar;
}

// ── GASTOS ────────────────────────────────────
window.setMesGastos = function(m) { mesSel=m; renderGastos(); };
function renderGastos() {
  mesSel = buildMesSel('mes-selector', mesSel, 'setMesGastos');
  const g=myG(mesSel),ing=getIngresosMes(mesSel),gast=getGastosMes(mesSel),gan=ing-gast;
  document.getElementById('gastos-title').textContent=CU.rol==='ruta'?`Gastos — Ruta ${gR(CU.rutaId)?.nombre||''}`:'Gastos del negocio';
  document.getElementById('gastos-metrics').innerHTML=`
    <div class="metric"><div class="lbl">Total gastos</div><div class="val">${fm(gast)}</div></div>
    <div class="metric"><div class="lbl">Ingresos cobrados</div><div class="val">${fm(ing)}</div></div>
    <div class="metric"><div class="lbl">Ganancia neta</div><div class="val ${gan>=0?'gan-pos':'gan-neg'}">${fm(gan)}</div></div>
    <div class="metric"><div class="lbl">Margen</div><div class="val ${gan>=0?'gan-pos':'gan-neg'}">${ing>0?Math.round((gan/ing)*100):0}%</div></div>`;
  document.getElementById('gastos-lista').innerHTML=g.length===0?'<div class="empty">Sin gastos este mes</div>':
    g.sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')).map(g2=>{const cat=CATS[g2.cat]||CATS.otros,r=gR(g2.rutaId);
      return`<div class="gasto-row"><div class="cat-icon" style="background:${cat.bg};color:${cat.color}">${cat.label.slice(0,2)}</div>
        <div style="flex:1;min-width:0"><div class="gasto-name">${g2.desc}</div><div class="gasto-sub">${fd(g2.fecha)}${r?' · Ruta '+r.nombre:' · General'}${g2.ref?' · '+g2.ref:''}</div></div>
        <div class="gasto-monto">${fm(g2.monto)}</div>
        <button class="btn-del" onclick="eliminarGasto('${g2.id}')">✕</button>
      </div>`;}).join('');
  const porCat={};g.forEach(g2=>{porCat[g2.cat]=(porCat[g2.cat]||0)+g2.monto;});
  const max=Math.max(...Object.values(porCat),1);
  document.getElementById('gastos-cats').innerHTML=Object.entries(porCat).sort((a,b)=>b[1]-a[1]).map(([k,v])=>{const cat=CATS[k]||CATS.otros;
    return`<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="font-weight:600">${cat.label}</span><span style="font-weight:700;color:var(--red)">${fm(v)}</span></div><div class="pbar"><div class="pbar-fill" style="background:${cat.color};width:${Math.round((v/max)*100)}%"></div></div></div>`;
  }).join('')||'<div class="empty">Sin datos</div>';
  const pct=ing>0?Math.min(100,Math.round((gan/ing)*100)):0;
  document.getElementById('gastos-resumen').innerHTML=`
    <div class="fin-row"><span>Ingresos cobrados</span><span class="gan-pos">${fm(ing)}</span></div>
    <div class="fin-row"><span>Total gastos</span><span class="gan-neg">− ${fm(gast)}</span></div>
    <div class="fin-divider"></div>
    <div class="fin-total"><span>Ganancia neta</span><span class="${gan>=0?'gan-pos':'gan-neg'}" style="font-size:16px">${fm(gan)}</span></div>
    <div style="margin:12px 0 4px;display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--text-muted);font-weight:600">Margen</span><span class="${gan>=0?'gan-pos':'gan-neg'}">${ing>0?Math.round((gan/ing)*100):0}%</span></div>
    <div class="pbar"><div class="pbar-fill pbar-green" style="width:${Math.max(0,pct)}%"></div></div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:6px;font-weight:600">${MESES[parseInt(mesSel.slice(5,7))-1]} ${mesSel.slice(0,4)}</div>
    <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Base / Capital</span>
        <button class="btn-base" onclick="openModal('m-base')">+ Agregar base</button>
      </div>
      ${renderBasesResumen(mesSel)}
    </div>`;
}

function renderBasesResumen(mes) {
  const bases=myB(mes);
  if(!bases.length) return '<div style="font-size:12px;color:var(--text-muted)">Sin registros de base este mes</div>';
  const html=bases.sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')).map(b=>{
    const r=gR(b.rutaId);const es=b.tipo==='retiro';
    return`<div class="base-row">
      <div class="base-tipo" style="background:${es?'#FFEBEE':'#E8F5E9'};color:${es?'#C62828':'#2E7D32'}">${es?'−':b.tipo==='abono'?'+':'B'}</div>
      <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;color:var(--blue-dark)">${b.desc||b.tipo}</div><div style="font-size:11px;color:var(--text-muted)">${fd(b.fecha)}${r?' · '+r.nombre:''}</div></div>
      <div style="font-size:13px;font-weight:700;color:${es?'var(--red)':'var(--green)'}">${es?'−':'+'}${fm(b.monto)}</div>
      <button class="btn-del" onclick="eliminarBase('${b.id}')">✕</button>
    </div>`;
  }).join('');
  const {entradas,salidas,neto}=getBasesMes(mes);
  return html+`<div style="margin-top:8px;padding:8px 10px;background:var(--blue-lighter);border-radius:6px;font-size:12px;display:flex;justify-content:space-between">
    <span style="color:var(--text-muted)">Neto base</span><span style="font-weight:700;color:${neto>=0?'var(--green)':'var(--red)'}">${neto>=0?'+':''}${fm(neto)}</span></div>`;
}

// ── GANANCIAS ─────────────────────────────────
function renderGanancias() {
  const meses=getMeses();let tI=0,tG=0,mejorM=null,mejorG=-Infinity;
  const rows=meses.map(m=>{const ing=getIngresosMes(m),gas=getGastosMes(m),gan=ing-gas;tI+=ing;tG+=gas;if(gan>mejorG){mejorG=gan;mejorM=m;}return{m,ing,gas,gan};});
  const tGan=tI-tG;
  document.getElementById('gan-metrics').innerHTML=`
    <div class="metric"><div class="lbl">Ingresos totales</div><div class="val">${fm(tI)}</div></div>
    <div class="metric"><div class="lbl">Gastos totales</div><div class="val">${fm(tG)}</div></div>
    <div class="metric"><div class="lbl">Ganancia acumulada</div><div class="val ${tGan>=0?'gan-pos':'gan-neg'}">${fm(tGan)}</div></div>
    <div class="metric"><div class="lbl">Mejor mes</div><div class="val" style="font-size:14px">${mejorM?MESES[parseInt(mejorM.slice(5,7))-1]+' '+mejorM.slice(0,4):'—'}</div><div class="sub gan-pos">${mejorM?fm(mejorG):''}</div></div>`;
  document.getElementById('gan-tabla').innerHTML=`<table><thead><tr><th style="width:18%">Mes</th><th>Ingresos</th><th>Gastos</th><th>Ganancia</th><th>Margen</th></tr></thead><tbody>`+
    rows.map(r=>{const pct=r.ing>0?Math.round((r.gan/r.ing)*100):0;return`<tr>
      <td class="td-name">${MESES[parseInt(r.m.slice(5,7))-1]}<div class="td-sub">${r.m.slice(0,4)}</div></td>
      <td class="gan-pos">${fm(r.ing)}</td><td class="gan-neg">${fm(r.gas)}</td>
      <td class="${r.gan>=0?'gan-pos':'gan-neg'}" style="font-weight:700">${fm(r.gan)}</td>
      <td><div class="gan-bar-wrap"><div class="gan-bar-track"><div class="gan-bar-fill" style="background:${r.gan>=0?'var(--green)':'var(--red)'};width:${Math.abs(pct)}%"></div></div><span class="gan-pct ${r.gan>=0?'gan-pos':'gan-neg'}">${pct}%</span></div></td>
    </tr>`;}).join('')+'</tbody></table>';
  if(CU.rol==='admin'){let rH='';
    STATE.rutas.forEach(ruta=>{
      const cIds=STATE.clientes.filter(c=>c.rutaId===ruta.id).map(c=>c.id);
      const ing=getMeses().reduce((s,m)=>{let t=0;STATE.prestamos.filter(p=>cIds.includes(p.clienteId)).forEach(p=>{const i=pInfo(p),ini=new Date(p.fechaInicio),pagos=p.pagos||{};for(let n=1;n<=p.dias;n++){const d=new Date(ini);d.setDate(d.getDate()+n-1);if(d.toISOString().slice(0,7)===m&&pagos[n])t+=i.c;}});return s+t;},0);
      const gas=STATE.gastos.filter(g=>g.rutaId===ruta.id).reduce((s,g)=>s+(g.monto||0),0),gan=ing-gas;
      rH+=`<div class="ruta-card" style="border-left-color:${ruta.color}">
        <div style="font-size:15px;font-weight:700;color:${ruta.color};margin-bottom:4px">Ruta ${ruta.nombre}</div>
        <div class="ruta-stats">
          <div class="ruta-stat"><div class="lbl">Ingresos</div><div class="val gan-pos">${fm(ing)}</div></div>
          <div class="ruta-stat danger"><div class="lbl">Gastos</div><div class="val">${fm(gas)}</div></div>
          <div class="ruta-stat" style="grid-column:span 2"><div class="lbl">Ganancia acumulada</div><div class="val ${gan>=0?'gan-pos':'gan-neg'}" style="font-size:17px">${fm(gan)}</div></div>
        </div></div>`;
    });
    document.getElementById('gan-rutas').innerHTML=rH;
  } else document.getElementById('gan-rutas').innerHTML='';
}

// ── FLUJO DE CAJA POR RUTA ────────────────────
window.setMesFlujo = function(m) { flujoMesSel=m; renderFlujo(); };
function renderFlujo() {
  flujoMesSel = buildMesSel('flujo-mes-sel', flujoMesSel, 'setMesFlujo');
  const mes = flujoMesSel;
  const rutas = CU.rol==='admin' ? STATE.rutas : STATE.rutas.filter(r=>r.id===CU.rutaId);
  let html = '';
  rutas.forEach(ruta => {
    const cIds = STATE.clientes.filter(c=>c.rutaId===ruta.id).map(c=>c.id);
    const pres  = STATE.prestamos.filter(p=>cIds.includes(p.clienteId));
    // Ingresos día a día
    const ingDia = {};
    pres.forEach(p=>{
      const i=pInfo(p),ini=new Date(p.fechaInicio),pagos=p.pagos||{};
      for(let n=1;n<=p.dias;n++){const d=new Date(ini);d.setDate(d.getDate()+n-1);const iso=d.toISOString().slice(0,10);
        if(iso.slice(0,7)===mes&&pagos[n]){ingDia[iso]=(ingDia[iso]||0)+i.c;}}
    });
    // Gastos del mes para esta ruta
    const gastosMes = STATE.gastos.filter(g=>g.rutaId===ruta.id&&g.fecha&&g.fecha.slice(0,7)===mes);
    const gasDia = {};
    gastosMes.forEach(g=>{gasDia[g.fecha]=(gasDia[g.fecha]||0)+(g.monto||0);});
    // Bases del mes para esta ruta
    const basesMes = STATE.bases.filter(b=>b.rutaId===ruta.id&&b.fecha&&b.fecha.slice(0,7)===mes);
    const baseDia = {};
    basesMes.forEach(b=>{if(b.tipo==='retiro')baseDia[b.fecha]=(baseDia[b.fecha]||0)-(b.monto||0);else baseDia[b.fecha]=(baseDia[b.fecha]||0)+(b.monto||0);});
    // Todos los días del mes
    const diasMes = [];
    const [yr,mo] = mes.split('-').map(Number);
    const ultimo = new Date(yr, mo, 0).getDate();
    for(let d=1;d<=ultimo;d++){diasMes.push(`${mes}-${String(d).padStart(2,'0')}`);}
    const totalIng = Object.values(ingDia).reduce((s,v)=>s+v,0);
    const totalGas = Object.values(gasDia).reduce((s,v)=>s+v,0);
    const totalBase= Object.values(baseDia).reduce((s,v)=>s+v,0);
    const totalNeto= totalIng - totalGas + totalBase;
    // Solo días con movimiento
    const diasConMov = diasMes.filter(d=>ingDia[d]||gasDia[d]||baseDia[d]);
    let saldo = 0;
    const filas = diasConMov.map(d=>{
      const ing=(ingDia[d]||0), gas=(gasDia[d]||0), base=(baseDia[d]||0);
      saldo += ing - gas + base;
      return`<tr>
        <td>${fd(d)}</td>
        <td class="gan-pos" style="font-weight:${ing?'700':'400'}">${ing?fm(ing):'—'}</td>
        <td class="gan-neg" style="font-weight:${gas?'700':'400'}">${gas?fm(gas):'—'}</td>
        <td style="font-weight:${base?'700':'400'};color:${base>0?'var(--green)':base<0?'var(--red)':'var(--text-muted)'}">${base?fm(Math.abs(base))+'<span style="font-size:10px"> '+(base>0?'entrada':'retiro')+'</span>':'—'}</td>
        <td style="font-weight:700;color:${saldo>=0?'var(--green)':'var(--red)'}">${fm(saldo)}</td>
      </tr>`;
    }).join('');
    html+=`<div class="flujo-ruta" style="border-left-color:${ruta.color}">
      <div class="flujo-ruta-header">
        <div><div class="flujo-ruta-name" style="color:${ruta.color}">Ruta ${ruta.nombre}</div><div style="font-size:12px;color:var(--text-muted)">${ruta.cobrador} · ${MESES[mo-1]} ${yr}</div></div>
        <span style="background:${ruta.color};color:#fff;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700">${cIds.length} clientes</span>
      </div>
      <div class="flujo-stats">
        <div class="flujo-stat" style="background:#E8F5E9"><div class="lbl" style="color:#2E7D32">Ingresos cobrados</div><div class="val gan-pos">${fm(totalIng)}</div></div>
        <div class="flujo-stat" style="background:#FFEBEE"><div class="lbl" style="color:#C62828">Gastos del mes</div><div class="val gan-neg">${fm(totalGas)}</div></div>
        <div class="flujo-stat" style="background:var(--blue-lighter)"><div class="lbl" style="color:var(--blue)">Flujo neto</div><div class="val ${totalNeto>=0?'gan-pos':'gan-neg'}" style="font-size:18px">${fm(totalNeto)}</div></div>
      </div>
      ${diasConMov.length>0?`
      <div class="flujo-table">
        <table><thead><tr><th style="width:20%">Fecha</th><th>Ingresos</th><th>Gastos</th><th>Base</th><th>Saldo acum.</th></tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr class="flujo-total-row"><td style="font-weight:700">TOTAL</td><td class="gan-pos">${fm(totalIng)}</td><td class="gan-neg">${fm(totalGas)}</td><td style="font-weight:700;color:var(--blue)">${fm(totalBase)}</td><td style="font-weight:700;color:${totalNeto>=0?'var(--green)':'var(--red)'}">${fm(totalNeto)}</td></tr></tfoot>
        </table></div>`:
      '<div class="empty">Sin movimientos registrados este mes</div>'}
    </div>`;
  });
  if(!rutas.length) html='<div class="empty">Sin rutas configuradas</div>';
  document.getElementById('flujo-content').innerHTML=html;
}

// ── CIERRE ────────────────────────────────────
function renderCierre() {
  const pres=myP(),ruta=CU.rol==='ruta'?gR(CU.rutaId):null;
  const ckey=(CU.rutaId||'admin')+'_'+ISO,yaC=STATE.cierres.find(c=>c.id===ckey||c.ckey===ckey);
  document.getElementById('cierre-fecha').textContent=HOY.toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  let cobH=0,totH=0,cobrados=0,pendH=0;const det=[];
  pres.forEach(p=>{const c=gC(p.clienteId);if(!c)return;const i=pInfo(p),ini=new Date(p.fechaInicio),pagos=p.pagos||{};
    for(let n=1;n<=p.dias;n++){const d=new Date(ini);d.setDate(d.getDate()+n-1);
      if(d.toISOString().slice(0,10)===ISO){totH+=i.c;cobH++;if(pagos[n]){cobrados++;det.push({cli:c.nombre,cuota:n,tot:p.dias,monto:i.c,estado:'Cobrado'});}else{pendH++;det.push({cli:c.nombre,cuota:n,tot:p.dias,monto:i.c,estado:'Pendiente'});}}
    }
  });
  const totCob=det.filter(d=>d.estado==='Cobrado').reduce((s,d)=>s+d.monto,0);
  const gasHoy=myG(ISO.slice(0,7)).filter(g=>g.fecha===ISO).reduce((s,g)=>s+(g.monto||0),0);
  let html=`<div class="cierre-header">
    <div class="cierre-grid">
      <div class="cierre-item"><div class="lbl">Programadas</div><div class="val">${cobH}</div></div>
      <div class="cierre-item"><div class="lbl">Cobrados</div><div class="val">${cobrados}</div></div>
      <div class="cierre-item"><div class="lbl">Total cobrado</div><div class="val">${fm(totCob)}</div></div>
      <div class="cierre-item"><div class="lbl">Gastos hoy</div><div class="val gan-neg">${fm(gasHoy)}</div></div>
    </div>
    <div class="cierre-gan"><span>Ganancia neta del día</span><span style="font-size:20px;font-weight:700" class="${totCob-gasHoy>=0?'gan-pos':'gan-neg'}">${fm(totCob-gasHoy)}</span></div>
  </div>
  <div class="card"><h3>Detalle cobros${ruta?' — Ruta '+ruta.nombre:''}</h3>`;
  if(!det.length) html+='<div class="empty">Sin cobros programados hoy</div>';
  else det.forEach(d=>{html+=`<div class="cierre-row"><div><div class="td-name">${d.cli}</div><div class="td-sub">Cuota ${d.cuota}/${d.tot}</div></div><div style="font-weight:700">${fm(d.monto)}</div><span class="badge ${d.estado==='Cobrado'?'badge-green':'badge-amber'}">${d.estado}</span></div>`;});
  html+='</div>';
  if(yaC) html+=`<div class="cierre-ok">✓ Cierre registrado — ${fd(yaC.fecha)} a las ${yaC.hora}${yaC.nota?' · '+yaC.nota:''}</div>`;
  else html+=`<div class="cierre-nota-wrap"><div style="flex:1"><label style="font-size:11px;font-weight:700;color:var(--blue);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:4px">Notas del cierre</label><input id="cierre-nota" type="text" placeholder="Observaciones del día..."></div><button class="btn-primary" onclick="registrarCierre('${ckey}',${totCob},${cobrados},${pendH})">Registrar cierre</button></div>`;
  document.getElementById('cierre-content').innerHTML=html;
}
window.registrarCierre=async(ckey,tc,co,pe)=>{
  const nota=document.getElementById('cierre-nota')?.value||'';
  try{await setDoc(doc(db,'cierres',ckey),{ckey,fecha:ISO,hora:new Date().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}),totalCobrado:tc,cobrados:co,pendientes:pe,nota,user:CU.nombre,createdAt:Date.now()});toast('Cierre registrado','success');renderCierre();}catch(e){toast('Error al guardar','error');}
};

// ── MOROSOS ───────────────────────────────────
function renderMorosos() {
  const pres=myP();let tm=0,tc2=0,tcu=0;let html='';
  pres.forEach(p=>{const i=pInfo(p);if(!i.venc.length)return;const c=gC(p.clienteId);if(!c)return;const r=gR(c.rutaId),mm=i.venc.length*i.c;tm++;tcu+=i.venc.length;tc2+=mm;
    html+=`<div class="pay-row"><div style="flex:1;min-width:0"><div class="pay-name">${c.nombre} <span class="badge ${i.venc.length>=5?'badge-red':'badge-amber'}">${i.venc.length} vencidas</span></div><div class="pay-sub">${fm(mm)} en mora · ${c.tel||''}${r?' · Ruta '+r.nombre:''}</div></div><button class="btn-ver" onclick="verPrestamo('${p.id}')">Ver</button></div>`;
  });
  document.getElementById('mora-metrics').innerHTML=`
    <div class="metric"><div class="lbl">En mora</div><div class="val">${tm}</div></div>
    <div class="metric"><div class="lbl">Cuotas vencidas</div><div class="val">${tcu}</div></div>
    <div class="metric"><div class="lbl">Monto mora</div><div class="val">${fm(tc2)}</div></div>
    <div class="metric"><div class="lbl">Prom. días mora</div><div class="val">${tm>0?Math.round(tcu/tm):0}</div></div>`;
  document.getElementById('mora-lista').innerHTML=html||'<div class="empty">Sin clientes en mora</div>';
}

// ── RUTAS ─────────────────────────────────────
function renderRutas() {
  document.getElementById('rutas-list').innerHTML=STATE.rutas.map(r=>{
    const clis=STATE.clientes.filter(c=>c.rutaId===r.id);
    let ch=0,th=0;clis.forEach(c=>{STATE.prestamos.filter(p=>p.clienteId===c.id).forEach(p=>{const i=pInfo(p),ini=new Date(p.fechaInicio),pagos=p.pagos||{};for(let n=1;n<=p.dias;n++){const d=new Date(ini);d.setDate(d.getDate()+n-1);if(d.toISOString().slice(0,10)===ISO){th+=i.c;if(!pagos[n])ch++;}}});});
    const gas=STATE.gastos.filter(g=>g.rutaId===r.id&&g.fecha&&g.fecha.slice(0,7)===ISO.slice(0,7)).reduce((s,g)=>s+(g.monto||0),0);
    const u=STATE.usuarios.find(u=>u.rutaId===r.id);
    return`<div class="ruta-card" style="border-left-color:${r.color}">
      <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:8px">
        <div><div style="font-size:15px;font-weight:700;color:${r.color}">${r.nombre}</div><div style="font-size:12px;color:var(--text-muted);margin-top:2px">${r.cobrador} · ${r.zona||''}</div>${u?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">Usuario: <strong>${u.user}</strong></div>`:''}</div>
        <span style="background:${r.color};color:#fff;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700">${clis.length} clientes</span>
      </div>
      <div class="ruta-stats">
        <div class="ruta-stat"><div class="lbl">Clientes</div><div class="val">${clis.length}</div></div>
        <div class="ruta-stat"><div class="lbl">Cobros pend.</div><div class="val">${ch}</div></div>
        <div class="ruta-stat"><div class="lbl">Total hoy</div><div class="val">${fm(th)}</div></div>
        <div class="ruta-stat danger"><div class="lbl">Gastos mes</div><div class="val">${fm(gas)}</div></div>
      </div></div>`;
  }).join('')||'<div class="empty">Sin rutas</div>';
}

// ── USUARIOS ──────────────────────────────────
function renderUsuarios() {
  document.getElementById('tb-usuarios').innerHTML=STATE.usuarios.map(u=>{const r=gR(u.rutaId);return`<tr>
    <td class="td-name">${u.nombre}</td>
    <td><code style="font-size:12px;background:var(--blue-lighter);padding:2px 6px;border-radius:4px;color:var(--blue-dark)">${u.user}</code></td>
    <td><span class="badge ${u.rol==='admin'?'badge-blue':'badge-green'}">${u.rol==='admin'?'Admin':'Cobrador'}</span></td>
    <td>${r?`<span class="ruta-dot" style="background:${r.color}"></span>${r.nombre}`:'—'}</td>
    <td><button class="btn-ver" onclick="editarUsuario('${u.id}')">Editar</button></td>
  </tr>`;}).join('')||'<tr><td colspan="5"><div class="empty">Sin usuarios</div></td></tr>';
}

// ── ACCIONES COBRO ────────────────────────────
window.cobrar=async(prestamoId,cuotaNum)=>{
  try{const p=gP(prestamoId);if(!p)return;const pagos={...(p.pagos||{})};pagos[cuotaNum]=ISO;
    await updateDoc(doc(db,'prestamos',prestamoId),{pagos,updatedAt:Date.now()});
    toast(`Cuota ${cuotaNum} registrada`,'success');}
  catch(e){toast('Error al registrar pago','error');console.error(e);}
};

// ── MODALES ───────────────────────────────────
window.openModal=function(id){
  if(id==='m-gasto'){document.getElementById('g-fec').value=ISO;document.getElementById('g-rut').innerHTML='<option value="">General (negocio)</option>'+STATE.rutas.map(r=>`<option value="${r.id}">${r.nombre}</option>`).join('');['g-desc','g-mon','g-ref'].forEach(f=>{const el=document.getElementById(f);if(el)el.value='';});if(CU.rol==='ruta')document.getElementById('g-rut').value=CU.rutaId||'';}
  if(id==='m-cliente'){document.getElementById('c-rut').innerHTML='<option value="">Sin ruta</option>'+STATE.rutas.map(r=>`<option value="${r.id}">${r.nombre}</option>`).join('');['c-nom','c-ced','c-tel','c-dir','c-notas'].forEach(f=>{const el=document.getElementById(f);if(el)el.value='';});document.getElementById('c-ciu').value='Bogotá';if(CU.rol==='ruta')document.getElementById('c-rut').value=CU.rutaId||'';}
  if(id==='m-base'){document.getElementById('b-fec').value=ISO;document.getElementById('b-rut').innerHTML='<option value="">General (negocio)</option>'+STATE.rutas.map(r=>`<option value="${r.id}">${r.nombre}</option>`).join('');['b-mon','b-desc'].forEach(f=>{const el=document.getElementById(f);if(el)el.value='';});if(CU.rol==='ruta')document.getElementById('b-rut').value=CU.rutaId||'';}
  document.getElementById(id).style.display='flex';
};
window.closeModal=id=>{document.getElementById(id).style.display='none';};
window.openModalPrestamo=function(){
  const sel=document.getElementById('p-cli');
  sel.innerHTML='<option value="">Seleccionar cliente...</option>'+myC().map(c=>`<option value="${c.id}">${c.nombre}</option>`).join('');
  ['p-cap'].forEach(f=>document.getElementById(f).value='');
  document.getElementById('p-int').value='20';document.getElementById('p-dia').value='30';document.getElementById('p-fec').value=ISO;
  document.getElementById('prestamo-preview').innerHTML='';
  window.openModal('m-prestamo');
};
window.calcPrev=function(){
  const cap=parseFloat(document.getElementById('p-cap').value)||0,int=parseFloat(document.getElementById('p-int').value)||0,dias=parseInt(document.getElementById('p-dia').value)||0;
  if(!cap||!dias)return;const tot=cap*(1+int/100),c=tot/dias;
  document.getElementById('prestamo-preview').innerHTML=`<div class="preview-box"><div class="preview-item"><div class="lbl">Total a pagar</div><div class="val">${fm(tot)}</div></div><div class="preview-item"><div class="lbl">Cuota diaria</div><div class="val">${fm(c)}</div></div><div class="preview-item"><div class="lbl">Interés total</div><div class="val">${fm(tot-cap)}</div></div></div>`;
};

// ── GUARDAR / ELIMINAR ────────────────────────
window.guardarCliente=async()=>{
  const nom=document.getElementById('c-nom').value.trim();
  if(!nom){toast('El nombre es obligatorio','error');return;}
  try{await addDoc(collection(db,'clientes'),{nombre:nom,cedula:document.getElementById('c-ced').value,tel:document.getElementById('c-tel').value,ciudad:document.getElementById('c-ciu').value,dir:document.getElementById('c-dir').value,notas:document.getElementById('c-notas').value,rutaId:document.getElementById('c-rut').value||null,createdAt:Date.now()});
    closeModal('m-cliente');toast('Cliente guardado','success');}
  catch(e){toast('Error al guardar','error');console.error(e);}
};
window.guardarPrestamo=async()=>{
  const cid=document.getElementById('p-cli').value,cap=parseFloat(document.getElementById('p-cap').value),int=parseFloat(document.getElementById('p-int').value),dias=parseInt(document.getElementById('p-dia').value),fec=document.getElementById('p-fec').value;
  if(!cid||!cap||!dias||!fec){toast('Complete todos los campos','error');return;}
  try{await addDoc(collection(db,'prestamos'),{clienteId:cid,capital:cap,interes:int,dias,fechaInicio:fec,pagos:{},createdAt:Date.now()});
    closeModal('m-prestamo');toast('Préstamo creado','success');}
  catch(e){toast('Error al crear','error');console.error(e);}
};
window.guardarGasto=async()=>{
  const desc=document.getElementById('g-desc').value.trim(),mon=parseFloat(document.getElementById('g-mon').value);
  if(!desc||!mon){toast('Complete descripción y monto','error');return;}
  try{await addDoc(collection(db,'gastos'),{desc,monto:mon,cat:document.getElementById('g-cat').value,fecha:document.getElementById('g-fec').value,rutaId:document.getElementById('g-rut').value||null,ref:document.getElementById('g-ref').value,createdAt:Date.now()});
    closeModal('m-gasto');toast('Gasto guardado','success');}
  catch(e){toast('Error','error');console.error(e);}
};
window.eliminarGasto=async(id)=>{if(!confirm('¿Eliminar este gasto?'))return;try{await deleteDoc(doc(db,'gastos',id));toast('Gasto eliminado');}catch(e){toast('Error','error');}};
window.guardarBase=async()=>{
  const mon=parseFloat(document.getElementById('b-mon').value),fec=document.getElementById('b-fec').value;
  if(!mon||!fec){toast('Complete monto y fecha','error');return;}
  try{await addDoc(collection(db,'bases'),{monto:mon,fecha:fec,tipo:document.getElementById('b-tipo').value,rutaId:document.getElementById('b-rut').value||null,desc:document.getElementById('b-desc').value,createdAt:Date.now()});
    closeModal('m-base');toast('Base registrada','success');}
  catch(e){toast('Error','error');console.error(e);}
};
window.eliminarBase=async(id)=>{if(!confirm('¿Eliminar este registro?'))return;try{await deleteDoc(doc(db,'bases',id));toast('Eliminado');}catch(e){toast('Error','error');}};
window.guardarRuta=async()=>{
  const nom=document.getElementById('r-nom').value.trim();if(!nom){toast('Nombre requerido','error');return;}
  try{await addDoc(collection(db,'rutas'),{nombre:nom,cobrador:document.getElementById('r-cob').value,zona:document.getElementById('r-zon').value,color:document.getElementById('r-col').value,createdAt:Date.now()});
    closeModal('m-ruta');toast('Ruta creada','success');}
  catch(e){toast('Error','error');console.error(e);}
};
window.toggleRutaSel=()=>{document.getElementById('u-ruta-wrap').style.display=document.getElementById('u-rol').value==='ruta'?'block':'none';};
window.prepModalUsuario=function(eid){
  document.getElementById('u-rut').innerHTML=STATE.rutas.map(r=>`<option value="${r.id}">${r.nombre}</option>`).join('');
  document.getElementById('modal-user-title').textContent=eid?'Editar usuario':'Nuevo usuario';
  if(eid){const u=STATE.usuarios.find(x=>x.id===eid);document.getElementById('u-nom').value=u.nombre;document.getElementById('u-usr').value=u.user;document.getElementById('u-pas').value=u.pass;document.getElementById('u-rol').value=u.rol;if(u.rutaId)document.getElementById('u-rut').value=u.rutaId;document.getElementById('u-rol').dataset.eid=eid;}
  else{['u-nom','u-usr','u-pas'].forEach(f=>document.getElementById(f).value='');document.getElementById('u-rol').value='ruta';document.getElementById('u-rol').dataset.eid='';}
  window.toggleRutaSel();document.getElementById('m-usuario').style.display='flex';
};
window.editarUsuario=id=>window.prepModalUsuario(id);
window.guardarUsuario=async()=>{
  const nom=document.getElementById('u-nom').value.trim(),usr=document.getElementById('u-usr').value.trim(),pas=document.getElementById('u-pas').value,rol=document.getElementById('u-rol').value,rid=rol==='ruta'?(document.getElementById('u-rut').value||null):null;
  if(!nom||!usr||!pas){toast('Complete todos los campos','error');return;}
  const eid=document.getElementById('u-rol').dataset.eid||'';
  try{if(eid){await updateDoc(doc(db,'usuarios',eid),{nombre:nom,user:usr,pass:pas,rol,rutaId:rid,updatedAt:Date.now()});}
    else{if(STATE.usuarios.find(u=>u.user===usr)){toast('Usuario ya existe','error');return;}await addDoc(collection(db,'usuarios'),{nombre:nom,user:usr,pass:pas,rol,rutaId:rid,createdAt:Date.now()});}
    closeModal('m-usuario');toast('Usuario guardado','success');}
  catch(e){toast('Error','error');console.error(e);}
};

// ── VER DETALLE ───────────────────────────────
window.verCliente=function(id){
  const c=gC(id);if(!c)return;
  const ps=myP().filter(p=>p.clienteId===id),r=gR(c.rutaId);
  const BDG={completado:'badge-green',moroso:'badge-red',atraso:'badge-amber',activo:'badge-blue'};
  const TXT={completado:'Completado',moroso:'Moroso',atraso:'Atraso',activo:'Activo'};
  let ph=ps.map(p=>{const i=pInfo(p);return`<div class="pay-row"><div style="flex:1"><div class="pay-name" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${fm(p.capital)} — ${p.dias} días <span class="badge ${BDG[i.est]}">${TXT[i.est]}</span></div><div class="pay-sub">Desde ${fd(p.fechaInicio)} · Cuota: ${fm(i.c)}/día · Vencidas: ${i.venc.length}</div></div><button class="btn-ver" onclick="verPrestamo('${p.id}')">Cuotas</button></div>`;}).join('');
  document.getElementById('detalle-content').innerHTML=`<h3>${c.nombre}</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:1rem;font-size:13px">
      <div><span style="color:var(--text-muted);font-weight:600">Cédula:</span> ${c.cedula||'—'}</div>
      <div><span style="color:var(--text-muted);font-weight:600">Tel:</span> ${c.tel||'—'}</div>
      <div><span style="color:var(--text-muted);font-weight:600">Ciudad:</span> ${c.ciudad||'—'}</div>
      <div><span style="color:var(--text-muted);font-weight:600">Ruta:</span> ${r?r.nombre:'Sin ruta'}</div>
    </div>
    <h3 style="margin-bottom:8px">Préstamos (${ps.length})</h3>${ph||'<div class="empty">Sin préstamos</div>'}`;
  document.getElementById('m-detalle').style.display='flex';
};
window.verPrestamo=function(id){
  const p=gP(id);if(!p)return;
  const c=gC(p.clienteId),i=pInfo(p),ini=new Date(p.fechaInicio),pagos=p.pagos||{};
  let ph='';
  for(let n=1;n<=p.dias;n++){const d=new Date(ini);d.setDate(d.getDate()+n-1);const iso=d.toISOString().slice(0,10);
    let cls='pay-pend',ico='○';if(pagos[n]){cls='pay-ok';ico='✓';}else if(iso<ISO){cls='pay-venc';ico='!';}else if(iso===ISO){cls='pay-hoy';ico='◉';}
    ph+=`<div class="pay-row"><div class="pay-num ${cls}" style="font-size:11px">${ico}</div>
      <div style="flex:1;min-width:0"><span style="font-size:13px;font-weight:600">Cuota ${n}</span><span style="font-size:11px;color:var(--text-muted);margin-left:6px">${fd(d)}</span></div>
      <div style="font-size:13px;font-weight:700;color:var(--blue-dark)">${fm(i.c)}</div>
      ${!pagos[n]&&iso<=ISO?`<button class="btn-cobrar" onclick="cobrar('${p.id}',${n});verPrestamo('${p.id}')">Cobrar</button>`:pagos[n]?'<span class="badge badge-green" style="font-size:10px">OK</span>':''}
    </div>`;}
  const BDG={completado:'badge-green',moroso:'badge-red',atraso:'badge-amber',activo:'badge-blue'};
  const TXT={completado:'Completado',moroso:'Moroso',atraso:'Atraso',activo:'Activo'};
  document.getElementById('detalle-content').innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:1rem;flex-wrap:wrap;gap:8px">
      <div><h3 style="margin-bottom:4px">${c?.nombre||''}</h3><div class="td-sub">Inicio: ${fd(p.fechaInicio)}</div></div>
      <span class="badge ${BDG[i.est]}">${TXT[i.est]}</span>
    </div>
    <div class="stats-3"><div class="stat-mini"><div class="lbl">Capital</div><div class="val">${fm(p.capital)}</div></div><div class="stat-mini"><div class="lbl">Total</div><div class="val">${fm(i.tot)}</div></div><div class="stat-mini"><div class="lbl">Cuota/día</div><div class="val">${fm(i.c)}</div></div></div>
    <div class="pbar" style="margin-bottom:4px"><div class="pbar-fill" style="width:${i.prog.toFixed(0)}%"></div></div>
    <div class="td-sub" style="margin-bottom:1rem">${i.pag} de ${p.dias} cuotas · ${i.venc.length} vencidas</div>
    <h3 style="margin-bottom:8px">Cuotas</h3><div style="max-height:260px;overflow-y:auto">${ph}</div>`;
  document.getElementById('m-detalle').style.display='flex';
};

// ── EXPORTAR EXCEL ────────────────────────────
window.exportar=function(tipo){
  const XLSX=window.XLSX;let wb=XLSX.utils.book_new(),data=[],tit='';
  if(tipo==='cartera'){tit='RutaCobro_Cartera';data=[['Cliente','Ruta','Capital','Interés%','Total','Cuota/día','Días','Pagados','Vencidas','Saldo','Estado']];
    STATE.prestamos.forEach(p=>{const c=gC(p.clienteId),i=pInfo(p),r=gR(c?.rutaId);data.push([c?.nombre||'',r?.nombre||'',p.capital,p.interes,Math.round(i.tot),Math.round(i.c),p.dias,i.pag,i.venc.length,Math.round((p.dias-i.pag)*i.c),i.est.toUpperCase()]);})}
  else if(tipo==='cobros'){tit='RutaCobro_Cobros_'+ISO;data=[['Ruta','Cliente','Teléfono','Cuota#','Días','Valor','Estado']];
    STATE.prestamos.forEach(p=>{const c=gC(p.clienteId),i=pInfo(p),r=gR(c?.rutaId),ini=new Date(p.fechaInicio),pagos=p.pagos||{};for(let n=1;n<=p.dias;n++){const d=new Date(ini);d.setDate(d.getDate()+n-1);if(d.toISOString().slice(0,10)===ISO)data.push([r?.nombre||'',c?.nombre||'',c?.tel||'',n,p.dias,Math.round(i.c),pagos[n]?'COBRADO':'PENDIENTE']);}})}
  else if(tipo==='morosos'){tit='RutaCobro_Morosos';data=[['Cliente','Cédula','Teléfono','Ruta','Cuotas vencidas','Monto mora']];
    STATE.prestamos.forEach(p=>{const i=pInfo(p);if(!i.venc.length)return;const c=gC(p.clienteId),r=gR(c?.rutaId);data.push([c?.nombre||'',c?.cedula||'',c?.tel||'',r?.nombre||'',i.venc.length,Math.round(i.venc.length*i.c)]);})}
  else if(tipo==='flujo'){tit='RutaCobro_Flujo_'+flujoMesSel;
    data=[['Ruta','Fecha','Ingresos','Gastos','Base/Retiro','Saldo acumulado']];
    STATE.rutas.forEach(ruta=>{
      const cIds=STATE.clientes.filter(c=>c.rutaId===ruta.id).map(c=>c.id);
      const pres=STATE.prestamos.filter(p=>cIds.includes(p.clienteId));
      const ingDia={};pres.forEach(p=>{const i=pInfo(p),ini=new Date(p.fechaInicio),pagos=p.pagos||{};for(let n=1;n<=p.dias;n++){const d=new Date(ini);d.setDate(d.getDate()+n-1);const iso=d.toISOString().slice(0,10);if(iso.slice(0,7)===flujoMesSel&&pagos[n])ingDia[iso]=(ingDia[iso]||0)+i.c;}});
      const gasDia={};STATE.gastos.filter(g=>g.rutaId===ruta.id&&g.fecha&&g.fecha.slice(0,7)===flujoMesSel).forEach(g=>{gasDia[g.fecha]=(gasDia[g.fecha]||0)+(g.monto||0);});
      const baseDia={};STATE.bases.filter(b=>b.rutaId===ruta.id&&b.fecha&&b.fecha.slice(0,7)===flujoMesSel).forEach(b=>{if(b.tipo==='retiro')baseDia[b.fecha]=(baseDia[b.fecha]||0)-(b.monto||0);else baseDia[b.fecha]=(baseDia[b.fecha]||0)+(b.monto||0);});
      const [yr,mo]=flujoMesSel.split('-').map(Number);const ultimo=new Date(yr,mo,0).getDate();
      let saldo=0;for(let d=1;d<=ultimo;d++){const iso=`${flujoMesSel}-${String(d).padStart(2,'0')}`;const ing=ingDia[iso]||0,gas=gasDia[iso]||0,base=baseDia[iso]||0;if(ing||gas||base){saldo+=ing-gas+base;data.push([ruta.nombre,iso,Math.round(ing),Math.round(gas),Math.round(base),Math.round(saldo)]);}}
    });}
  else{tit='RutaCobro_Ganancias';data=[['Mes','Año','Ingresos','Gastos','Ganancia','Margen%']];
    getMeses().forEach(m=>{const ing=getIngresosMes(m),gas=getGastosMes(m),gan=ing-gas;data.push([MESES[parseInt(m.slice(5,7))-1],m.slice(0,4),Math.round(ing),Math.round(gas),Math.round(gan),ing>0?Math.round((gan/ing)*100):0]);});}
  const ws=XLSX.utils.aoa_to_sheet(data);ws['!cols']=data[0].map((_,i)=>({wch:Math.max(...data.map(r=>((r[i]||'')+'').length),10)}));
  XLSX.utils.book_append_sheet(wb,ws,tit.split('_')[1]||tit);XLSX.writeFile(wb,tit+'.xlsx');
  document.getElementById('export-msg').innerHTML=`<div style="background:#E8F5E9;border:1px solid #A5D6A7;border-radius:8px;padding:10px 16px;font-size:13px;color:#1B5E20;font-weight:600">✓ Archivo <strong>${tit}.xlsx</strong> descargado.</div>`;
  setTimeout(()=>{document.getElementById('export-msg').innerHTML='';},4000);
};

// ── INIT ──────────────────────────────────────
buildLoginUsers();
setSyncStatus('connecting');
getDocs(collection(db,'usuarios')).then(snap=>{
  STATE.usuarios=snap.docs.map(d=>({id:d.id,...d.data()}));
  buildLoginUsers();
  if(STATE.usuarios.length===0){
    addDoc(collection(db,'usuarios'),{nombre:'Administrador',user:'admin',pass:'admin123',rol:'admin',rutaId:null,createdAt:Date.now()});
  }
}).catch(()=>setSyncStatus('offline'));
