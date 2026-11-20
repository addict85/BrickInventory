package ch.brickinventoryapp.konto.ui.viewmodel

import ch.brickinventoryapp.zustand.ui.viewmodel.Observed
import kotlinx.coroutines.flow.StateFlow
import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.ui.withoutError
import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.beendet
import ch.brickinventoryapp.zustand.ui.gescheitert
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.fach.Fehlercode
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.model.fach.Confirmation
import ch.brickinventoryapp.model.fach.Designstand
import ch.brickinventoryapp.model.fach.Profilaenderung
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.konto.ui.DesignChoice
import ch.brickinventoryapp.konto.ui.DevicesPrompt
import ch.brickinventoryapp.konto.ui.DevicesUiState
import ch.brickinventoryapp.konto.ui.AccountUiState
import ch.brickinventoryapp.sitzung.Sitzung
import ch.brickinventoryapp.sitzung.SitzungsRepository
import ch.brickinventoryapp.konto.ui.ZweiterFaktorUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.model.util.otpauthAddress
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.zustand.ui.loadError
import ch.brickinventoryapp.zustand.ui.viewmodel.observeLoadOn

/**
 * Das eigene Konto: Profil, Passwort, angemeldete Geräte, zweiter Faktor.
 *
 * An das Ziel der Konto-Seite gebunden, nicht an die Activity: Profil,
 * Geräteliste und ein halb eingerichtetes TOTP-Geheimnis leben nur, solange
 * die Seite offen ist, und kein Abmelden muss sie eigens wegräumen.
 */
@HiltViewModel
class AccountViewModel @Inject constructor(
    private val konto: AccountRepository,
    private val meldungen: MeldungsKanal,
    private val sitzung: Sitzung,
    private val sessionService: SitzungsRepository,
) : ViewModel() {

    private val _accountState = MutableStateFlow(AccountUiState())
    val kontoState = _accountState.asStateFlow()
    private val _devicesState = MutableStateFlow(DevicesUiState())
    internal val geraeteState = _devicesState.asStateFlow()
    private val _secondFactorState = MutableStateFlow(ZweiterFaktorUiState())
    val secondFactorState = _secondFactorState.asStateFlow()

    /**
     * Der Kontozustand, wie ihn die Kontoseite liest: Nur wer sie öffnet, lädt Profil und
     * Design. Die Startpasswort-Maske liest [kontoState] und lädt nichts.
     */
    private val pageObserved = Observed(kontoState)
    val accountPage: StateFlow<AccountUiState> = pageObserved

    init {
        observeLoadOn(pageObserved) { loadProfile(); loadDesign() }
        observeLoadOn(_devicesState) { loadDevices() }
        observeLoadOn(_secondFactorState) { loadSecondFactor() }
    }

    // ── Profil und Passwort ──────────────────────────────────────────────────

    fun loadProfile() {
        viewModelScope.launch {
            _accountState.update { it.copy(abruf = Laden.Loads, speichern = it.speichern.withoutError()) }
            fetchProfile()
        }
    }

    /** Lässt einen Fehler stehen, den das Speichern davor gesetzt hat (Mail nicht gesendet). */
    private suspend fun fetchProfile() {
        when (val r = konto.getProfile()) {
            is Ergebnis.Erfolg -> _accountState.update {
                it.copy(abruf = Laden.Daten(Unit), profile = r.data)
            }
            is Ergebnis.Fehler -> _accountState.update { it.copy(abruf = loadError(r)) }
        }
    }

    fun saveProfile(
        benutzername: String, email: String, vorname: String, nachname: String, passwort: String? = null,
        code: String? = null,
    ) {
        // Der Server verlangt das Passwort für jede Profiländerung; ohne es gar nicht erst fragen.
        if (passwort.isNullOrBlank()) {
            _accountState.update { it.copy(speichern = Vorgang.Fehlgeschlagen(Meldung.Resource(R.string.konto_profil_password_needed)), meldung = null) }
            return
        }
        viewModelScope.launch {
            _accountState.update { it.copy(speichern = Vorgang.Laeuft, meldung = null) }
            val aenderung = Profilaenderung(
                benutzer = benutzername.trim(),
                email = email.trim(),
                // Leer heisst „nicht angegeben", nicht „leerer Vorname".
                vorname = vorname.trim().ifBlank { null },
                nachname = nachname.trim().ifBlank { null },
                passwortAktuell = passwort,
                code = code?.trim()?.ifBlank { null },
            )
            when (val r = konto.updateProfile(aenderung)) {
                is Ergebnis.Erfolg -> {
                        // Eine neue Adresse gilt erst nach dem Link: „gespeichert“ allein liesse
                        // glauben, sie gelte schon, und ohne Mail wartet sie umsonst.
                        val newAddress = r.data.newAddress
                        val withoutMail = newAddress && !r.data.mailSent
                        _accountState.update { it.copy(codeNoetig = false,
                            meldung = when {
                                withoutMail -> null
                                newAddress -> Meldung.Resource(R.string.konto_email_link_gesendet, listOf(aenderung.email))
                                else -> Meldung.Resource(R.string.konto_saved)
                            },
                            speichern = beendet(if (withoutMail) Meldung.Resource(R.string.konto_email_nicht_gesendet) else null)) }
                        // Neu holen: Der Server normalisiert, die Karte zeigt seinen Stand.
                        fetchProfile()
                    }
                is Ergebnis.Fehler -> abgelehnt(r)
            }
        }
    }

    /**
     * Bei aktivem zweitem Faktor verlangt der Server für Passwort und E-Mail einen
     * Code. Fehlt er, merkt sich der Zustand das; die Oberfläche zeigt das Feld,
     * und die nächste Anfrage trägt ihn mit. Ein falscher Code lässt das Feld stehen.
     */
    private fun abgelehnt(r: Ergebnis.Fehler) = _accountState.update {
        it.copy(speichern = gescheitert(r),
            codeNoetig = it.codeNoetig || r.code == Fehlercode.ZWEITER_FAKTOR_NOETIG || r.code == Fehlercode.ZWEITER_FAKTOR_FALSCH)
    }

    /**
     * Passwort ändern. Der Server verwirft danach ALLE Token des Kontos, auch
     * diesen; deshalb geht es danach den vollen Abmeldeweg der App. Die
     * Erklärung kommt in den Snackbar — die Kontokarte ist danach weg.
     */
    fun aenderePasswort(aktuell: String, neu: String, code: String? = null) {
        viewModelScope.launch {
            _accountState.update { it.copy(speichern = Vorgang.Laeuft, meldung = null) }
            when (val r = konto.changePassword(aktuell, neu, code?.trim()?.ifBlank { null })) {
                is Ergebnis.Erfolg -> {
                    sessionService.abmelden()
                    meldungen.zeige(Meldung.Resource(R.string.konto_password_changed))
                    _accountState.value = AccountUiState()
                }
                is Ergebnis.Fehler -> abgelehnt(r)
            }
        }
    }

    // ── Design des Kontos ────────────────────────────────────────────────────

    /** Mit Token liefert /settings/theme das Design DIESES Kontos samt Vorgabe. */
    fun loadDesign() {
        viewModelScope.launch {
            val r = konto.getAppTheme()
            if (r is Ergebnis.Erfolg) _accountState.update { it.copy(design = designChoice(r.data)) }
        }
    }

    /**
     * Eigenes Design wählen; null heisst Vorgabe des Verwalters. Die Antwort nennt
     * das wirksame Design, und das gilt sofort in der ganzen App.
     */
    fun chooseDesign(eigenes: Design?) {
        viewModelScope.launch {
            when (val r = konto.setOwnDesign(eigenes)) {
                is Ergebnis.Erfolg -> {
                    r.data.wirksam?.let(sitzung::setzeDesign)
                    _accountState.update { it.copy(design = designChoice(r.data), speichern = it.speichern.withoutError()) }
                }
                is Ergebnis.Fehler -> _accountState.update { it.copy(speichern = gescheitert(r)) }
            }
        }
    }

    /** Ohne `vorgabe` ist der Server älter und kennt kein Design je Konto: dann keine Auswahl. */
    private fun designChoice(a: Designstand) =
        a.vorgabe?.let { DesignChoice(a.wirksam ?: it, it, a.eigenes) }

    /** Meldung/Fehler der Kontokarte wegräumen, wenn der Nutzer weitertippt. */
    fun accountMessageRoute() = _accountState.update { it.copy(meldung = null, speichern = it.speichern.withoutError()) }

    // ── Angemeldete Geräte ───────────────────────────────────────────────────

    fun loadDevices() {
        viewModelScope.launch {
            _devicesState.update { it.copy(abruf = Laden.Loads) }
            when (val r = konto.getTokens()) {
                is Ergebnis.Erfolg -> _devicesState.update { it.copy(abruf = Laden.Daten(Unit), geraete = r.data) }
                is Ergebnis.Fehler -> _devicesState.update { it.copy(abruf = loadError(r)) }
            }
        }
    }

    /**
     * Die Rückfrage vor dem Abmelden öffnen; [tokenId] null heisst alle anderen.
     * Ohne als „aktuell" erkanntes Gerät wird nichts entwertet — sonst träfe es
     * womöglich das eigene.
     */
    fun redeemQuestion(tokenId: String?) {
        val liste = _devicesState.value.geraete
        if (tokenId == null) {
            if (liste.none { it.aktuell }) {
                _devicesState.update { it.copy(abruf = Laden.Fehler(Fehlerklasse.UNBEKANNT, Meldung.Resource(R.string.tokens_self_unknown))) }
                return
            }
            if (liste.none { !it.aktuell }) { meldungen.zeige(Meldung.Resource(R.string.tokens_no_others)); return }
        }
        _devicesState.update { it.copy(prompt = DevicesPrompt(tokenId), abruf = Laden.Daten(Unit)) }
    }

    fun cancelRedeem() = _devicesState.update { it.copy(prompt = null) }

    /** Passwort und, wenn der Server ihn verlangt hat, Code; eine Absage lässt die Rückfrage offen. */
    fun redeemConfirm(passwort: String, code: String?) {
        val frage = _devicesState.value.prompt ?: return
        if (frage.operation.laeuft) return
        _devicesState.update { it.copy(prompt = frage.copy(operation = Vorgang.Laeuft)) }
        val anfrage = Confirmation(passwort = passwort, code = code?.trim()?.ifEmpty { null })
        viewModelScope.launch {
            val fehler: Ergebnis.Fehler? = if (frage.tokenId != null) {
                when (val r = konto.revokeToken(frage.tokenId, anfrage)) {
                    is Ergebnis.Erfolg -> {
                        // deleted = 0: schon weg (anderes Gerät war schneller) — die Liste stimmt danach wieder.
                        meldungen.zeige(Meldung.Resource(if (r.data > 0) R.string.tokens_revoked else R.string.tokens_already_gone))
                        null
                    }
                    is Ergebnis.Fehler -> r
                }
            } else {
                when (val r = konto.endOther(anfrage)) {
                    is Ergebnis.Erfolg -> {
                        val weg = r.data
                        meldungen.zeige(Meldung.Menge(R.plurals.tokens_revoked_n, weg))
                        null
                    }
                    is Ergebnis.Fehler -> r
                }
            }
            if (fehler == null) {
                _devicesState.update { it.copy(prompt = null) }
                loadDevices()
            } else _devicesState.update {
                it.copy(prompt = it.prompt?.copy(operation = gescheitert(fehler),
                    codeNoetig = it.prompt.codeNoetig || fehler.code == Fehlercode.ZWEITER_FAKTOR_NOETIG ||
                        fehler.code == Fehlercode.ZWEITER_FAKTOR_FALSCH))
            }
        }
    }

    // ── Zweiter Faktor ───────────────────────────────────────────────────────

    fun loadSecondFactor() = zweiterFaktor({ konto.secondFactorStatus() }) { s, d ->
        s.copy(aktiv = d.aktiv, codesUebrig = d.codesUebrig)
    }

    fun setUpSecondFactorOne(passwort: String) = zweiterFaktor({ konto.setUpSecondFactor(passwort) }) { s, d ->
        s.copy(geheimnis = d.geheimnis, otpauth = otpauthAddress(d.otpauth))
    }

    fun bestaetigeZweitenFaktor(code: String) =
        zweiterFaktor({ konto.zweiterFaktorBestaetigen(code.trim()) }, R.string.zf_enabled) { s, d ->
        s.copy(aktiv = true, codesUebrig = d.size, geheimnis = null, otpauth = null, codes = d)
    }

    fun renewSecondFactorCodes(code: String) = zweiterFaktor({ konto.secondFactorNewCodes(code.trim()) }) { s, d ->
        s.copy(codesUebrig = d.size, codes = d)
    }

    fun switchSecondFactorAb(passwort: String, code: String) =
        zweiterFaktor({ konto.disableSecondFactor(passwort, code.trim()) }, R.string.zf_disabled) { _, _ ->
            ZweiterFaktorUiState(aktiv = false)
        }

    fun secondFactorBack() =
        _secondFactorState.update { it.copy(geheimnis = null, otpauth = null, codes = emptyList(), abruf = Laden.Daten(Unit)) }

    /** Ein Schritt: laden anzeigen, fragen, Ergebnis eintragen oder Fehler zeigen. */
    private fun <T> zweiterFaktor(
        abruf: suspend () -> Ergebnis<T>,
        successText: Int? = null,
        danach: (ZweiterFaktorUiState, T) -> ZweiterFaktorUiState,
    ) {
        viewModelScope.launch {
            _secondFactorState.update { it.copy(abruf = Laden.Loads) }
            when (val r = abruf()) {
                is Ergebnis.Erfolg -> {
                    successText?.let { meldungen.zeige(Meldung.Resource(it)) }
                    _secondFactorState.update { danach(it, r.data).copy(abruf = Laden.Daten(Unit)) }
                }
                is Ergebnis.Fehler -> _secondFactorState.update { it.copy(abruf = loadError(r)) }
            }
        }
    }
}
