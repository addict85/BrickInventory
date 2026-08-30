package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.repository.Result

/**
 * Wiederholen, solange der Fehler vorübergehend ist.
 *
 * ── Warum das hier steht und nicht mehr im MainViewModel ────────────────────
 * Die Funktion benutzt nichts aus dem ViewModel — weder Zustand noch Repository
 * noch Context. Sie stand dort nur, weil die Feature-Erweiterungen sie als
 * Mitglied erreichen konnten.
 *
 * Als paketweite Funktion erreichen die Erweiterungen sie unverändert (Kotlin
 * bindet an das Paket), und die neuen Bildschirm-ViewModels ausserhalb von
 * `ui` können sie mit einem Import ebenso benutzen — statt sie ein zweites Mal
 * hinzuschreiben.
 *
 * Sie ist gedacht für Aufrufe beim App-Start, die an noch nicht verfügbarem
 * Netzwerk oder DNS scheitern. `transient` setzt die Datenschicht in
 * RepoBasis; hier wird nicht an der Fehlermeldung geraten.
 */
internal suspend fun <T> retryOnNetwork(
    maxAttempts: Int = 10,
    delayMs: Long = 2000,
    call: suspend () -> Result<T>
): Result<T> {
    var attempts = 0
    while (true) {
        val r = call()
        if (r is Result.Error) {
            if (r.transient && attempts < maxAttempts - 1) {
                attempts++
                kotlinx.coroutines.delay(delayMs)
                continue
            }
        }
        return r
    }
}
