package ch.brickinventoryapp.account.ui.viewmodel

import ch.brickinventoryapp.state.ui.viewmodel.Observed
import kotlinx.coroutines.flow.StateFlow
import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.ui.withoutError
import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.beendet
import ch.brickinventoryapp.state.ui.gescheitert
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.domain.Fehlercode
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.model.domain.Confirmation
import ch.brickinventoryapp.model.domain.Designstand
import ch.brickinventoryapp.model.domain.Profilaenderung
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.account.ui.DesignChoice
import ch.brickinventoryapp.account.ui.DevicesPrompt
import ch.brickinventoryapp.account.ui.DevicesUiState
import ch.brickinventoryapp.account.ui.AccountUiState
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.session.SitzungsRepository
import ch.brickinventoryapp.account.ui.ZweiterFaktorUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.model.util.otpauthAddress
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.state.ui.viewmodel.observeLoadOn

/**
 * One's own account: profile, password, signed-in devices, second factor.
 *
 * Tied to the account page's destination, not to the Activity: profile,
 * device list and a half-set-up TOTP secret only live as long as
 * the page is open, and no sign-out needs to clean them up separately.
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
     * The account state, as the account page reads it: only whoever opens it loads profile and
     * design. The start-password mask reads [kontoState] and loads nothing.
     */
    private val pageObserved = Observed(kontoState)
    val accountPage: StateFlow<AccountUiState> = pageObserved

    init {
        observeLoadOn(pageObserved) { loadProfile(); loadDesign() }
        observeLoadOn(_devicesState) { loadDevices() }
        observeLoadOn(_secondFactorState) { loadSecondFactor() }
    }

    // ── Profile and password ──────────────────────────────────────────────────

    fun loadProfile() {
        viewModelScope.launch {
            _accountState.update { it.copy(abruf = Laden.Loads, speichern = it.speichern.withoutError()) }
            fetchProfile()
        }
    }

    /** Leaves an error standing that the save set beforehand (mail not sent). */
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
        // The server requires the password for every profile change; don't even ask without it.
        if (passwort.isNullOrBlank()) {
            _accountState.update { it.copy(speichern = Vorgang.Fehlgeschlagen(Meldung.Resource(R.string.konto_profil_password_needed)), meldung = null) }
            return
        }
        viewModelScope.launch {
            _accountState.update { it.copy(speichern = Vorgang.Laeuft, meldung = null) }
            val aenderung = Profilaenderung(
                benutzer = benutzername.trim(),
                email = email.trim(),
                // Empty means "not given", not "empty first name".
                vorname = vorname.trim().ifBlank { null },
                nachname = nachname.trim().ifBlank { null },
                passwortAktuell = passwort,
                code = code?.trim()?.ifBlank { null },
            )
            when (val r = konto.updateProfile(aenderung)) {
                is Ergebnis.Erfolg -> {
                        // A new address only takes effect after the link: "saved" alone would
                        // suggest it already applies, and without the mail it waits for nothing.
                        val newAddress = r.data.newAddress
                        val withoutMail = newAddress && !r.data.mailSent
                        _accountState.update { it.copy(codeNoetig = false,
                            meldung = when {
                                withoutMail -> null
                                newAddress -> Meldung.Resource(R.string.konto_email_link_gesendet, listOf(aenderung.email))
                                else -> Meldung.Resource(R.string.konto_saved)
                            },
                            speichern = beendet(if (withoutMail) Meldung.Resource(R.string.konto_email_nicht_gesendet) else null)) }
                        // Fetch again: the server normalizes, the card shows its state.
                        fetchProfile()
                    }
                is Ergebnis.Fehler -> abgelehnt(r)
            }
        }
    }

    /**
     * With the second factor active, the server requires a code for password and email.
     * If it's missing, the state remembers that; the UI shows the field,
     * and the next request carries it along. A wrong code leaves the field standing.
     */
    private fun abgelehnt(r: Ergebnis.Fehler) = _accountState.update {
        it.copy(speichern = gescheitert(r),
            codeNoetig = it.codeNoetig || r.code == Fehlercode.ZWEITER_FAKTOR_NOETIG || r.code == Fehlercode.ZWEITER_FAKTOR_FALSCH)
    }

    /**
     * Change password. The server then invalidates ALL of the account's tokens, this
     * one included; that's why it goes through the app's full sign-out path afterward. The
     * explanation goes into the snackbar — the account card is gone by then.
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

    // ── Account design ────────────────────────────────────────────────────

    /** With a token, /settings/theme delivers THIS account's design plus the default. */
    fun loadDesign() {
        viewModelScope.launch {
            val r = konto.getAppTheme()
            if (r is Ergebnis.Erfolg) _accountState.update { it.copy(design = designChoice(r.data)) }
        }
    }

    /**
     * Choose your own design; null means the admin's default. The response names
     * the effective design, and it applies right away across the whole app.
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

    /** Without `vorgabe` the server is older and knows no per-account design: then no choice. */
    private fun designChoice(a: Designstand) =
        a.vorgabe?.let { DesignChoice(a.wirksam ?: it, it, a.eigenes) }

    /** Clear the account card's message/error once the user types on. */
    fun accountMessageRoute() = _accountState.update { it.copy(meldung = null, speichern = it.speichern.withoutError()) }

    // ── Signed-in devices ───────────────────────────────────────────────────

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
     * Opens the confirmation before signing out; [tokenId] null means all others.
     * Without a device recognized as "current", nothing is revoked — otherwise it might
     * hit one's own.
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

    /** Password and, if the server demanded it, code; a refusal leaves the prompt open. */
    fun redeemConfirm(passwort: String, code: String?) {
        val frage = _devicesState.value.prompt ?: return
        if (frage.operation.laeuft) return
        _devicesState.update { it.copy(prompt = frage.copy(operation = Vorgang.Laeuft)) }
        val anfrage = Confirmation(passwort = passwort, code = code?.trim()?.ifEmpty { null })
        viewModelScope.launch {
            val fehler: Ergebnis.Fehler? = if (frage.tokenId != null) {
                when (val r = konto.revokeToken(frage.tokenId, anfrage)) {
                    is Ergebnis.Erfolg -> {
                        // deleted = 0: already gone (another device was faster) — the list is correct again after this.
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

    /** A step: show loading, ask, record the result, or show an error. */
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
