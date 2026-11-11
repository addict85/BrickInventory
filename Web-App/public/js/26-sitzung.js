// Anmeldung, Abmeldung und der Aufbau der Anwendung danach. Das Modul steht ganz oben im Importgraphen: Es
// darf jede Ansicht starten oder leeren, und keine Ansicht importiert es. Die API-Hülle meldet ein
// Sitzungsende nur als Ereignis; reagiert wird hier.
import { registerActions } from './00-registry.js';
import { html } from './00-escapen.js';
import { abonniere } from './00-ereignisse.js';
import { resetScopeModes } from './14-scope.js';
import { LANG, applyLang, t, setLangValue, tRaw } from '../i18n.js';
import { api, apiRoh, leereZwischenspeicher } from './01-api.js';
import { G, knopfBesetzt, alle, setzeHtml } from './01-dom.js';
import { formularFehler, passwortRegelText } from './01-formular.js';
import { applyTheme, initDefaultCondition, zeigeBenutzernamen, rbHinweisZeigen, _updateLangSelect } from './01-konto.js';
import { toast } from './01-meldungen.js';
import { setAllSets, set_ME, set_settingsCache, set_CURRENCY, ME } from './00-zustand.js';
import { loadGallery, loadStats } from './02-gallery.js';
import { routeBeimStart } from './24-router.js';
import { plInit, resetPartsList, plRenderSets } from './08-init.js';
import { bindGlobalErrorHandlers } from './08-fehlerfang.js';
import { gibCheckOnLoad, gibZuruecksetzen } from './01-fortschritt.js';
import { pruefeEinrichtung } from './22-einrichtung.js';
import { einrichtungKnopfPruefen } from './27-einrichtung-stand.js';
import { initScrollbalken } from './15-scrollbar.js';
import { bindTabs, seitennameAktualisieren } from './25-navigation.js';
import { loadHouseholdMembers } from './02-konten-orte.js';
import { mitZweitemFaktor } from './01-rueckfrage.js';
import { zeigeOffeneAlarme } from './02-detailfelder.js';

/** Startet die Anwendung. Aufruf ausschliesslich aus js/main.js, nach der Auswertung aller Module. */
export function startApp() {
  bindGlobalErrorHandlers();
  bindTabs();
  plRenderSets();
  // Eigener Scrollbalken; der des Browsers ist per CSS ausgeblendet.
  initScrollbalken();
  checkAuth();
}

abonniere('passwortWechselNoetig', () => zeigePflichtwechsel());
abonniere('zweiterFaktorPflicht', () => zeigeZweitpflicht());

/**
 * Ein 401 heisst: Die Sitzung ist nicht mehr gültig. Statt eines Hinweises je Klick über alten Daten geht es
 * zurück zur Anmeldung mit „Sitzung abgelaufen“ — wie in der Android-App.
 */
abonniere('sitzungBeendet', (path) => {
  if (path.startsWith('/v1/auth/me') || path.startsWith('/v1/auth/login')) return;
  if (!ME) return;                       // war nie angemeldet — nichts zu beenden
  set_ME(null);
  showLogin({ abgelaufen: true });
});

// ── AUTH & PANELS ─────────────────────────────────────
/** @type {string | null} */
let _resetToken = null;
/**
 * @type {string}
 */
/** @type {string | null} */
let _verifyToken = null;
let _verifyAngemeldet = false;

/**
 * @param {string} name
 */
function showPanel(name){
  ['login','register','forgot','reset','verify','pflichtwechsel','zweitpflicht'].forEach(p => {
    const el = G('panel-'+p); if(el) el.style.display = p===name?'block':'none';
  });
}

// Mit dem Startpasswort lässt der Server nur den Wechsel zu (403 passwort_wechsel_noetig); die Anwendung käme
// sonst mit lauter Fehlern hoch.

function zeigePflichtwechsel(){
  G('login-screen').style.display='flex'; startgeruestWeg(); G('app').style.display='none';
  showPanel('pflichtwechsel');
  // Das Startpasswort wurde eben getippt und reist aus dem Anmeldefeld mit, statt ein zweites Mal gefragt zu
  // werden. Nach einem Neuladen fehlt es; dann steht das Feld da.
  const eben = G('lp').value;
  G('pflicht-alt').value = eben; G('lp').value = '';
  G('pflicht-alt-zeile').hidden = !!eben;
  G(eben ? 'pflicht-neu' : 'pflicht-alt').focus();
}
// Verwalter ohne zweiten Faktor: Der Server lässt nur dessen Einrichtung zu (403 zweiter_faktor_pflicht);
// js/21-zweiter-faktor.js zeichnet sie in das Feld.
function zeigeZweitpflicht(){
  G('login-screen').style.display='flex'; startgeruestWeg(); G('app').style.display='none';
  showPanel('zweitpflicht');
  document.dispatchEvent(new CustomEvent('zweitpflicht'));
}
function pflichtAbmelden(){ G('btn-logout')?.click(); }
function oeffneApp(){
  if(ME?.mustChangePassword) zeigePflichtwechsel();
  else if(ME?.zweiterFaktorPflicht) zeigeZweitpflicht();
  else showApp();
}
G('btn-pflicht')?.addEventListener('click', async () => {
  const alt=G('pflicht-alt').value, neu=G('pflicht-neu').value, err=G('pflicht-err');
  formularFehler(err, '');
  const regel = passwortRegelText(neu);
  if(regel){ formularFehler(err, regel, ['pflicht-neu']); return; }
  if(neu!==G('pflicht-wdh').value){ formularFehler(err, tRaw('settings.password.mismatch'), ['pflicht-wdh']); return; }
  const d=await mitZweitemFaktor(z => api('POST','/v1/auth/change-password',{ current: alt, newPassword: neu, ...z }));
  if(!d) return;
  if(!d.success){
    // Stimmt das mitgenommene Passwort nicht, muss das Feld wieder her.
    const altFalsch = d.code==='aktuelles_passwort_falsch';
    if(altFalsch) G('pflicht-alt-zeile').hidden=false;
    formularFehler(err, d.error||tRaw('settings.error'), [altFalsch?'pflicht-alt':'pflicht-neu']); return; }
  location.reload();
});

// Check URL params on load
(function(){
  const params = new URLSearchParams(location.search);
  // Der Link aus der Mail bestätigt nichts von selbst; erst der Knopf (POST).
  if(params.get('token') && location.pathname === '/verify'){
    _verifyToken = params.get('token');
    showPanel('verify');
  } else if(params.get('token') && (location.pathname.includes('reset-password') || params.get('type') === 'reset')){
    _resetToken = params.get('token');
    showPanel('reset');
  }
  // Clean URL
  if(params.has('token')) history.replaceState({},'',location.pathname);
})();

// Panel links
G('link-register')?.addEventListener('click', e=>{ e.preventDefault(); showPanel('register'); const rl=G('reg-lang'); if(rl && (LANG==='de'||LANG==='en')) rl.value=LANG; });
G('link-forgot')?.addEventListener('click', e=>{ e.preventDefault(); showPanel('forgot'); });
G('link-to-login')?.addEventListener('click', e=>{ e.preventDefault(); showPanel('login'); });
G('link-forgot-to-login')?.addEventListener('click', e=>{ e.preventDefault(); showPanel('login'); });

// Register
G('btn-register')?.addEventListener('click', async () => {
  const u=G('reg-user').value.trim(), e=G('reg-email').value.trim();
  const p=G('reg-pass').value, p2=G('reg-pass2').value;
  const err=G('reg-err');
  formularFehler(err, '');
  if(!u||!e||!p){ formularFehler(err, tRaw('register.req_fields'), [!u&&'reg-user', !e&&'reg-email', !p&&'reg-pass'].filter(x => typeof x === 'string')); return; }
  // Reihenfolge: zu kurz VOR ungleich — dieselbe wie in der App (LoginScreen.kt). Deren Kommentar behauptete
  // schon vorher „dieselben drei Pruefungen wie im Web-Formular, und in derselben Reihenfolge"; wahr war
  // daran bis hierher weder das eine noch das andere, weil die Webapp die Laenge gar nicht prueft.
  const regel = passwortRegelText(p);
  if (regel) { formularFehler(err, regel, ['reg-pass']); return; }
  if(p!==p2){ formularFehler(err, tRaw('settings.password.mismatch'), ['reg-pass2']); return; }
  const btn=G('btn-register'); const frei=knopfBesetzt(btn);
  const d=await api('POST','/v1/auth/register',{
    username:u, email:e, first_name:G('reg-first').value.trim()||null,
    last_name:G('reg-last').value.trim()||null, password:p,
    language: G('reg-lang')?.value || LANG || 'de'
  });
  frei();
  if(d.success){
    G('reg-form').style.display='none';
    G('reg-success').style.display='block';
    G('reg-success').textContent = tRaw(d.email_sent === false ? 'register.nicht_gesendet' : 'register.gesendet');
  } else { formularFehler(err, d.error||tRaw('settings.error')); }
});

// Forgot password
G('btn-forgot')?.addEventListener('click', async () => {
  const email=G('forgot-email').value.trim();
  const err=G('forgot-err');
  formularFehler(err, '');
  if(!email){ formularFehler(err, tRaw('register.email_required'), ['forgot-email']); return; }
  const btn=G('btn-forgot'); const frei=knopfBesetzt(btn);
  const d=await api('POST','/v1/auth/forgot-password',{email});
  frei();
  if(d && d.success===false){ formularFehler(err, d.error||tRaw('common.network_error'), ['forgot-email']); return; }
  G('forgot-form').style.display='none';
  G('forgot-success').style.display='block';
  G('forgot-success').textContent = d.message || 'Falls die E-Mail existiert, wurde ein Link gesendet.';
});
G('btn-verify')?.addEventListener('click', async () => {
  const err=G('verify-err'), btn=G('btn-verify');
  formularFehler(err, '');
  btn.disabled=true;
  const d=await api('POST','/v1/auth/email-bestaetigen',{token:_verifyToken});
  btn.disabled=false;
  if(!d.success){ formularFehler(err, d.error||tRaw('settings.error')); return; }
  _verifyToken=null;
  if(_verifyAngemeldet){ await bestaetigtAngemeldet(); return; }
  history.replaceState({},'','/');
  showPanel('login');
  const m=G('verified-msg'); if(m) m.style.display='block';
});
G('link-verify-to-login')?.addEventListener('click', e=>{
  e.preventDefault();
  if(_verifyAngemeldet){ location.replace('/'); return; }
  _verifyToken=null; showPanel('login');
});


// Reset password
G('btn-reset')?.addEventListener('click', async () => {
  const p=G('reset-pass').value, p2=G('reset-pass2').value;
  const err=G('reset-err');
  formularFehler(err, '');
  if(!p||p!==p2){ formularFehler(err, tRaw('settings.password.mismatch'), [p ? 'reset-pass2' : 'reset-pass']); return; }
  const regel = passwortRegelText(p);
  if (regel) { formularFehler(err, regel, ['reset-pass']); return; }
  if(!_resetToken){ formularFehler(err, tRaw('reset.invalid_token')); return; }
  const btn=G('btn-reset'); btn.disabled=true; btn.textContent=tRaw('reset.saving');
  const d=await api('POST','/v1/auth/reset-password',{token:_resetToken,password:p});
  btn.disabled=false; btn.textContent=tRaw('reset.button');
  if(d.success){
    G('reset-form').style.display='none';
    G('reset-success').style.display='block';
    G('reset-success').textContent=tRaw('reset.done');
    setTimeout(()=>showPanel('login'),2000);
  } else { formularFehler(err, d.error||tRaw('settings.error')); }
});

// ── AUTH ──────────────────────────────────────────────


export async function checkAuth(){
  // Sprache (aus localStorage oder Browser-Sprache) sofort anwenden, damit auch der Login-/Registrierungs-
  // und Startup-Screen VOR dem Login übersetzt sind (bisher lief applyLang erst nach dem Login in showApp).
  applyLang(LANG, false);
  await waitForStartup();
  const d=await api('GET','/v1/auth/me');
  // Die Anmeldemaske ist schon bedienbar, während diese Frage läuft. Wer sich inzwischen angemeldet hat,
  // bekäme sonst von der späten Antwort „nein“ die Maske zurück, obwohl die Sitzung gilt.
  if(ME) return;
  // Der Nutzer steht unter `user` mit `is_admin`, wie in der Login-Antwort; ME behält isAdmin, id und
  // username. Auch angemeldet (neue Adresse im Profil) wird erst bestätigt, dann öffnet die Anwendung.
  _verifyAngemeldet = !!d.loggedIn;
  if(_verifyToken) zeigeBestaetigungsziel(!!d.loggedIn);
  // Angemeldet heisst: `user` ist da; der Vertrag lässt es offen, weil /auth/me auch abgemeldet antwortet.
  if(d.loggedIn && !_verifyToken){ set_ME(/** @type {import('./00-zustand.js').Konto} */ ({ ...d, ...(d.user||{}), isAdmin: d.user?.is_admin === true })); oeffneApp(); }
  else {
    G('login-screen').style.display='flex'; startgeruestWeg();
    G('app').style.display='none';
    // Don't override reset/verified panels that were already set from URL params
    if(!_resetToken && !_verifyToken && !G('verified-msg')?.style.display.includes('block')){
      showPanel('login');
    }
    checkRegistrationEnabled();
  }
}
/**
 * Vor dem Einlösen nennt der Server das Konto des Links, und der Knopf nennt es noch einmal: Wer von zwei
 * gleichen Mails die eines fremden Kontos öffnet, sieht dessen Namen, bevor er dessen Adresse bestätigt.
 * @param {boolean} angemeldet
 */
async function zeigeBestaetigungsziel(angemeldet) {
  const el = G('verify-ziel'), btn = G('btn-verify');
  if (!el || !btn) return;
  btn.disabled = true;
  const v = await api('POST', '/v1/auth/email-bestaetigen/vorschau', { token: _verifyToken });
  const p = angemeldet ? await api('GET', '/v1/auth/profile') : null;
  const u = p?.success ? p.user : null;
  if (!v?.success) {
    formularFehler(G('verify-err'), v?.error || tRaw('settings.error'));
    // Angemeldet trotzdem sagen, was für das eigene Konto wartet; bestätigen lässt sich der Link nicht.
    if (u) { el.textContent = u.email_neu ? tRaw('verify.ausstehend', { email: u.email_neu, konto: u.username })
      : tRaw('verify.nichts_ausstehend', { konto: u.username }); bestaetigungAngemeldet(u.email_neu); }
    return;
  }
  el.textContent = u && u.username !== v.username ? tRaw('verify.fremdes_konto', { konto: v.username, ich: u.username })
    : u?.email_neu ? tRaw('verify.ausstehend', { email: u.email_neu, konto: u.username })
    : tRaw('verify.konto', { konto: v.username });
  btn.removeAttribute('data-i18n');
  btn.textContent = tRaw('verify.button_konto', { konto: v.username });
  btn.disabled = false;
  if (u) bestaetigungAngemeldet(u.email_neu);
}
/**
 * Angemeldet führt die Seite zurück in die Sammlung; wartet nichts, ist „Bestätigen“ nicht mehr der
 * nahegelegte Schritt.
 * @type {string | null}
 */
let _verifyEmail = null;
/**
 * @param {string | null | undefined} email
 */
function bestaetigungAngemeldet(email) {
  _verifyEmail = email || null;
  const zurueck = G('link-verify-to-login');
  if (zurueck) { zurueck.textContent = tRaw('verify.zur_sammlung'); zurueck.removeAttribute('data-i18n'); }
  G('btn-verify')?.classList.toggle('bp', !!email);
  G('btn-verify')?.classList.toggle('bs', !email);
}
/** Ohne Neuladen in die App, damit die Rückmeldung stehen bleibt. */
async function bestaetigtAngemeldet() {
  history.replaceState({}, '', '/');
  await checkAuth();
  toast(_verifyEmail ? tRaw('verify.bestaetigt', { email: _verifyEmail }) : tRaw('verify.bestaetigt_kurz'), 'success');
}
/** Das statische Startgerüst aus index.html weicht, sobald Anmeldung, App oder Startfortschritt dastehen. */
function startgeruestWeg() { G('startgeruest')?.remove(); }

async function waitForStartup() {
  const ss = G('startup-screen');
  // Kein hartes Gesamt-Timeout mehr: Download/Import der Rebrickable-CSVs kann bei einer Neuinstallation
  // viele Minuten dauern. Stattdessen nur abbrechen, wenn sich der Fortschritt über längere Zeit gar nicht
  // mehr ändert (Server hängt) — solange Fortschritt gemeldet wird, wird weiter gewartet.
  const STALL_TIMEOUT = 180000; // 3 Min ohne jede Statusänderung → aufgeben
  let lastChangeAt = Date.now();
  let lastSig = '';
  // Antwortet der Server gar nicht, stand vorher nur das graue Gerüst da, beliebig lange. Nach sechs Sekunden
  // sagt es die Seite und bietet einen sofortigen Versuch an; der Abruf läuft ohnehin weiter.
  let fehlerSeit = 0;
  /** @type {() => void} */
  let sofort = () => {};
  const knopf = G('start-erneut');
  if (knopf) knopf.onclick = () => sofort();
  while (true) {
    try {
      const r = await apiRoh('GET', '/v1/startup-status?_=' + Date.now(), {
        cache: 'no-store', headers: { 'Cache-Control': 'no-cache' }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const s = await r.json();
      fehlerSeit = 0;
      zeigeOffline(false);
      if (!s) { await new Promise(r=>setTimeout(r,600)); continue; }
      const pct = s.total > 0 ? Math.round(s.progress / s.total * 100) : 0;
      const stepEl = G('startup-step');
      const barEl  = G('startup-bar');
      const pctEl  = G('startup-pct');
      if (stepEl) stepEl.textContent = s.step || t('startup.loading');
      if (barEl)  barEl.style.width  = pct + '%';
      if (pctEl)  pctEl.textContent  = pct + '%';
      const subVal   = s.sub || '';
      const subWrap  = G('startup-sub-wrap');
      const subLabel = G('startup-sub-label');
      const subBar   = G('startup-sub-bar');
      const subPctEl = G('startup-sub-pct');
      const subEl    = G('startup-sub');
      if (subVal && subWrap) {
        subWrap.style.display = '';
        if (subLabel) subLabel.style.display = '';
        const subPct = subVal.match(/(\d+)%/);
        if (subPct) {
          if (subBar)   subBar.style.width  = subPct[1] + '%';
          if (subPctEl) subPctEl.textContent = subPct[1] + '%';
          if (subEl)    subEl.textContent    = s.step || '';
        } else {
          if (subBar)   subBar.style.width  = '0%';
          if (subPctEl) subPctEl.textContent = subVal;
          if (subEl)    subEl.textContent    = s.step || '';
        }
      } else if (subWrap) {
        subWrap.style.display = 'none';
        if (subLabel) subLabel.style.display = 'none';
      }
      // Fortschritt erkennen: ändert sich Schritt, Prozent oder Sub-Status, gilt der Startvorgang als aktiv
      // und der Stall-Timer wird zurückgesetzt.
      const sig = `${s.step}|${s.progress}|${s.total}|${s.sub || ''}`;
      if (sig !== lastSig) { lastSig = sig; lastChangeAt = Date.now(); }
      if (s.ready) break;
      // Den Fortschritt erst zeigen, wenn der Server wirklich noch startet.
      if (ss && ss.style.display !== 'flex') { startgeruestWeg(); ss.style.display = 'flex'; }
      if (Date.now() - lastChangeAt > STALL_TIMEOUT) { console.warn('[startup] stalled — no progress'); break; }
    } catch(e) {
      console.warn('[startup] poll error:', e instanceof Error ? e.message : e);
      fehlerSeit ||= Date.now();
      if (Date.now() - fehlerSeit >= 6000) zeigeOffline(true);
    }
    await new Promise(r => { sofort = () => r(undefined); setTimeout(r, fehlerSeit ? 2000 : 600); });
  }
  zeigeOffline(false);
  if (ss) ss.style.display = 'none';
}
/** @param {boolean} an */
function zeigeOffline(an) {
  const el = G('start-offline');
  if (el && el.hidden === an) el.hidden = !an;
}
/**
 * @param {{ abgelaufen?: boolean }} [o] abgelaufen: Der Name bleibt stehen, damit
 *   man sich gleich wieder anmelden kann; Passwort und Code nie — sonst genügt
 *   dem Nächsten am Gerät ein Druck auf „Anmelden“.
 */
function showLogin(o = {}){
  G('lp').value = ''; G('lc').value = ''; G('lc-zeile').style.display = 'none';
  // Ein angezeigtes Passwort bleibt nicht für die nächste Anmeldung sichtbar.
  if (G('lp').type !== 'password') {
    G('lp').type = 'password';
    const k = document.querySelector('[data-click="geheimUmschalten"][data-arg="lp"]');
    k?.setAttribute('aria-pressed', 'false'); k?.querySelector('use')?.setAttribute('href', '#i-auge');
  }
  if (!o.abgelaufen) G('lu').value = '';
  const hinweis = G('login-hinweis');
  if (hinweis) { hinweis.hidden = !o.abgelaufen; hinweis.textContent = o.abgelaufen ? tRaw('auth.session_expired') : ''; }
  formularFehler(G('lerr'), '');
  // Der Fortschrittsbalken gehört js/01-fortschritt.js — dort steht auch, was „zurücksetzen“ für ihn bedeutet
  // (Anzeige aus, beide Abfragen gestoppt, Protokoll geleert). Hier stand früher sein Innenleben
  // ausgeschrieben.
  gibZuruecksetzen();
  sessionStorage.removeItem('webToken');
  leereZwischenspeicher();
  // Clear sensitive data from all tabs before hiding Das Diagramm nur leeren, nicht seinen Abschnitt: Der
  // trägt Kopf und Zeitraumwahl, die nach der nächsten Anmeldung sonst fehlten.
  ['fin-tbl','portfolio-chart','portfolio-pnl','gallery-grid','parts-main','monitor-content'].forEach(id=>{
    const el=G(id); if(el) el.replaceChildren();
  });
  setAllSets([]);
  resetPartsList();
  // Clear partslist DOM so it doesn't persist after re-login
  const plResult=G('pl-result'); if(plResult) plResult.replaceChildren();
  const plSetsEl=G('pl-sets'); if(plSetsEl) plSetsEl.replaceChildren();
  const plStatus=G('pl-status'); if(plStatus) plStatus.textContent='';
  ['btn-pl-pdf','btn-pl-bl','pl-bl-condition','pl-bestand-zeile'].forEach(id=>{const el=G(id);if(el)el.style.display='none';});
  G('login-screen').style.display='flex'; startgeruestWeg();
  G('app').style.display='none';
  showPanel('login');
  checkRegistrationEnabled();
}
/** Zähler der Abfragen nach den Anmeldewegen. Abmelden und abgelaufene Sitzung
 * fragen beide; kommt die ältere Antwort zuletzt an, gilt sie nicht mehr. */
let _anmeldewegeLauf = 0;
async function checkRegistrationEnabled(){
  // Derselbe Anlass wie die Anmeldewege: Wer die Anmeldeseite zeigt, soll wissen, ob die
  // Ersteinrichtung noch offen ist — beim Start wie nach dem Abmelden.
  einrichtungKnopfPruefen();
  const lauf = ++_anmeldewegeLauf;
  // Steht erst wieder, wenn die jüngste Antwort eingetragen ist (Browser-Tests warten darauf).
  delete G('login-screen').dataset.anmeldewege;
  try {
    const d = await api('GET', '/v1/auth/registration-status');
    if (lauf !== _anmeldewegeLauf || d.success === false) return;
    const wrap = G('link-register-wrap');
    if(wrap) wrap.style.display = d.enabled ? '' : 'none';
    // Nur Wege anbieten, die der Server kann; fehlt die Angabe (älterer Server), bleibt alles wie es war.
    if (d.passkey === false && G('btn-passkey')) G('btn-passkey').hidden = true;
    if (G('link-forgot')) G('link-forgot').hidden = d.passwort_vergessen === false;
    if (G('forgot-verwalter')) G('forgot-verwalter').hidden = d.passwort_vergessen !== false;
    G('login-screen').dataset.anmeldewege = 'geladen';
  } catch(_){}
}




function showApp(){ bindTabs(); plInit(); setTimeout(()=>{ gibCheckOnLoad(); }, 1000);
  G('login-screen').style.display='none'; G('app').style.display='block'; startgeruestWeg();
  zeigeBenutzernamen();
  initDefaultCondition();
  // Kontoauswahl beim Erfassen — bleibt verborgen, wenn es nichts zu wählen gibt.
  loadHouseholdMembers();
  // Ausgeloeste Preisalarme seit dem letzten Besuch — das Gegenstueck zum stuendlichen Abruf der Android-App.
  zeigeOffeneAlarme();
  // Einrichtungs-Assistent für eine frische Installation (nur Verwalter).
  if (ME?.isAdmin) pruefeEinrichtung();
  // ?set=<nummer> öffnet das Set direkt (Knopf der Preisalarm-Mail). Hier und nicht beim Laden, weil erst
  // hier eine Sitzung besteht. Geöffnet wird über die Adresse #/set/…: routeBeimStart() unten schliesst jeden
  // Dialog, den die Adresse nicht nennt. Der Parameter fällt weg, damit F5 nicht erneut einen Link einlöst.
  const setAusLink = new URLSearchParams(location.search).get('set');
  if (setAusLink) history.replaceState({}, '', `${location.pathname}#/set/${encodeURIComponent(setAusLink)}`);
  // Apply saved language immediately (from localStorage) so static elements translate before server responds
  setLangValue(localStorage.getItem('bim_lang') || LANG);
  applyLang(LANG, false);
  // Load settings — also picks up server-stored language preference
  const einstellungen = api('GET','/v1/settings/raw').then(d=>{
    if(d.success&&d.settings){
      set_settingsCache(d.settings);
      set_CURRENCY(d.settings.currency||'EUR');
      applyTheme(d.settings.app_theme);
      // Die Sprache des Servers gewinnt (ausdrückliche Wahl); localStorage mitziehen
      const srvLang = d.settings.language;
      // Auch eine noch nicht geladene Sprache: applyLang lädt sie nach.
      if (srvLang === 'de' || srvLang === 'en') {
        if (srvLang !== LANG) applyLang(srvLang, false);
        localStorage.setItem('bim_lang', srvLang);
      }
    }
    _updateLangSelect();
  });
  // Der Reiter „Einstellungen" traegt seit dem 16.10. nur noch, was ein Verwalter setzt (Marcos Vorgabe) — er
  // wird deshalb wie das Monitoring erst hier eingeblendet. Fuer alle anderen waere er leer, und ein leerer
  // Reiter ist schlimmer als keiner: Man klickt ihn an und sucht.
  if(ME?.isAdmin){ const ns=G('ntab-settings'); if(ns) ns.style.display=''; }
  if(ME?.isAdmin){ alle('.admin-only').forEach(el=>{ el.style.display=''; }); const nm=G('ntab-monitor'); if(nm){ nm.style.display=''; const lbl=nm.querySelector('.tab-label'); if(lbl) lbl.textContent=tRaw('nav.monitoring'); } G('usermgmt').style.display='block'; ['bl-ao','rb-ao','bs-ao'].forEach(id=>{ const el=G(id); if(el) el.style.display='none'; }); const gg=G('global-settings-grid'); if(gg) gg.style.display='grid'; const gl=G('global-settings-label'); if(gl) gl.style.display='block'; }
  else { ['bl-ck','bl-cs','bl-tok','bl-ts','rb-key','bs-key','lim-rb','lim-bl','lim-bs'].forEach(id=>{const el=G(id);if(el){el.disabled=true;if(el.type!=='number')el.placeholder=tRaw('settings.admins_only_ph')}}); G('btn-sav-bl').disabled=true; G('btn-sav-rb').disabled=true; G('btn-sav-bs').disabled=true; }
  // Ohne Rebrickable-Schlüssel öffnet trotzdem die Sammlung: Ein Sprung in die Einstellungen bei jeder
  // Anmeldung nimmt dem Verwalter seine Startseite. Ein Band weist einmal je Sitzung darauf hin. Erst die
  // Einstellungen, dann Beträge: Sonst stünden die Preise kurz in der Vorgabewährung und sprängen dann um
  // (UI-Prüfung 6, N12).
  einstellungen.catch(() => {}).finally(() => {
    if (ME?.isAdmin) rbHinweisZeigen();
    loadGallery();
    loadStats();
  });
  routeBeimStart();
  seitennameAktualisieren();
}
G('btn-login').onclick=doLogin;
for (const id of ['lu','lp','lc']) G(id).addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); doLogin(); } });
async function doLogin(){
  const b=G('btn-login'); const frei=knopfBesetzt(b);
  const code=G('lc').value.trim();
  const d=await api('POST','/v1/auth/login',{username:G('lu').value,password:G('lp').value,ohne_token:true,...(code?{code}:{})});
  frei();
  // Zweiter Faktor verlangt: Codefeld zeigen und dort weitermachen.
  if(d.zweiter_faktor){
    G('lc-zeile').style.display=''; G('lc').value=''; G('lc').focus();
    // Hat das Konto Passkeys, geht einer statt des Codes (js/23-passkeys.js).
    G('lc-passkey').hidden=!d.passkey;
    formularFehler(G('lerr'), code ? (d.error||'') : '', code ? ['lc'] : []);
    return;
  }
  G('lc-zeile').style.display='none'; G('lc').value='';
  if(d.success){ set_ME(/** @type {import('./00-zustand.js').Konto} */ ({ ...d, ...(d.user||{}), isAdmin: d.user?.is_admin === true }));
    // Jede Anmeldung beginnt mit „Alle Konten" — VOR showApp(), damit die Auswahlfelder gleich mit dem
    // zurückgesetzten Wert entstehen.
    resetScopeModes();
    formularFehler(G('lerr'), ''); G('login-hinweis').hidden = true;
    oeffneApp(); } else { const err=d.error||tRaw('settings.error');
    // Fokus ins erste leere Feld; sind beide gefüllt, stimmt meist das Passwort nicht.
    const leer=['lu','lp'].filter(id=>!G(id).value);
    formularFehler(G('lerr'), err, leer.length ? leer : ['lp','lu']); if(d.unverified||d.code==='email_nicht_bestaetigt'){ setzeHtml(G('lerr'), html`${err}${html` <a href="#" data-click="bestaetigungErneut" data-stil="color:var(--b600)">`}${tRaw('auth.resend_mail')}${html`</a>`}`); } }
}
G('btn-logout').onclick=async()=>{
  // Ein Token aus einer älteren Anmeldung wird mit entwertet.
  const _wt = sessionStorage.getItem('webToken');
  // Zuerst abgemeldet: Laufende Anfragen, die jetzt mit 401 enden, melden kein „Sitzung abgelaufen“ und
  // öffnen die Anmeldemaske kein zweites Mal.
  set_ME(null);
  await apiRoh('POST', '/v1/auth/logout', {
    headers: _wt ? { 'Authorization': 'Bearer ' + _wt } : {},
  }).catch(()=>{});
  setAllSets([]);
  // Reset all admin-only elements before showing login
  const nm=G('ntab-monitor'); if(nm) nm.style.display='none';
  const ns=G('ntab-settings'); if(ns) ns.style.display='none';
  // Auch die Verwaltereinträge im Menü: Meldet sich danach ein anderes Konto an, stünden sie sonst noch da.
  alle('.admin-only').forEach(el=>{ el.style.display='none'; });
  G('usermgmt').style.display='none';

  ['bl-ao','rb-ao','bs-ao'].forEach(id=>{ const el=G(id); if(el) el.style.display=''; });
  const gg=G('global-settings-grid'); if(gg) gg.style.display='none';
  const gl=G('global-settings-label'); if(gl) gl.style.display='none';
  // Switch back to gallery tab manually
  document.querySelectorAll('.ntab').forEach(x=>{ x.classList.remove('active'); });
  document.querySelectorAll('.tab').forEach(x=>{ x.classList.remove('active'); });
  const gt=document.querySelector('.ntab[data-tab="gallery"]');
  if(gt){gt.classList.add('active');const gp=document.getElementById('tab-gallery');if(gp)gp.classList.add('active');}
  showLogin();
};


// Ohne Auskunft über das Konto: Der Server antwortet für jede Adresse gleich.
async function bestaetigungErneut(){
  const email=G('lu').value.trim();
  if(!email.includes('@')){ toast(tRaw('auth.resend_need_email'),'info'); G('lu').focus(); return; }
  const d=await api('POST','/v1/auth/bestaetigung-erneut',{email});
  toast(d.message||d.error||tRaw('settings.error'), d.success?'success':'error');
}
/**
 * Leerzustände führen zum Feld, in das der erste Eintrag gehört.
 * @param {string} id
 */
function feldFokussieren(id) {
  const f = G(id); const klappe = f?.closest('details'); if (klappe) klappe.open = true;
  f?.scrollIntoView({ block: 'center' }); f?.focus();
}


registerActions({
  showPanel,
  bestaetigungErneut,
  feldFokussieren,
  pflichtAbmelden,
});


