package ch.brickinventoryapp.parts.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.data.SparePartChoice
import ch.brickinventoryapp.model.domain.CategoryChoice
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.LocationView
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.parts.ui.PartsUiState
import ch.brickinventoryapp.parts.ui.viewmodel.PartsActions
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.shared.ui.AccountFilterSection
import ch.brickinventoryapp.shared.ui.FilterChoice
import ch.brickinventoryapp.shared.ui.FilterSection
import ch.brickinventoryapp.shared.ui.FilterSheetFrame
import ch.brickinventoryapp.shared.ui.LocationFilterSection
import ch.brickinventoryapp.shared.ui.ViewSection
import ch.brickinventoryapp.state.ui.FilterCount

/** The parts' filter sheet: account, storage location, spare parts, color and category, view. */
@Composable
internal fun PartsFilterSheet(
    actions: PartsActions,
    partsState: PartsUiState,
    householdMembers: List<MemberView>,
    scopeMode: String,
    onScopeChange: (String) -> Unit,
    storageLocations: List<LocationView>,
    storageMode: String,
    onStorageChange: (String) -> Unit,
    colorEntries: List<PartsFilterEntry>,
    categoryEntries: List<PartsFilterEntry>,
    onClose: () -> Unit,
) {
    val spare = partsState.filter.spare
    val color = partsState.filter.color
    val category = partsState.filter.category
    // Only reset what deviates: every change reloads the list.
    val reset: () -> Unit = {
        if (FilterCount.account(householdMembers, scopeMode) > 0) onScopeChange(ScopeFilter.ALL)
        if (FilterCount.storage(storageLocations, storageMode) > 0) onStorageChange("")
        if (spare != SparePartChoice.ALL) actions.setPartsSpare(SparePartChoice.ALL)
        if (color != ColorPicker.All) actions.setPartsColorFilter(ColorPicker.All)
        if (category != CategoryChoice.All) actions.setPartsCategoryFilter(CategoryChoice.All)
    }
    val active = FilterCount.parts(householdMembers, scopeMode, storageLocations, storageMode, spare, color, category)
    FilterSheetFrame(onClose = onClose, resetOn = reset.takeIf { active > 0 }) {
        AccountFilterSection(householdMembers, scopeMode, onScopeChange)
        LocationFilterSection(storageLocations, storageMode, onStorageChange, afterShare = true)
        // Spare parts — the same choice as parts-spare in the web app,
        // filtered on the SERVER (partsSpare in the state).
        FilterSection(stringResource(R.string.filter_section_spare)) {
            for ((value, text) in listOf(
                SparePartChoice.ALL to R.string.parts_filter_all,
                SparePartChoice.WITHOUT to R.string.parts_filter_no_spare,
                SparePartChoice.ONLY to R.string.parts_filter_spare,
            )) {
                FilterChoice(stringResource(text), spare == value) { actions.setPartsSpare(value) }
            }
        }
        if (colorEntries.isNotEmpty() || categoryEntries.isNotEmpty()) {
            FilterSection(stringResource(R.string.filter_section_color_category)) {
                PartsFilterRow(
                    colors = colorEntries,
                    categories = categoryEntries,
                    colorSelected = color.value.orEmpty(),
                    categorySelected = category.value.orEmpty(),
                    onColor = { actions.setPartsColorFilter(ColorPicker.from(it)) },
                    onCategory = { actions.setPartsCategoryFilter(CategoryChoice.from(it)) },
                )
            }
        }
        ViewSection(partsState.filter.view) { actions.setPartsView(it) }
    }
}
