package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch


/** Abmelden und das Laden nach dem Anmelden — bis zum AppViewModel. */

/**
 * @OptIn für ImageLoader.diskCache: Coil markiert den Plattencache-Zugriff als
 * experimentell. Bewusst nur hier und nicht auf Modulebene, damit eine Änderung
 * an dieser einen Stelle beim nächsten Coil-Update auffällt.
 */
@OptIn(coil3.annotation.ExperimentalCoilApi::class)
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
        sitzung.abgemeldet()
        blickfeldDienst.zuruecksetzen()
        // Die herausgelösten Flows gehören zum selben Konto und müssen
        // mit zurückgesetzt werden — sonst zeigt der nächste Nutzer auf
        // demselben Gerät noch fremde Teile und Bewertungen.
        // Die Galerie gehoert dazu, seit sie einen eigenen Fluss hat: Ohne
        // diese Zeile zeigte der naechste Nutzer auf demselben Geraet noch
        // die Sets und Kennzahlen des vorigen.
        //
        // ── ALLE, nicht eine Auswahl (Nachtrag 129) ──────────────────────
        //
        // Hier standen fuenf von fuenfzehn Fluessen. Die zehn uebrigen trugen
        // nach dem Abmelden weiter die Daten des vorigen Kontos — und drei
        // davon sind mehr als eine Unschoenheit:
        //
        //     _householdState   die Mitglieder des fremden Haushalts
        //
        // Konto, Geraete und zweiter Faktor stehen im KontoViewModel, das mit
        // der Konto-Seite verschwindet.
        //
        // Der Kommentar darueber sagt seit jeher, warum das nicht sein darf.
        // Er galt nur fuer die Haelfte. Gefunden beim Entfernen der
        // Nutzerverwaltung, nicht von einer Pruefung — deshalb prueft
        // felder.py das jetzt: Jeder Fluss des MainViewModel muss hier stehen.
        _csvImportState.value = CsvImportUiState()
    }
}

/** Nach dem Anmelden: Filter, Konten und Orte; die Bereiche laden ihre Listen selbst. */
internal fun MainViewModel.loadDashboard() {
    _csvImportState.value = CsvImportUiState()
    loadScopeModes()
    loadHouseholdMembers()
    loadLagerorte()
    ladeEigeneLagerorte()
    bestand.melde(Aenderung.Sets)
}
