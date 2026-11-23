package ch.brickinventoryapp.parts.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.model.data.SparePartChoice
import ch.brickinventoryapp.model.domain.CategoryChoice
import ch.brickinventoryapp.model.domain.ColorPicker
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
internal fun PartsFilterSheet(filter: PartsFilterContext, onClose: () -> Unit) {
    val actions = filter.actions
    val partsState = filter.partsState
    val spare = partsState.filter.spare
    val color = partsState.filter.color
    val category = partsState.filter.category
    val householdMembers = filter.members
    val scopeMode = filter.account
    val storageLocations = filter.locations
    val storageMode = filter.storage
    val colorEntries = filter.colors
    val categoryEntries = filter.categories
    val onScopeChange: (String) -> Unit = filter::onAccount
    val onStorageChange: (String) -> Unit = filter::onStorage
    // Only reset what deviates: every change reloads the list.
    val reset: () -> Unit = filter::reset
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
