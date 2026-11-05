package ch.brickinventoryapp.ui.viewmodel

import ch.brickinventoryapp.ui.model.alsAnsicht
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.model.ProfilAenderung
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.model.alsGeraet
import ch.brickinventoryapp.ui.DesignWahl
import ch.brickinventoryapp.ui.GeraeteUiState
import ch.brickinventoryapp.ui.KontoUiState
import ch.brickinventoryapp.ui.Sitzung
import ch.brickinventoryapp.ui.setzeDesign
import ch.brickinventoryapp.ui.ZweiterFaktorUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.data.model.AppThemeResponse
import ch.brickinventoryapp.util.otpauthAdresse

/**
 * Das eigene Konto: Profil, Passwort, angemeldete Geräte, zweiter Faktor.
 *
 * An das Ziel der Konto-Seite gebunden, nicht an die Activity: Profil,
 * Geräteliste und ein halb eingerichtetes TOTP-Geheimnis leben nur, solange
 * die Seite offen ist, und kein Abmelden muss sie eigens wegräumen.
 */
@HiltViewModel
class KontoViewModel @Inject constructor(
    private val konto: KontoRepository,
    private val texte: Texte,
    private val meldungen: MeldungsKanal,
    private val sitzung: Sitzung,
) : ViewModel() {

    private val _kontoState = MutableStateFlow(KontoUiState())
    val kontoState = _kontoState.asStateFlow()
    private val _geraeteState = MutableStateFlow(GeraeteUiState())
    val geraeteState = _geraeteState.asStateFlow()
    private val _zweiterFaktorState = MutableStateFlow(ZweiterFaktorUiState())
    val zweiterFaktorState = _zweiterFaktorState.asStateFlow()

    // ── Profil und Passwort ──────────────────────────────────────────────────

    fun ladeProfil() {
        viewModelScope.launch {
            _kontoState.update { it.copy(laedt = true, fehler = null) }
            holeProfil()
        }
    }

    /** Lässt einen Fehler stehen, den das Speichern davor gesetzt hat (Mail nicht gesendet). */
    private suspend fun holeProfil() {
        when (val r = konto.getProfil()) {
            is Result.Success -> _kontoState.update {
                it.copy(laedt = false, profil = r.data.user?.alsAnsicht(),
                        fehler = if (r.data.user == null) r.data.error ?: texte.text(R.string.err_generic) else it.fehler)
            }
            is Result.Error -> _kontoState.update { it.copy(laedt = false, fehler = texte.meldung(r)) }
        }
    }

    fun speichereProfil(
        benutzername: String, email: String, vorname: String, nachname: String, passwort: String? = null,
        code: String? = null,
    ) {
        // Der Server verlangt das Passwort für jede Profiländerung; ohne es gar nicht erst fragen.
        if (passwort.isNullOrBlank()) {
            _kontoState.update { it.copy(fehler = texte.text(R.string.konto_profil_password_needed), meldung = null) }
            return
        }
        viewModelScope.launch {
            _kontoState.update { it.copy(speichert = true, fehler = null, meldung = null) }
            val aenderung = ProfilAenderung(
                username = benutzername.trim(),
                email = email.trim(),
                // Leer heisst „nicht angegeben", nicht „leerer Vorname".
                firstName = vorname.trim().ifBlank { null },
                lastName = nachname.trim().ifBlank { null },
                passwordCurrent = passwort,
                code = code?.trim()?.ifBlank { null },
            )
            when (val r = konto.updateProfil(aenderung)) {
                is Result.Success ->
                    if (r.data.success) {
                        // Eine neue Adresse gilt erst nach dem Link: „gespeichert“ allein liesse
                        // glauben, sie gelte schon, und ohne Mail wartet sie umsonst.
                        val neueAdresse = r.data.emailChanged == true
                        val ohneMail = neueAdresse && r.data.emailSent != true
                        _kontoState.update { it.copy(speichert = false, codeNoetig = false,
                            meldung = when {
                                ohneMail -> null
                                neueAdresse -> texte.text(R.string.konto_email_link_gesendet, aenderung.email)
                                else -> texte.text(R.string.konto_saved)
                            },
                            fehler = if (ohneMail) texte.text(R.string.konto_email_nicht_gesendet) else null) }
                        // Neu holen: Der Server normalisiert, die Karte zeigt seinen Stand.
                        holeProfil()
                    } else {
                        _kontoState.update { it.copy(speichert = false,
                            fehler = r.data.error ?: texte.text(R.string.err_generic)) }
                    }
                is Result.Error -> abgelehnt(r)
            }
        }
    }

    /**
     * Bei aktivem zweitem Faktor verlangt der Server für Passwort und E-Mail einen
     * Code. Fehlt er, merkt sich der Zustand das; die Oberfläche zeigt das Feld,
     * und die nächste Anfrage trägt ihn mit. Ein falscher Code lässt das Feld stehen.
     */
    private fun abgelehnt(r: Result.Error) = _kontoState.update {
        it.copy(speichert = false, fehler = texte.meldung(r),
            codeNoetig = it.codeNoetig || r.code == "zweiter_faktor_noetig" || r.code == "zweiter_faktor_falsch")
    }

    /**
     * Passwort ändern. Der Server verwirft danach ALLE Token des Kontos, auch
     * diesen; [abmelden] geht deshalb den vollen Abmeldeweg der App. Die
     * Erklärung kommt in den Snackbar — die Kontokarte ist danach weg.
     */
    fun aenderePasswort(aktuell: String, neu: String, code: String? = null, abmelden: () -> Unit) {
        viewModelScope.launch {
            _kontoState.update { it.copy(speichert = true, fehler = null, meldung = null) }
            when (val r = konto.changePassword(aktuell, neu, code?.trim()?.ifBlank { null })) {
                is Result.Success ->
                    if (r.data.success) {
                        abmelden()
                        meldungen.zeige(texte.text(R.string.konto_password_changed))
                        _kontoState.value = KontoUiState()
                    } else {
                        _kontoState.update { it.copy(speichert = false,
                            fehler = r.data.error ?: texte.text(R.string.err_generic)) }
                    }
                is Result.Error -> abgelehnt(r)
            }
        }
    }

    // ── Design des Kontos ────────────────────────────────────────────────────

    /** Mit Token liefert /settings/theme das Design DIESES Kontos samt Vorgabe. */
    fun ladeDesign() {
        viewModelScope.launch {
            val r = konto.getAppTheme()
            if (r is Result.Success && r.data.success) _kontoState.update { it.copy(design = designWahl(r.data)) }
        }
    }

    /**
     * Eigenes Design wählen; "" heisst Vorgabe des Verwalters. Die Antwort nennt
     * das wirksame Design, und das gilt sofort in der ganzen App.
     */
    fun waehleDesign(eigenes: String) {
        viewModelScope.launch {
            when (val r = konto.setzeEigenesDesign(eigenes)) {
                is Result.Success ->
                    if (r.data.success) {
                        sitzung.setzeDesign(r.data.theme)
                        _kontoState.update { it.copy(design = designWahl(r.data), fehler = null) }
                    } else _kontoState.update { it.copy(fehler = r.data.error ?: texte.text(R.string.err_generic)) }
                is Result.Error -> _kontoState.update { it.copy(fehler = texte.meldung(r)) }
            }
        }
    }

    /** Ohne `vorgabe` ist der Server älter und kennt kein Design je Konto: dann keine Auswahl. */
    private fun designWahl(a: AppThemeResponse) =
        a.vorgabe?.let { DesignWahl(a.theme, it, a.eigenes) }

    /** Meldung/Fehler der Kontokarte wegräumen, wenn der Nutzer weitertippt. */
    fun kontoMeldungWeg() = _kontoState.update { it.copy(meldung = null, fehler = null) }

    // ── Angemeldete Geräte ───────────────────────────────────────────────────

    fun ladeGeraete() {
        viewModelScope.launch {
            _geraeteState.update { it.copy(laedt = true, fehler = null) }
            when (val r = konto.getTokens()) {
                is Result.Success ->
                    if (r.data.success) _geraeteState.update { it.copy(laedt = false, geraete = r.data.tokens.map { it.alsGeraet() }, fehler = null) }
                    else _geraeteState.update { it.copy(laedt = false, fehler = r.data.error) }
                is Result.Error -> _geraeteState.update { it.copy(laedt = false, fehler = texte.meldung(r)) }
            }
        }
    }

    fun entwerteGeraet(tokenId: String) {
        viewModelScope.launch {
            _geraeteState.update { it.copy(laedt = true, fehler = null) }
            when (val r = konto.revokeToken(tokenId)) {
                is Result.Success -> {
                    // deleted = 0: schon weg (anderes Gerät war schneller) — die Liste stimmt danach wieder.
                    meldungen.zeige(texte.text(if (r.data.deleted > 0) R.string.tokens_revoked else R.string.tokens_already_gone))
                    ladeGeraete()
                }
                is Result.Error -> _geraeteState.update { it.copy(laedt = false, fehler = texte.meldung(r)) }
            }
        }
    }

    /**
     * Alle anderen Geräte abmelden. Ohne als „aktuell" erkanntes Gerät wird
     * nichts entwertet — sonst träfe es womöglich das eigene.
     */
    fun entwerteAndereGeraete() {
        viewModelScope.launch {
            val liste = _geraeteState.value.geraete
            if (liste.none { it.aktuell }) {
                _geraeteState.update { it.copy(fehler = texte.text(R.string.tokens_self_unknown)) }
                return@launch
            }
            val andere = liste.filter { !it.aktuell }
            if (andere.isEmpty()) { meldungen.zeige(texte.text(R.string.tokens_no_others)); return@launch }
            _geraeteState.update { it.copy(laedt = true, fehler = null) }
            var weg = 0
            for (g in andere) if (((konto.revokeToken(g.tokenId) as? Result.Success)?.data?.deleted ?: 0) > 0) weg++
            meldungen.zeige(texte.menge(R.plurals.tokens_revoked_n, weg, weg))
            ladeGeraete()
        }
    }

    // ── Zweiter Faktor ───────────────────────────────────────────────────────

    fun ladeZweitenFaktor() = zweiterFaktor({ konto.zweiterFaktorStand() }) { s, d ->
        s.copy(aktiv = d.aktiv, codesUebrig = d.codesUebrig)
    }

    fun richteZweitenFaktorEin(passwort: String) = zweiterFaktor({ konto.zweiterFaktorEinrichten(passwort) }) { s, d ->
        s.copy(geheimnis = d.geheimnis, otpauth = otpauthAdresse(d.otpauth))
    }

    fun bestaetigeZweitenFaktor(code: String) =
        zweiterFaktor({ konto.zweiterFaktorBestaetigen(code.trim()) }, R.string.zf_enabled) { s, d ->
        s.copy(aktiv = true, codesUebrig = d.codes.size, geheimnis = null, otpauth = null, codes = d.codes)
    }

    fun erneuereZweiterFaktorCodes(code: String) = zweiterFaktor({ konto.zweiterFaktorNeueCodes(code.trim()) }) { s, d ->
        s.copy(codesUebrig = d.codes.size, codes = d.codes)
    }

    fun schalteZweitenFaktorAb(passwort: String, code: String) =
        zweiterFaktor({ konto.zweiterFaktorAbschalten(passwort, code.trim()) }, R.string.zf_disabled) { _, _ ->
            ZweiterFaktorUiState(aktiv = false)
        }

    fun zweiterFaktorZurueck() =
        _zweiterFaktorState.update { it.copy(geheimnis = null, otpauth = null, codes = emptyList(), fehler = null) }

    /** Ein Schritt: laden anzeigen, fragen, Ergebnis eintragen oder Fehler zeigen. */
    private fun <T> zweiterFaktor(
        abruf: suspend () -> Result<T>,
        erfolgText: Int? = null,
        danach: (ZweiterFaktorUiState, T) -> ZweiterFaktorUiState,
    ) {
        viewModelScope.launch {
            _zweiterFaktorState.update { it.copy(laedt = true, fehler = null) }
            when (val r = abruf()) {
                is Result.Success -> {
                    erfolgText?.let { meldungen.zeige(texte.text(it)) }
                    _zweiterFaktorState.update { danach(it, r.data).copy(laedt = false) }
                }
                is Result.Error -> _zweiterFaktorState.update { it.copy(laedt = false, fehler = texte.meldung(r)) }
            }
        }
    }
}
