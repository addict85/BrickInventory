package ch.brickinventoryapp.teile.ui.screens

import ch.brickinventoryapp.teile.ui.viewmodel.TeileAktionen
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.teile.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.zustand.ui.*
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.ui.model.LagerortAnsicht
import ch.brickinventoryapp.model.ui.model.MitgliedAnsicht
import ch.brickinventoryapp.gemeinsam.ui.AnsichtAbschnitt
import ch.brickinventoryapp.gemeinsam.ui.FilterAbschnitt
import ch.brickinventoryapp.gemeinsam.ui.FilterBlattRahmen
import ch.brickinventoryapp.gemeinsam.ui.FilterWahl
import ch.brickinventoryapp.gemeinsam.ui.KontoFilterAbschnitt
import ch.brickinventoryapp.gemeinsam.ui.LagerortFilterAbschnitt

/** Das Filterblatt der Teile: Konto, Lagerort, Ersatzteile, Farbe und Kategorie, Ansicht. */
@Composable
internal fun TeileFilterBlatt(
    aktionen: TeileAktionen,
    partsState: PartsUiState,
    householdMembers: List<MitgliedAnsicht>,
    scopeMode: String,
    onScopeChange: (String) -> Unit,
    lagerorte: List<LagerortAnsicht>,
    lagerModus: String,
    onLagerChange: (String) -> Unit,
    farbEintraege: List<TeileFilterEintrag>,
    kategorieEintraege: List<TeileFilterEintrag>,
    onSchliessen: () -> Unit,
) {
    val ersatz = partsState.partsSpare
    val farbe = partsState.partsColorFilter
    val kategorie = partsState.partsCategoryFilter
    // Nur zurücksetzen, was abweicht: Jede Änderung lädt die Liste neu.
    val zuruecksetzen: () -> Unit = {
        if (Filterzahl.konto(householdMembers, scopeMode) > 0) onScopeChange(ScopeFilter.ALL)
        if (Filterzahl.lager(lagerorte, lagerModus) > 0) onLagerChange("")
        if (ersatz.isNotBlank()) aktionen.setPartsSpare("")
        if (farbe.isNotBlank()) aktionen.setPartsColorFilter("")
        if (kategorie.isNotBlank()) aktionen.setPartsCategoryFilter("")
    }
    val aktiv = Filterzahl.teile(householdMembers, scopeMode, lagerorte, lagerModus, ersatz, farbe, kategorie)
    FilterBlattRahmen(onSchliessen = onSchliessen, onZuruecksetzen = zuruecksetzen.takeIf { aktiv > 0 }) {
        KontoFilterAbschnitt(householdMembers, scopeMode, onScopeChange)
        LagerortFilterAbschnitt(lagerorte, lagerModus, onLagerChange, nachTeilen = true)
        // Ersatzteile — dieselben drei Werte wie parts-spare in der Webapp,
        // gefiltert auf dem SERVER (partsSpare im Zustand).
        FilterAbschnitt(stringResource(R.string.filter_section_spare)) {
            for ((wert, text) in listOf(
                "" to R.string.parts_filter_all,
                "0" to R.string.parts_filter_no_spare,
                "1" to R.string.parts_filter_spare,
            )) {
                FilterWahl(stringResource(text), ersatz == wert) { aktionen.setPartsSpare(wert) }
            }
        }
        if (farbEintraege.isNotEmpty() || kategorieEintraege.isNotEmpty()) {
            FilterAbschnitt(stringResource(R.string.filter_section_color_category)) {
                TeileFilterZeile(
                    farben = farbEintraege,
                    kategorien = kategorieEintraege,
                    farbeGewaehlt = farbe,
                    kategorieGewaehlt = kategorie,
                    onFarbe = { aktionen.setPartsColorFilter(it) },
                    onKategorie = { aktionen.setPartsCategoryFilter(it) },
                )
            }
        }
        AnsichtAbschnitt(partsState.partsView) { aktionen.setPartsView(it) }
    }
}
