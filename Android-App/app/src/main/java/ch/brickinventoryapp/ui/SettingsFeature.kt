package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.core.database.getStringOrNull


/**
 * Einstellungen: Laden, Sprache (per-App-Locale) und Speichern
 * (Währung/Zustand) — Feature-Modul des MainViewModel, siehe README
 * in den anderen *Feature.kt-Dateien.
 */

internal fun MainViewModel.loadSettings() {
    viewModelScope.launch {
        when (val r = repo.admin.getSettings()) {
            is Result.Success -> {
                _state.update { it.copy(
                    currency = r.data.settings.currency,
                    priceCondition = r.data.settings.priceCondition,
                    defaultPriceCondition = r.data.settings.defaultPriceCondition,
                    userDefaultCondition = r.data.settings.effectiveCondition, // server-resolved effective value
                    appTheme = r.data.settings.appTheme
                )}
                // Merken, damit der naechste Kaltstart schon im richtigen
                // Design anfaengt — siehe PreferencesManager.APP_THEME.
                //
                // IM Zweig und nicht dahinter: `r` gehoert zum `when` und ist
                // danach nicht mehr da (Lauf 110). Ausserdem ist Result.Success
                // generisch — ein `as? Result.Success` ohne Typargument
                // uebersetzt gar nicht.
                prefs.saveAppTheme(r.data.settings.appTheme)
            }
            is Result.Error -> {}
        }
    }
}

/**
 * Das globale Design holen, BEVOR jemand angemeldet ist.
 *
 * ── Warum es das gibt (Nachtrag 135) ────────────────────────────────────────
 *
 * `app_theme` kam bisher nur mit /settings, also erst nach der Anmeldung.
 * Anmelde- und Einrichtungsbildschirm erschienen dadurch bei jedem Kaltstart im
 * Standard-Design und sprangen nach dem Anmelden um.
 *
 * Zwei Stufen, wie in der Webapp (00-theme-boot.js):
 *
 *   1. Sofort beim Start der gemerkte Wert — kein Netz, kein Aufblitzen.
 *      Das erledigt MainViewModel beim Anlegen.
 *   2. Gleich danach diese Abfrage. Weicht der Serverwert ab — ein anderes
 *      Geraet, der Verwalter hat gerade umgestellt —, wird korrigiert.
 *
 * Ohne Servaradresse gar nichts: Vor der Einrichtung gibt es keinen Server,
 * den man fragen koennte.
 *
 * Bewusst ohne Meldung im Fehlerfall: Es bleibt beim gemerkten Design, und das
 * ist genau das richtige Verhalten. Eine Fehlermeldung ueber ein Design waere
 * beim Anmelden nur im Weg.
 */
/**
 * Den Startzustand des Servers verfolgen, bis er fertig ist.
 *
 * ── Warum eine Schleife und kein Zeitlimit (Nachtrag 136) ───────────────────
 *
 * Der erste Start einer Neuinstallation kann viele Minuten dauern. Ein
 * Zeitlimit waere deshalb falsch — die Webapp sagt das in ihrem eigenen
 * Kommentar (01-core.js) und bricht nur ab, wenn sich der Fortschritt lange
 * gar nicht mehr aendert.
 *
 * Hier einfacher, weil die App die Anzeige nicht blockiert: Solange der Server
 * ANTWORTET und `ready` falsch meldet, wird weiter gefragt. Antwortet er gar
 * nicht — kein Server, falsche Adresse, kein Netz —, hoert die Schleife auf und
 * es bleibt bei der gewoehnlichen Netzmeldung. Genau die ist dann ja richtig.
 *
 * Zwei Sekunden statt der 600 ms der Webapp: Ein Telefon soll dabei nicht
 * unnoetig funken, und der Balken bewegt sich in Minuten, nicht in Sekunden.
 */
internal fun MainViewModel.verfolgeServerstart() {
    viewModelScope.launch {
        if (prefs.serverUrl.first().isBlank()) return@launch
        while (true) {
            when (val r = repo.admin.getStartupStatus()) {
                is Result.Success -> {
                    if (r.data.ready) {
                        // Fertig: Feld leeren, damit die Anmeldung wieder das
                        // Formular zeigt, und aufhoeren.
                        _state.update { it.copy(startupStatus = null) }
                        return@launch
                    }
                    _state.update { it.copy(startupStatus = r.data) }
                }
                // Keine Antwort heisst NICHT „startet gerade": Dann ist der
                // Server nicht erreichbar, und die gewoehnliche Meldung ist die
                // richtige. Feld leeren und aufhoeren.
                is Result.Error -> {
                    _state.update { it.copy(startupStatus = null) }
                    return@launch
                }
            }
            kotlinx.coroutines.delay(2000)
        }
    }
}

internal fun MainViewModel.loadAppTheme() {
    viewModelScope.launch {
        if (prefs.serverUrl.first().isBlank()) return@launch
        when (val r = repo.admin.getAppTheme()) {
            is Result.Success -> if (r.data.success) {
                _state.update { it.copy(appTheme = r.data.theme) }
                prefs.saveAppTheme(r.data.theme)
            }
            is Result.Error -> {}
        }
    }
}

internal fun MainViewModel.setLanguage(languageCode: String) {
    viewModelScope.launch {
        prefs.saveLanguage(languageCode)
        ch.brickinventoryapp.util.LanguageManager.applyLanguage(languageCode)
    }
}

internal fun MainViewModel.saveSettings(currency: String, condition: String) {
    viewModelScope.launch {
        when (val r = repo.admin.updateSettings(currency, condition)) {
            is Result.Success -> {
                _snackbar.value = text(ch.brickinventoryapp.R.string.vm_settings_saved)
                _state.update { it.copy(currency = currency, priceCondition = condition) }
                // Währung und Preiszustand bestimmen, welche Preise der Server
                // liefert. Ohne Nachladen zeigte die App die alten Werte mit dem
                // NEUEN Währungszeichen — also schlicht falsche Beträge, bis der
                // jeweilige Reiter neu geöffnet wurde.
                loadSets()
                loadValuation()
                loadStats()
            }
            is Result.Error -> _snackbar.value = meldung(r)
        }
    }
}

internal fun MainViewModel.saveUserDefaultCondition(condition: String) {
    viewModelScope.launch {
        when (val r = repo.teile.setUserDefaultCondition(condition)) {
            is Result.Success -> loadSettings() // effective default in State aktualisieren
            is Result.Error   -> _snackbar.value = text(R.string.vm_error, meldung(r))
        }
    }
}

// ── CSV hochladen ────────────────────────────────────────────────────────
//
// Die App konnte CSV-Importe bisher nur beobachten. Jetzt startet sie welche —
// dieselben drei Adressen, die die Webapp anbietet.

/**
 * Wie gross eine CSV-Datei sein darf.
 *
 * Derselbe Wert wie CSV_MAX_BYTES in utils/dateiEmpfang.ts auf dem Server. Er
 * steht hier ein zweites Mal, und das ist eine bewusste Ausnahme: Die App muss
 * die Grenze kennen, BEVOR sie 20 MB durch ein Mobilfunknetz schickt, um dann
 * eine Absage zu bekommen. Die Alternative — die Grenze beim Server erfragen —
 * waere ein zusaetzlicher Abruf fuer eine Zahl, die sich nie aendert.
 * Auseinanderlaufen kann sie trotzdem; deshalb steht der Name der Serverdatei
 * hier, damit man beim Aendern beide findet.
 */
internal const val CSV_MAX_BYTES = 15L * 1024 * 1024

/**
 * Eine gewaehlte Datei einlesen und hochladen.
 *
 * Der Uri wird HIER aufgeloest und nicht im Repository: Dafuer braucht es den
 * ContentResolver, und ein Repository, das Android-Typen kennt, waere in diesem
 * Baum die Ausnahme.
 */
internal fun MainViewModel.ladeCsvHoch(art: ch.brickinventoryapp.data.model.CsvArt, uri: android.net.Uri) {
    viewModelScope.launch {
        _csvHochladenState.value = CsvHochladenUiState(laeuft = true, art = art)
        val gelesen = withContext(kotlinx.coroutines.Dispatchers.IO) {
            runCatching {
                val name = dateiname(uri)
                val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                if (bytes == null) null else name to bytes
            }.getOrNull()
        }
        if (gelesen == null) {
            _csvHochladenState.value = CsvHochladenUiState(fehler = text(R.string.csv_upload_unreadable))
            return@launch
        }
        val (name, bytes) = gelesen
        // VOR dem Senden pruefen, nicht danach: Ein Mobilfunknetz mit 20 MB zu
        // belasten, um dann eine Absage zu lesen, ist der teuerste Weg zur
        // selben Auskunft.
        if (bytes.size > CSV_MAX_BYTES) {
            _csvHochladenState.value = CsvHochladenUiState(
                fehler = text(R.string.csv_upload_too_big, CSV_MAX_BYTES / 1024 / 1024))
            return@launch
        }
        when (val r = repo.admin.importiereCsv(art, name, bytes)) {
            is Result.Success ->
                if (r.data.success) {
                    _csvHochladenState.value = CsvHochladenUiState(ergebnis = r.data)
                    // Der Bestand hat sich geaendert — dieselben Nachladungen
                    // wie am Ende eines vom Server gemeldeten Imports.
                    loadSets(); loadStats()
                } else {
                    _csvHochladenState.value = CsvHochladenUiState(
                        fehler = r.data.error ?: text(R.string.err_generic))
                }
            is Result.Error -> _csvHochladenState.value = CsvHochladenUiState(fehler = meldung(r))
        }
    }
}

/** Das Ergebnis wegklicken. */
internal fun MainViewModel.csvHochladenWeg() { _csvHochladenState.value = CsvHochladenUiState() }

/**
 * Der Anzeigename einer gewaehlten Datei.
 *
 * Er geht mit hoch, damit im Serverprotokoll steht, WAS importiert wurde. Ein
 * content://-Uri traegt den Namen nicht im Pfad; er steht in den Metadaten des
 * Anbieters. Faellt das aus, tut ein neutraler Name es auch — der Import haengt
 * nicht am Namen.
 */
private fun MainViewModel.dateiname(uri: android.net.Uri): String =
    runCatching {
        ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val i = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            // getStringOrNull statt getString: nicht aus Vorsicht vor einer
            // NULL-Spalte, sondern weil SpracheDerMeldungenTest jedes
            // `x.getString(` als Textressource liest, die ueber
            // localizedContext laufen muss. Hier ist `c` ein Cursor und kein
            // Context — die Regel trifft nicht zu, aber ihr auszuweichen ist
            // richtiger, als sie fuer diesen einen Fall aufzuweichen. Der
            // Ausweichweg ist ohnehin der bessere: Er behandelt die leere
            // Spalte, statt sie zu unterstellen.
            if (i >= 0 && c.moveToFirst()) c.getStringOrNull(i) else null
        }
    }.getOrNull() ?: "import.csv"
