package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

/**
 * Das Server-Protokoll — was ein Verwalter nachsehen kann.
 *
 * ── Warum die App das erst jetzt kann (Nachtrag 127) ────────────────────────
 *
 * Nicht, weil es fehlte: /admin/logs gibt es seit jeher, und die Webapp
 * benutzt es. Die Route lag hinter einem requireAdmin, das ausschliesslich die
 * Browser-Sitzung kannte — die App weist sich mit einem Bearer-Token aus und
 * bekam ein 401. Seit beide Waechter dieselbe Frage stellen, ist es ein
 * normaler Aufruf.
 *
 * ── Was hier NICHT steht (Nachtrag 129) ─────────────────────────────────────
 *
 * Die Nutzerverwaltung. Sie war gebaut — Konten anlegen, Rolle setzen,
 * Passwort setzen, Konto entfernen — und ist auf Marcos Entscheidung wieder
 * entfernt worden: Sie gehoert an den Rechner, nicht auf ein Telefon. Der
 * Server kann sie weiterhin, die Webapp bietet sie an; die App tut es nicht.
 * Das ist kein Versehen und keine Luecke, sondern eine Wahl.
 *
 * Feature-Modul des MainViewModel wie die uebrigen *Feature.kt-Dateien.
 */

/**
 * Das Server-Protokoll holen.
 *
 * Die Zeitspanne bleibt im Zustand stehen, damit ein Neuladen dieselbe Spanne
 * holt — sonst spraenge die Ansicht bei jedem Antippen auf die Vorgabe zurueck.
 * Der Server begrenzt selbst auf 2880 Minuten und 5000 Zeilen.
 */
internal fun MainViewModel.ladeProtokoll(minuten: Int = _verwaltungState.value.protokollMinuten) {
    viewModelScope.launch {
        _verwaltungState.update { it.copy(protokollLaden = true, protokollMinuten = minuten, fehler = null) }
        when (val r = repo.admin.getProtokoll(minuten)) {
            is Result.Success -> _verwaltungState.update {
                it.copy(protokollLaden = false, protokoll = r.data.logs,
                        fehler = if (r.data.success) null else r.data.error) }
            is Result.Error -> _verwaltungState.update {
                it.copy(protokollLaden = false, fehler = meldung(r)) }
        }
    }
}
