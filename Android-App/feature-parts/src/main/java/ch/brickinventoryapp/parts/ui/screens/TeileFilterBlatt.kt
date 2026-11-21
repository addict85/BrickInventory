package ch.brickinventoryapp.parts.ui.screens

import ch.brickinventoryapp.model.domain.Kategoriewahl
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.parts.ui.viewmodel.TeileAktionen
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.parts.ui.PartsUiState
import ch.brickinventoryapp.state.ui.Filterzahl
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.domain.LocationView
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.shared.ui.ViewSection
import ch.brickinventoryapp.shared.ui.FilterSection
import ch.brickinventoryapp.shared.ui.FilterSheetFrame
import ch.brickinventoryapp.shared.ui.FilterChoice
import ch.brickinventoryapp.shared.ui.AccountFilterSection
import ch.brickinventoryapp.shared.ui.LocationFilterSection
import ch.brickinventoryapp.model.data.Ersatzteilwahl

/** The parts' filter sheet: account, storage location, spare parts, color and category, view. */
@Composable
internal fun TeileFilterBlatt(
    aktionen: TeileAktionen,
    partsState: PartsUiState,
    householdMembers: List<MemberView>,
    scopeMode: String,
    onScopeChange: (String) -> Unit,
    lagerorte: List<LocationView>,
    storageMode: String,
    onStorageChange: (String) -> Unit,
    farbEntries: List<PartsFilterEntry>,
    categoryEntries: List<PartsFilterEntry>,
    onSchliessen: () -> Unit,
) {
    val ersatz = partsState.filter.ersatz
    val farbe = partsState.filter.farbe
    val kategorie = partsState.filter.kategorie
    // Only reset what deviates: every change reloads the list.
    val reset: () -> Unit = {
        if (Filterzahl.konto(householdMembers, scopeMode) > 0) onScopeChange(ScopeFilter.ALL)
        if (Filterzahl.lager(lagerorte, storageMode) > 0) onStorageChange("")
        if (ersatz != Ersatzteilwahl.ALLE) aktionen.setPartsSpare(Ersatzteilwahl.ALLE)
        if (farbe != ColorPicker.Alle) aktionen.setPartsColorFilter(ColorPicker.Alle)
        if (kategorie != Kategoriewahl.Alle) aktionen.setPartsCategoryFilter(Kategoriewahl.Alle)
    }
    val aktiv = Filterzahl.teile(householdMembers, scopeMode, lagerorte, storageMode, ersatz, farbe, kategorie)
    FilterSheetFrame(onSchliessen = onSchliessen, resetOn = reset.takeIf { aktiv > 0 }) {
        AccountFilterSection(householdMembers, scopeMode, onScopeChange)
        LocationFilterSection(lagerorte, storageMode, onStorageChange, afterShare = true)
        // Spare parts — the same choice as parts-spare in the web app,
        // filtered on the SERVER (partsSpare in the state).
        FilterSection(stringResource(R.string.filter_section_spare)) {
            for ((wert, text) in listOf(
                Ersatzteilwahl.ALLE to R.string.parts_filter_all,
                Ersatzteilwahl.OHNE to R.string.parts_filter_no_spare,
                Ersatzteilwahl.NUR to R.string.parts_filter_spare,
            )) {
                FilterChoice(stringResource(text), ersatz == wert) { aktionen.setPartsSpare(wert) }
            }
        }
        if (farbEntries.isNotEmpty() || categoryEntries.isNotEmpty()) {
            FilterSection(stringResource(R.string.filter_section_color_category)) {
                PartsFilterRow(
                    farben = farbEntries,
                    kategorien = categoryEntries,
                    colorSelected = farbe.wert.orEmpty(),
                    categorySelected = kategorie.wert.orEmpty(),
                    onColor = { aktionen.setPartsColorFilter(ColorPicker.aus(it)) },
                    onCategory = { aktionen.setPartsCategoryFilter(Kategoriewahl.aus(it)) },
                )
            }
        }
        ViewSection(partsState.filter.ansicht) { aktionen.setPartsView(it) }
    }
}
