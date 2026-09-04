package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

/**
 * Nutzerverwaltung und Server-Protokoll — was ein Verwalter tun kann.
 *
 * ── Warum die App das erst jetzt kann (Nachtrag 127) ────────────────────────
 *
 * Nicht, weil es fehlte: /auth/users und /admin/logs gibt es seit jeher, und
 * die Webapp benutzt beide. Sie lagen hinter einem requireAdmin, das
 * ausschliesslich die Browser-Sitzung kannte — die App weist sich mit einem
 * Bearer-Token aus und bekam ein 401. Seit beide Waechter dieselbe Frage
 * stellen, sind es normale Aufrufe.
 *
 * Feature-Modul des MainViewModel wie die uebrigen *Feature.kt-Dateien.
 */

internal fun MainViewModel.ladeKonten() {
    viewModelScope.launch {
        _verwaltungState.update { it.copy(kontenLaden = true, fehler = null) }
        when (val r = repo.admin.getKonten()) {
            is Result.Success -> _verwaltungState.update {
                it.copy(kontenLaden = false, konten = r.data.users,
                        fehler = if (r.data.success) null else r.data.error) }
            is Result.Error -> _verwaltungState.update {
                it.copy(kontenLaden = false, fehler = meldung(r)) }
        }
    }
}

/**
 * Eine Aenderung an einem Konto ausfuehren und die Liste neu holen.
 *
 * Alle vier Wege (anlegen, Rolle setzen, Passwort setzen, loeschen) enden
 * gleich: Die Antwort sagt, ob es geklappt hat, und danach ist die Liste
 * veraltet. Das einmal zu schreiben ist richtiger, als es viermal fast gleich
 * zu haben — genau die Form, die in diesem Baum wiederholt auseinandergelaufen
 * ist.
 */
private fun MainViewModel.kontoAenderung(
    erfolgstext: Int, aufruf: suspend () -> Result<GenericResponse>,
) {
    viewModelScope.launch {
        when (val r = aufruf()) {
            is Result.Success ->
                if (r.data.success) { _snackbar.value = text(erfolgstext); ladeKonten() }
                else _snackbar.value = r.data.error ?: text(R.string.err_generic)
            is Result.Error -> _snackbar.value = meldung(r)
        }
    }
}

internal fun MainViewModel.legeKontoAn(name: String, passwort: String, verwalter: Boolean) =
    kontoAenderung(R.string.admin_user_created) { repo.admin.createKonto(name, passwort, verwalter) }

internal fun MainViewModel.setzeVerwalterrolle(id: Int, verwalter: Boolean) =
    kontoAenderung(R.string.admin_user_saved) { repo.admin.setzeVerwalter(id, verwalter) }

internal fun MainViewModel.setzeFremdesPasswort(id: Int, passwort: String) =
    kontoAenderung(R.string.admin_user_saved) { repo.admin.setzeFremdesPasswort(id, passwort) }

internal fun MainViewModel.loescheKonto(id: Int) =
    kontoAenderung(R.string.admin_user_deleted) { repo.admin.loescheKonto(id) }

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
