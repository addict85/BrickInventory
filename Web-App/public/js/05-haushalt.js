import { echt, registerActions } from './00-registry.js';
import { t, tRaw } from '../i18n.js';
import { api } from './01-api.js';
import { G, setzeHtml } from './01-dom.js';
import { toast } from './01-meldungen.js';
import { esc, html, ungeprueft } from './00-escapen.js';
import { confirmDelete, bestaetigeMitPasswort, mitZweitemFaktor } from './01-rueckfrage.js';
// Einstellungen, Abschnitt Haushalt: Einladen, Beitreten, Trennen. Ein Konto sieht danach die
// Bestände der verknüpften Konten; die Regeln dazu stehen im Server (src/haushalt).

// ═══════════════════════════════════════════════════════════════════════════
// HAUSHALT — Konten verknüpfen
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Einladen und Beitreten brauchen beide Seiten: das Hauptkonto erzeugt, das andere löst ein. Je nach
 * Rolle steht nur einer der Kästen da — ein Knopf, den der Server immer ablehnt, ist schlimmer als
 * keiner.
 * Ausführlich: docs/begruendungen/public/js/05-haushalt.js.md#loadhousehold
 */
export async function loadHousehold(){
  const [d, zf] = await Promise.all([api('GET','/v1/settings/household').catch(()=>null),
                                     api('GET','/v1/auth/zweiter-faktor').catch(()=>null)]);
  if(!d?.success) return;
  renderHousehold(d);
  // Mit zweitem Faktor verlangt der Server beim Einlösen auch den Code.
  const faktor = G('household-redeem-faktor');
  if(faktor) faktor.style.display = zf?.aktiv ? '' : 'none';
}

/**
 * Die Haushaltskarte: Elternkonten und Unterkonten sind zwei unabhängige
 * Abschnitte, weil ein Konto beides zugleich sein kann. Darunter der Hinweis
 * auf Konten, die nur über eine Kette sichtbar waren und es nicht mehr sind.
 * @param {import('../../frontend-typen/vertrag').HouseholdStatusResponse} d
 */
function renderHousehold(d){
  const stateEl  = G('household-state');
  const inviteEl = G('household-invite-box');
  const redeemEl = G('household-redeem-box');
  if(!stateEl) return;

  // Ein Raster auf der Liste, die Zeilen als display:contents: So stehen alle
  // Namen und alle Knöpfe in denselben zwei Spalten.
  // Namen und alle Knöpfe in denselben zwei Spalten; das Sinnbild macht die Namen als Konten kenntlich.
  const liste = (/** @type {{ id: number, username?: string | null, via?: string | null }[]} */ eintraege, /** @type {(a: { id: number, username?: string | null, via?: string | null }) => string} */ aktion) => html`<ul class="haushalt-liste">${eintraege.map(a => html`<li data-stil="display:contents">
      <span class="haushalt-name"><svg class="ico" aria-hidden="true"><use href="#i-profil"/></svg>${a.username}</span>
      <span class="haushalt-aktion">${ungeprueft(aktion(a))}</span>
    </li>`)}</ul>`;

  const teile = [];
  const eltern = d.parents || (d.linked_to ? [d.linked_to] : []);
  if(eltern.length){
    teile.push(html`<div>${tRaw('household.state_parents', { n: eltern.length })}${liste(eltern,
      a => `<button class="btn bs btn-sm" data-click="unlinkFromParent"${echt()} data-arg="${a.id}" data-arg2="${esc(a.username || '')}">${t('household.unlink_self')}</button>`)}</div>`);
  }
  if(d.sub_accounts?.length){
    teile.push(html`${eltern.length ? html`<div data-stil="margin-top:.6rem">` : html`<div>`}${tRaw('household.state_main', { n: d.sub_accounts.length })}${liste(d.sub_accounts,
      a => `<button class="btn bs btn-sm" data-click="unlinkHousehold"${echt()} data-arg="${a.id}" data-arg2="${esc(a.username || '')}">${t('household.unlink_sub')}</button>`)}</div>`);
  }
  if(!teile.length){
    teile.push(html`<div data-stil="color:var(--mut)">${tRaw('household.state_none', { cur: esc(d.currency||'') })}</div>`);
  }
  if(d.former_links?.length){
    teile.push(html`<div role="note" data-stil="margin-top:.8rem;padding:.6rem .8rem;border-radius:8px;background:var(--b100);color:var(--b600)">
      ${tRaw('household.former_intro')}${liste(d.former_links,
        a => `<span data-stil="color:var(--mut)">${a.via ? t('household.former_via', { via: esc(a.via) }) : ''}</span>
              <button class="btn bs btn-sm" data-click="dismissFormerLink" data-arg="${a.id}">${t('household.former_dismiss')}</button>`)}
    </div>`);
  }
  setzeHtml(stateEl, ungeprueft(teile.join('')));

  // Einladen und Einlösen darf jedes Konto: Ein Konto kann mehrere
  // Elternkonten haben, und jedes braucht seine eigene Einladung.
  if(inviteEl) inviteEl.style.display = '';
  if(redeemEl) redeemEl.style.display = '';
}

export async function createHouseholdInvite(){
  const d = await api('POST','/v1/settings/household/invite',{});
  if(!d.success){ toast(d.error || t('settings.error'),'error'); return; }
  const out = G('household-invite-out');
  G('household-invite-code').value = d.code ?? '';
  if(out) out.style.display = '';
  toast(tRaw('household.invite_created'),'success');
}

export async function copyHouseholdInvite(){
  const el = G('household-invite-code');
  if(!el?.value) return;
  // Zwischenablage kann fehlschlagen (kein HTTPS, Berechtigung verweigert) —
  // dann markieren statt die Aktion still verpuffen zu lassen.
  try {
    await navigator.clipboard.writeText(el.value);
    toast(tRaw('household.invite_copied'),'success');
  } catch(_) {
    el.select();
    toast(tRaw('household.invite_copy_manual'),'info');
  }
}

export async function redeemHouseholdInvite(){
  const code = (G('household-redeem-code')?.value || '').trim();
  if(!code){ toast(tRaw('household.redeem_empty'),'error'); return; }
  // Erst den Code auflösen: Wer zustimmt, soll wissen, wem er Zugriff gibt.
  const p = await api('POST','/v1/settings/household/redeem/pruefen',{ code });
  if(!p.success){ toast(p.error || t('settings.error'),'error'); return; }
  const name = p.inviter.username;
  // Das Hauptkonto sieht und ändert danach die eigene Sammlung — deshalb mit Passwort.
  const password = await bestaetigeMitPasswort(tRaw('household.redeem_frage', { name }), tRaw('household.redeem_confirm_text', { name }), 'link', { knopf: 'confirm.btn.einladung_annehmen', art: 'bp' });
  if(password === null) return;
  const faktor_code = (G('household-redeem-faktor-code')?.value || '').trim();
  const d = await mitZweitemFaktor(z => api('POST','/v1/settings/household/redeem',
    { code, password, ...(z.code || faktor_code ? { faktor_code: z.code || faktor_code } : {}), ...(z.passkey ? { passkey: z.passkey } : {}) }));
  if(d === null) return;
  if(!d.success){ toast(d.error || t('settings.error'),'error'); return; }
  G('household-redeem-code').value = '';
  if(G('household-redeem-faktor-code')) G('household-redeem-faktor-code').value = '';
  // tRaw + roher Name: Der Toast setzt Text, keine HTML — mit esc() stünde
  // dort "Marco &amp; Co" statt "Marco & Co".
  const verknuepft = /** @type {{ linked_to?: { username?: string } }} */ (d).linked_to;
  toast(tRaw('household.redeem_ok', { name: verknuepft?.username || '' }),'success');
  loadHousehold();
}

/**
 * @param {string} mainUserId
 * @param {string} name
 */
export async function unlinkFromParent(mainUserId, name){
  if(!await confirmDelete(tRaw('household.unlink_confirm_title', { name }), tRaw('household.unlink_confirm_text_eltern', { name }), 'link', { knopf: 'confirm.btn.verknuepfung_loesen', art: 'bp' })) return;
  const d = await api('POST','/v1/settings/household/unlink', { main_user_id: parseInt(mainUserId) });
  if(!d.success){ toast(d.error || t('settings.error'),'error'); return; }
  toast(tRaw('household.unlink_ok'),'success');
  loadHousehold();
}

/**
 * @param {string} subUserId
 */
export async function dismissFormerLink(subUserId){
  const d = await api('POST','/v1/settings/household/former/dismiss', { sub_user_id: parseInt(subUserId) });
  if(!d.success){ toast(d.error || t('settings.error'),'error'); return; }
  loadHousehold();
}

/**
 * @param {string} subUserId
 * @param {string} name
 */
export async function unlinkHousehold(subUserId, name){
  if(!await confirmDelete(tRaw('household.unlink_confirm_title', { name }), tRaw('household.unlink_confirm_text', { name }), 'link', { knopf: 'confirm.btn.verknuepfung_loesen', art: 'bp' })) return;
  const d = await api('POST','/v1/settings/household/unlink', subUserId ? { sub_user_id: parseInt(subUserId) } : {});
  if(!d.success){ toast(d.error || t('settings.error'),'error'); return; }
  toast(tRaw('household.unlink_ok'),'success');
  loadHousehold();
}

registerActions({
  copyHouseholdInvite,
  createHouseholdInvite,
  redeemHouseholdInvite,
  unlinkHousehold,
  unlinkFromParent,
  dismissFormerLink,
});
