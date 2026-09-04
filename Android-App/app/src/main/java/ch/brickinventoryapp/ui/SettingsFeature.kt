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
            is Result.Success -> _state.update { it.copy(
                currency = r.data.settings.currency,
                priceCondition = r.data.settings.priceCondition,
                defaultPriceCondition = r.data.settings.defaultPriceCondition,
                userDefaultCondition = r.data.settings.effectiveCondition, // server-resolved effective value
                appTheme = r.data.settings.appTheme
            )}
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

// ── Sicherung der Einstellungen ──────────────────────────────────────────
//
// Die Webapp kann das seit jeher; die App war ausgesperrt (Nachtrag 127).
//
// Die Datei enthaelt AUSDRUECKLICH keine Zugangsschluessel — der Server siebt
// sie aus, weil eine Sicherung weitergeschickt und abgelegt wird. Wer
// wiederherstellt, traegt die Schluessel einmal neu ein.

/**
 * Die Sicherung holen und in eine vom Nutzer gewaehlte Datei schreiben.
 *
 * Der Zielort kommt aus dem Systemvertrag; die App bekommt einen Uri und
 * schreibt hinein. Sie legt NICHTS in ihrem eigenen Speicher ab: Eine
 * Sicherung, die mit der App verschwindet, ist keine.
 */
internal fun MainViewModel.sichereEinstellungen(ziel: android.net.Uri) {
    viewModelScope.launch {
        when (val r = repo.admin.exportEinstellungen()) {
            is Result.Success -> {
                val ok = withContext(kotlinx.coroutines.Dispatchers.IO) {
                    runCatching {
                        ctx.contentResolver.openOutputStream(ziel)?.use { it.write(r.data) } != null
                    }.getOrDefault(false)
                }
                _snackbar.value =
                    if (ok) text(R.string.backup_saved) else text(R.string.backup_write_failed)
            }
            is Result.Error -> _snackbar.value = meldung(r)
        }
    }
}

/**
 * Eine Sicherung einspielen.
 *
 * Der Server nimmt nur bekannte Schluessel an (feste Liste in
 * routes/settings.ts) und die globalen nur von einem Verwalter. Was er
 * uebernommen hat, sagt seine Antwort — deshalb steht sie unveraendert im
 * Snackbar, statt hier zu einem eigenen „erfolgreich" zu werden.
 */
internal fun MainViewModel.spieleEinstellungenEin(quelle: android.net.Uri) {
    viewModelScope.launch {
        val gelesen = withContext(kotlinx.coroutines.Dispatchers.IO) {
            runCatching { ctx.contentResolver.openInputStream(quelle)?.use { it.readBytes() } }
                .getOrNull()
        }
        if (gelesen == null) { _snackbar.value = text(R.string.csv_upload_unreadable); return@launch }
        when (val r = repo.admin.importEinstellungen("brickinventory-config.json", gelesen)) {
            is Result.Success ->
                if (r.data.success) {
                    _snackbar.value = text(R.string.backup_restored)
                    // Die Einstellungen neu holen: Waehrung und Zustand koennen
                    // sich soeben geaendert haben, und die Karte darueber zeigt
                    // sonst noch die alten.
                    loadSettings()
                } else _snackbar.value = r.data.error ?: text(R.string.err_generic)
            is Result.Error -> _snackbar.value = meldung(r)
        }
    }
}
