package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Angemeldete Geraete: auflisten und aussperren.
 *
 * ── Warum es das gibt ───────────────────────────────────────────────────────
 * Die Endpunkte /api/v1/settings/tokens gab es schon, einen Weg dorthin
 * nicht — in keiner der beiden Apps. Ein verlorenes oder verkauftes Telefon
 * war damit nur loszuwerden, indem man das Passwort aendert; das verwirft
 * ALLE Zugaenge. Wer nur eines aussperren wollte, sperrte alle aus.
 *
 * Gegenstueck zur Webapp-Seite unter „Angemeldete Geraete" in den
 * Einstellungen. Beide zeigen dasselbe in derselben Reihenfolge und holen es
 * von derselben Adresse.
 *
 * ── Warum der eigene Zugang nicht loeschbar ist ─────────────────────────────
 * Der Server markiert die Zeile, mit der GERADE gefragt wird (`aktuell`). Wer
 * sie entwertet, meldet sich selbst ab, ohne dass der Knopf das sagt. Fuer
 * „dieses Geraet abmelden" gibt es den Abmelden-Knopf darunter; er benennt,
 * was er tut.
 *
 * Feature-Modul des MainViewModel — siehe die uebrigen *Feature.kt.
 */

internal fun MainViewModel.ladeGeraete() {
    viewModelScope.launch {
        _geraeteState.update { it.copy(laedt = true, fehler = null) }
        when (val r = repo.admin.getTokens()) {
            is Result.Success ->
                if (r.data.success) _geraeteState.update {
                    it.copy(laedt = false, geraete = r.data.tokens, fehler = null)
                }
                else _geraeteState.update { it.copy(laedt = false, fehler = r.data.error) }
            is Result.Error -> _geraeteState.update { it.copy(laedt = false, fehler = meldung(r)) }
        }
    }
}

internal fun MainViewModel.entwerteGeraet(tokenId: String) {
    viewModelScope.launch {
        _geraeteState.update { it.copy(laedt = true, fehler = null) }
        when (val r = repo.admin.revokeToken(tokenId)) {
            is Result.Success -> {
                _snackbar.value = text(R.string.tokens_revoked)
                // Neu laden statt die Zeile lokal zu entfernen: Der Server ist
                // die Wahrheit, und ein zweites Geraet kann inzwischen eines
                // dazugelegt haben.
                ladeGeraete()
            }
            is Result.Error -> _geraeteState.update { it.copy(laedt = false, fehler = meldung(r)) }
        }
    }
}

/**
 * Alle Zugaenge ausser dem eigenen entwerten.
 *
 * Nacheinander ueber den bestehenden Endpunkt, statt dafuer einen neuen zu
 * bauen: Es sind eine Handvoll Zeilen, und eine zweite Adresse fuer
 * „dasselbe, nur mehrfach" waere genau die Art Doppelung, die dieses Projekt
 * sonst abbaut. Die Webapp macht es an derselben Stelle genauso.
 *
 * Ist der eigene Zugang NICHT in der Liste, wird nichts getan: Dann liesse
 * sich nicht sagen, welche die „anderen" sind, und der Griff wuerde das
 * eigene Geraet mit abmelden.
 */
internal fun MainViewModel.entwerteAndereGeraete() {
    viewModelScope.launch {
        val liste = _geraeteState.value.geraete
        if (liste.none { it.aktuell }) {
            _geraeteState.update { it.copy(fehler = text(R.string.tokens_self_unknown)) }
            return@launch
        }
        val andere = liste.filter { !it.aktuell }
        if (andere.isEmpty()) { _snackbar.value = text(R.string.tokens_no_others); return@launch }
        _geraeteState.update { it.copy(laedt = true, fehler = null) }
        var weg = 0
        for (g in andere) if (repo.admin.revokeToken(g.tokenId) is Result.Success) weg++
        _snackbar.value = text(R.string.tokens_revoked_n, weg)
        ladeGeraete()
    }
}
