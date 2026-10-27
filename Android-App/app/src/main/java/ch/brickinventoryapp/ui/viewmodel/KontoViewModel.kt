package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.model.ProfilAenderung
import ch.brickinventoryapp.data.repository.AdminRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.GeraeteUiState
import ch.brickinventoryapp.ui.KontoUiState
import ch.brickinventoryapp.ui.ZweiterFaktorUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Das eigene Konto: Profil, Passwort, angemeldete Geräte, zweiter Faktor.
 *
 * An das Ziel der Konto-Seite gebunden, nicht an die Activity: Profil,
 * Geräteliste und ein halb eingerichtetes TOTP-Geheimnis leben nur, solange
 * die Seite offen ist, und kein Abmelden muss sie eigens wegräumen.
 */
@HiltViewModel
class KontoViewModel @Inject constructor(
    private val admin: AdminRepository,
    private val texte: Texte,
    meldungen: MeldungsKanal,
) : ViewModel() {

    private val _kontoState = MutableStateFlow(KontoUiState())
    val kontoState = _kontoState.asStateFlow()
    private val _geraeteState = MutableStateFlow(GeraeteUiState())
    val geraeteState = _geraeteState.asStateFlow()
    private val _zweiterFaktorState = MutableStateFlow(ZweiterFaktorUiState())
    val zweiterFaktorState = _zweiterFaktorState.asStateFlow()

    private val _snackbar = meldungen.fluss

    // ── Profil und Passwort ──────────────────────────────────────────────────

    fun ladeProfil() {
        viewModelScope.launch {
            _kontoState.update { it.copy(laedt = true, fehler = null) }
            when (val r = admin.getProfil()) {
                is Result.Success -> _kontoState.update {
                    it.copy(laedt = false, profil = r.data.user,
                            fehler = if (r.data.user == null) r.data.error ?: texte.text(R.string.err_generic) else null)
                }
                is Result.Error -> _kontoState.update { it.copy(laedt = false, fehler = texte.meldung(r)) }
            }
        }
    }

    fun speichereProfil(
        benutzername: String, email: String, vorname: String, nachname: String, passwort: String? = null,
    ) {
        viewModelScope.launch {
            _kontoState.update { it.copy(speichert = true, fehler = null, meldung = null) }
            val aenderung = ProfilAenderung(
                username = benutzername.trim(),
                email = email.trim(),
                // Leer heisst „nicht angegeben", nicht „leerer Vorname".
                firstName = vorname.trim().ifBlank { null },
                lastName = nachname.trim().ifBlank { null },
                passwordCurrent = passwort?.ifBlank { null },
            )
            when (val r = admin.updateProfil(aenderung)) {
                is Result.Success ->
                    if (r.data.success) {
                        _kontoState.update { it.copy(speichert = false, meldung = texte.text(R.string.konto_saved)) }
                        // Neu holen: Der Server normalisiert, die Karte zeigt seinen Stand.
                        ladeProfil()
                    } else {
                        _kontoState.update { it.copy(speichert = false,
                            fehler = r.data.error ?: texte.text(R.string.err_generic)) }
                    }
                is Result.Error -> _kontoState.update { it.copy(speichert = false, fehler = texte.meldung(r)) }
            }
        }
    }

    /**
     * Passwort ändern. Der Server verwirft danach ALLE Token des Kontos, auch
     * diesen; [abmelden] geht deshalb den vollen Abmeldeweg der App. Die
     * Erklärung kommt in den Snackbar — die Kontokarte ist danach weg.
     */
    fun aenderePasswort(aktuell: String, neu: String, abmelden: () -> Unit) {
        viewModelScope.launch {
            _kontoState.update { it.copy(speichert = true, fehler = null, meldung = null) }
            when (val r = admin.changePassword(aktuell, neu)) {
                is Result.Success ->
                    if (r.data.success) {
                        abmelden()
                        _snackbar.value = texte.text(R.string.konto_password_changed)
                        _kontoState.value = KontoUiState()
                    } else {
                        _kontoState.update { it.copy(speichert = false,
                            fehler = r.data.error ?: texte.text(R.string.err_generic)) }
                    }
                is Result.Error -> _kontoState.update { it.copy(speichert = false, fehler = texte.meldung(r)) }
            }
        }
    }

    /** Meldung/Fehler der Kontokarte wegräumen, wenn der Nutzer weitertippt. */
    fun kontoMeldungWeg() = _kontoState.update { it.copy(meldung = null, fehler = null) }

    // ── Angemeldete Geräte ───────────────────────────────────────────────────

    fun ladeGeraete() {
        viewModelScope.launch {
            _geraeteState.update { it.copy(laedt = true, fehler = null) }
            when (val r = admin.getTokens()) {
                is Result.Success ->
                    if (r.data.success) _geraeteState.update { it.copy(laedt = false, geraete = r.data.tokens, fehler = null) }
                    else _geraeteState.update { it.copy(laedt = false, fehler = r.data.error) }
                is Result.Error -> _geraeteState.update { it.copy(laedt = false, fehler = texte.meldung(r)) }
            }
        }
    }

    fun entwerteGeraet(tokenId: String) {
        viewModelScope.launch {
            _geraeteState.update { it.copy(laedt = true, fehler = null) }
            when (val r = admin.revokeToken(tokenId)) {
                is Result.Success -> {
                    _snackbar.value = texte.text(R.string.tokens_revoked)
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
            if (andere.isEmpty()) { _snackbar.value = texte.text(R.string.tokens_no_others); return@launch }
            _geraeteState.update { it.copy(laedt = true, fehler = null) }
            var weg = 0
            for (g in andere) if (admin.revokeToken(g.tokenId) is Result.Success) weg++
            _snackbar.value = texte.menge(R.plurals.tokens_revoked_n, weg, weg)
            ladeGeraete()
        }
    }

    // ── Zweiter Faktor ───────────────────────────────────────────────────────

    fun ladeZweitenFaktor() = zweiterFaktor({ admin.zweiterFaktorStand() }) { s, d ->
        s.copy(aktiv = d.aktiv, codesUebrig = d.codesUebrig)
    }

    fun richteZweitenFaktorEin(passwort: String) = zweiterFaktor({ admin.zweiterFaktorEinrichten(passwort) }) { s, d ->
        s.copy(geheimnis = d.geheimnis, otpauth = d.otpauth)
    }

    fun bestaetigeZweitenFaktor(code: String) =
        zweiterFaktor({ admin.zweiterFaktorBestaetigen(code.trim()) }, R.string.zf_enabled) { s, d ->
        s.copy(aktiv = true, codesUebrig = d.codes.size, geheimnis = null, otpauth = null, codes = d.codes)
    }

    fun erneuereZweiterFaktorCodes(code: String) = zweiterFaktor({ admin.zweiterFaktorNeueCodes(code.trim()) }) { s, d ->
        s.copy(codesUebrig = d.codes.size, codes = d.codes)
    }

    fun schalteZweitenFaktorAb(passwort: String, code: String) =
        zweiterFaktor({ admin.zweiterFaktorAbschalten(passwort, code.trim()) }, R.string.zf_disabled) { _, _ ->
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
                    erfolgText?.let { _snackbar.value = texte.text(it) }
                    _zweiterFaktorState.update { danach(it, r.data).copy(laedt = false) }
                }
                is Result.Error -> _zweiterFaktorState.update { it.copy(laedt = false, fehler = texte.meldung(r)) }
            }
        }
    }
}
