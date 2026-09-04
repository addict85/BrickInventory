package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch


/**
 * Server-Setup, Login (Passwort + QR) und Logout.
 *
 * Feature-Modul des MainViewModel: Die Funktionen sind Extension-
 * Functions auf dem VM — die Körper sind 1:1 aus MainViewModel.kt
 * verschoben und greifen über internal-Sichtbarkeit auf die geteilten
 * Flows (_state, _snackbar, …) zu. Aufrufer (Screens/Navigation)
 * bleiben unverändert: vm.funktion() löst die Extension auf.
 */

// ── Server Setup ─────────────────────────────────────────────────────────
internal fun MainViewModel.saveServerUrl(url: String) {
    viewModelScope.launch {
        prefs.saveServerUrl(url)
    }
}

// ── Auth ─────────────────────────────────────────────────────────────────
internal fun MainViewModel.login(username: String, password: String) {
    viewModelScope.launch {
        _state.update { it.copy(loginLaeuft = true, loginError = null) }
        val url = prefs.serverUrl.first()
        when (val r = repo.admin.login(url, username, password)) {
            is Result.Success -> {
                if (r.data.success && r.data.token != null) {
                    prefs.saveAuthToken(r.data.token)
                    prefs.saveUsername(r.data.user?.username ?: username)
                    // Jede Anmeldung beginnt mit „Alle Konten" (Nachtrag 46):
                    // Der Kontofilter überlebte sonst das Abmelden, und die
                    // Sammlung sah beim nächsten Login halbiert aus, ohne dass
                    // etwas auf den Filter hinwies. Dieselbe Regel wie in der
                    // Webapp.
                    ch.brickinventoryapp.data.ScopeFilter.resetAll(ctx)
                    _state.update { it.copy(loginLaeuft = false, isLoggedIn = true, isAdmin = r.data.user?.isAdmin == true) }
                    loadDashboard()
                } else {
                    _state.update { it.copy(loginLaeuft = false, loginError = r.data.error ?: text(R.string.err_login_failed)) }
                }
            }
            is Result.Error -> _state.update { it.copy(loginLaeuft = false, loginError = meldung(r)) }
        }
    }
}

internal fun MainViewModel.loginWithQrToken(serverUrl: String, token: String) {
    viewModelScope.launch {
        _state.update { it.copy(loginLaeuft = true, loginError = null) }
        // Save server URL first so Retrofit uses it for this call
        prefs.saveServerUrl(serverUrl.trim().trimEnd('/'))
        when (val r = repo.admin.qrLogin(token)) {
            is Result.Success -> {
                if (r.data.success && r.data.token != null) {
                    prefs.saveAuthToken(r.data.token)
                    prefs.saveUsername(r.data.user?.username ?: "")
                    // Auch der QR-Login ist eine Anmeldung (Nachtrag 46).
                    ch.brickinventoryapp.data.ScopeFilter.resetAll(ctx)
                    _state.update { it.copy(loginLaeuft = false, isLoggedIn = true, isAdmin = r.data.user?.isAdmin == true) }
                    loadDashboard()
                } else {
                    _state.update { it.copy(loginLaeuft = false, loginError = r.data.error ?: text(R.string.err_qr_login_failed)) }
                }
            }
            is Result.Error -> _state.update { it.copy(loginLaeuft = false, loginError = meldung(r)) }
        }
    }
}

/**
 * @OptIn für ImageLoader.diskCache: Coil markiert den Plattencache-Zugriff als
 * @ExperimentalCoilApi. Bewusst nur HIER und nicht auf Modulebene — so fällt
 * beim nächsten Coil-Update auf, wenn sich an dieser einen Stelle etwas
 * ändert, statt dass eine breite Freigabe künftige Warnungen im ganzen
 * Modul verschluckt.
 */
@OptIn(coil.annotation.ExperimentalCoilApi::class)
// ── Konto anlegen und Passwort vergessen ─────────────────────────────────
//
// Beides braucht KEINE Anmeldung und laeuft deshalb ueber eigene Felder
// (kontoLaeuft/kontoFehler/kontoMeldung) statt ueber loginLaeuft/loginError.
// Sonst haetten zwei Formulare denselben Fehlerplatz — genau die Verwechslung,
// wegen der `error` einmal in `loginError` umbenannt wurde (siehe UiState).

/**
 * Steht die Registrierung offen? Einmal beim Aufbau des Anmeldebildschirms.
 *
 * Bei einem Fehler bleibt das Feld auf `null` und der Link damit VERBORGEN.
 * Das ist die vorsichtige Seite: Ein Server, der die Frage nicht beantwortet,
 * beantwortet auch die Registrierung nicht — und ein Knopf, der ins Leere
 * fuehrt, ist schlechter als keiner. Die Webapp macht es genauso
 * (`catch(_){}` um checkRegistrationEnabled).
 */
internal fun MainViewModel.pruefeRegistrierungOffen() {
    viewModelScope.launch {
        when (val r = repo.admin.getRegistrationStatus()) {
            is Result.Success -> _state.update { it.copy(registrierungOffen = r.data.enabled) }
            is Result.Error   -> Unit
        }
    }
}

/** Zwischen Anmelden, Registrieren und „Passwort vergessen" umschalten. */
internal fun MainViewModel.zeigeAnmeldeFormular(formular: AnmeldeFormular) {
    // Meldung UND Fehler gehen mit: Sonst stuende die Erfolgsmeldung der
    // Registrierung noch im Formular „Passwort vergessen".
    _state.update { it.copy(anmeldeFormular = formular, kontoMeldung = null, kontoFehler = null) }
}

internal fun MainViewModel.registriere(
    username: String, email: String, vorname: String, nachname: String, passwort: String,
) {
    viewModelScope.launch {
        _state.update { it.copy(kontoLaeuft = true, kontoFehler = null, kontoMeldung = null) }
        val anfrage = RegisterRequest(
            username = username.trim(),
            email = email.trim(),
            // Leer bedeutet „nicht angegeben", nicht „leerer Vorname": Der
            // Server nimmt null und traegt dann gar nichts ein.
            firstName = vorname.trim().ifBlank { null },
            lastName = nachname.trim().ifBlank { null },
            password = passwort,
            // Die Sprache, die die Oberflaeche GERADE zeigt — aus den
            // Ressourcen, nicht aus einer eigenen Ermittlung. Steuert die
            // Sprache der Bestaetigungs-E-Mail und die Nutzereinstellung des
            // neuen Kontos (routes/auth.ts schreibt sie in user_settings).
            language = text(R.string.lang_code),
        )
        when (val r = repo.admin.register(anfrage)) {
            is Result.Success ->
                if (r.data.success) {
                    // Der SATZ DES SERVERS, plus der Konsolen-Hinweis, wenn
                    // kein Mailversand eingerichtet ist. Ohne den wartet man
                    // auf eine E-Mail, die nie kommt.
                    val hinweis = if (r.data.consoleMode) " " + text(R.string.register_console_hint) else ""
                    _state.update { it.copy(
                        kontoLaeuft = false,
                        kontoMeldung = (r.data.message ?: text(R.string.register_done)) + hinweis) }
                } else {
                    _state.update { it.copy(kontoLaeuft = false,
                        kontoFehler = r.data.error ?: text(R.string.err_generic)) }
                }
            is Result.Error -> _state.update { it.copy(kontoLaeuft = false, kontoFehler = meldung(r)) }
        }
    }
}

/**
 * Einen Link zum Zuruecksetzen anfordern.
 *
 * Die Antwort des Servers ist ABSICHTLICH immer dieselbe, egal ob es die
 * Adresse gibt. Deshalb wird sie unveraendert angezeigt und NICHT in ein
 * eigenes „erfolgreich" uebersetzt — sonst verriete die App, was der Server
 * gerade verschweigt.
 */
internal fun MainViewModel.passwortVergessen(email: String) {
    viewModelScope.launch {
        _state.update { it.copy(kontoLaeuft = true, kontoFehler = null, kontoMeldung = null) }
        when (val r = repo.admin.forgotPassword(email.trim())) {
            is Result.Success -> _state.update { it.copy(
                kontoLaeuft = false,
                kontoMeldung = r.data.message ?: text(R.string.forgot_done)) }
            is Result.Error -> _state.update { it.copy(kontoLaeuft = false, kontoFehler = meldung(r)) }
        }
    }
}

internal fun MainViewModel.logout() {
    csvWatchJob?.cancel(); csvWatchJob = null
    viewModelScope.launch {
        prefs.clearSession()
        // Der Plattenspeicher enthält Sets, Teile und Minifiguren des
        // abgemeldeten Kontos — beim Abmelden mit wegräumen, sonst sähe der
        // nächste Nutzer auf demselben Gerät fremde Daten, bis der erste
        // Abruf durch ist.
        repo.clearCache()
        // Gleiche Begründung für die Bilder: Die Thumbnails des abgemeldeten
        // Kontos lagen bisher weiter im Coil-Cache, obwohl der API-Cache
        // geleert wurde. Memory-Cache zuerst, sonst schreibt Coil beim
        // nächsten Treffer sofort wieder auf die Platte.
        try {
            imageLoader.memoryCache?.clear()
            imageLoader.diskCache?.clear()
        } catch (_: Exception) { /* Best effort — darf das Abmelden nie verhindern */ }
        _state.update { AppUiState(serverUrl = _state.value.serverUrl) }
        // Die herausgelösten Flows gehören zum selben Konto und müssen
        // mit zurückgesetzt werden — sonst zeigt der nächste Nutzer auf
        // demselben Gerät noch fremde Teile und Bewertungen.
        // Die Galerie gehoert dazu, seit sie einen eigenen Fluss hat: Ohne
        // diese Zeile zeigte der naechste Nutzer auf demselben Geraet noch
        // die Sets und Kennzahlen des vorigen.
        _galleryState.value = GalleryUiState()
        _partsState.value = PartsUiState()
        _financeState.value = FinanceUiState()
        _csvImportState.value = CsvImportUiState()
        // Auch der Scanner-Zustand (Nachtrag 117): Ein offener Barcode-Dialog
        // trägt Setname, Bild und Nummer des VORIGEN Kontos. Ohne diese Zeile
        // stünde er nach dem Abmelden noch da — genau der Fall, den die drei
        // Zeilen darüber schon abdecken.
        _barcodeState.value = BarcodeUiState()
        // Und die Prüfanzeige, aus demselben Grund — sie nennt die Setnummer
        // des vorigen Kontos und liesse sich nach dem Abmelden nicht mehr
        // wegklicken: Der Abbrechen-Knopf sitzt im Dialog selbst, und der läge
        // dann über dem Anmeldebildschirm. Der laufende Abruf wird mit
        // abgebrochen, nicht nur ausgeblendet.
        brichPruefungAb()
    }
}
