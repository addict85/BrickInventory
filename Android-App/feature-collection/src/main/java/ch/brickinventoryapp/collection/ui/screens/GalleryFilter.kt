package ch.brickinventoryapp.collection.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.shared.ui.AccountFilterSection
import ch.brickinventoryapp.shared.ui.FilterChoice
import ch.brickinventoryapp.shared.ui.FilterSection
import ch.brickinventoryapp.shared.ui.FilterSheetFrame
import ch.brickinventoryapp.shared.ui.LocationFilterSection
import ch.brickinventoryapp.state.ui.FilterCount

/**
 * Account, storage location and theme of the gallery. Every choice applies right away on the
 * server; the sheet stays open, so several can be set. Sorting
 * has its own menu next to the filter button.
 */
@Composable
internal fun GalleryFilter(condition: GalleryState, events: GalleryEvents, onClose: () -> Unit) {
    val members = condition.glance.householdMembers
    val account = condition.accountChoice()
    val onAccount = events.account
    val locations = condition.storage.locations
    val storage = condition.storageChoice()
    val onStorage = events.storageLocation
    val themes = condition.gallery.galleryThemes
    val theme = condition.gallery.galleryTheme
    val onTheme = events.theme
    // Only reset what differs: every change reloads the list.
    val reset: () -> Unit = {
        if (FilterCount.account(members, account) > 0) onAccount(ScopeFilter.ALL)
        if (FilterCount.storage(locations, storage) > 0) onStorage("")
        if (theme.isNotBlank()) onTheme("")
    }
    val active = FilterCount.gallery(members, account, locations, storage, theme)
    FilterSheetFrame(onClose = onClose, resetOn = reset.takeIf { active > 0 }) {
        AccountFilterSection(members, account, onAccount)
        LocationFilterSection(locations, storage, onStorage)
        if (themes.isNotEmpty()) {
            FilterSection(stringResource(R.string.catalog_filter_theme)) {
                FilterChoice(stringResource(R.string.catalog_all_themes), theme.isEmpty()) { if (theme.isNotEmpty()) onTheme("") }
                themes.forEach { t -> FilterChoice(t, theme == t) { onTheme(if (theme == t) "" else t) } }
            }
        }
    }
}
