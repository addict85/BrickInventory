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
        // Das Design merken, damit der nächste Kaltstart schon darin anfängt
        // (PreferencesManager.APP_THEME).
        sitzung.ladeEinstellungen(repo.admin)?.let { prefs.saveAppTheme(it) }
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
        if (prefs.serverUrlJetzt().isBlank()) return@launch
        while (true) {
            when (val r = repo.admin.getStartupStatus()) {
                is Result.Success -> {
                    if (r.data.ready) {
                        // Fertig: Feld leeren, damit die Anmeldung wieder das
                        // Formular zeigt, und aufhoeren.
                        sitzung.aendere { it.copy(startupStatus = null) }
                        return@launch
                    }
                    sitzung.aendere { it.copy(startupStatus = r.data) }
                }
                // Keine Antwort heisst NICHT „startet gerade": Dann ist der
                // Server nicht erreichbar, und die gewoehnliche Meldung ist die
                // richtige. Feld leeren und aufhoeren.
                is Result.Error -> {
                    sitzung.aendere { it.copy(startupStatus = null) }
                    return@launch
                }
            }
            kotlinx.coroutines.delay(2000)
        }
    }
}

internal fun MainViewModel.loadAppTheme() {
    viewModelScope.launch {
        if (prefs.serverUrlJetzt().isBlank()) return@launch
        when (val r = repo.admin.getAppTheme()) {
            is Result.Success -> if (r.data.success) {
                sitzung.aendere { it.copy(appTheme = r.data.theme) }
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
