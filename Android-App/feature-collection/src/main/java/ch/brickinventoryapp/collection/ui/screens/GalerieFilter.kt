package ch.brickinventoryapp.collection.ui.screens

import ch.brickinventoryapp.model.domain.LocationView
import ch.brickinventoryapp.model.domain.MemberView
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.Filterzahl
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.shared.ui.FilterSection
import ch.brickinventoryapp.shared.ui.FilterSheetFrame
import ch.brickinventoryapp.shared.ui.FilterChoice
import ch.brickinventoryapp.shared.ui.AccountFilterSection
import ch.brickinventoryapp.shared.ui.LocationFilterSection

/** Das Filterblatt mit den Werten der Galerie. */
@Composable
internal fun GalerieFilter(zustand: GalleryState, events: GalleryEvents, onSchliessen: () -> Unit) {
    GalleryFilterSheet(
        members = zustand.blick.householdMembers, konto = zustand.accountChoice(), onAccount = events.konto,
        orte = zustand.lager.orte, lager = zustand.storageChoice(), onStorage = events.lagerort,
        themen = zustand.galerie.galleryThemes, thema = zustand.galerie.galleryTheme, onTheme = events.thema,
        onSchliessen = onSchliessen,
    )
}

/**
 * Konto, Lagerort und Thema der Galerie. Angewandt wird jede Wahl sofort auf dem
 * Server; das Blatt bleibt offen, damit man mehrere setzen kann. Die Sortierung
 * hat ihr eigenes Menü neben dem Filterknopf.
 */
@Composable
private fun GalleryFilterSheet(
    members: List<MemberView>, konto: String, onAccount: (String) -> Unit,
    orte: List<LocationView>, lager: String, onStorage: (String) -> Unit,
    themen: List<String>, thema: String, onTheme: (String) -> Unit,
    onSchliessen: () -> Unit,
) {
    // Nur zurücksetzen, was abweicht: Jede Änderung lädt die Liste neu.
    val reset: () -> Unit = {
        if (Filterzahl.konto(members, konto) > 0) onAccount(ScopeFilter.ALL)
        if (Filterzahl.lager(orte, lager) > 0) onStorage("")
        if (thema.isNotBlank()) onTheme("")
    }
    val aktiv = Filterzahl.galerie(members, konto, orte, lager, thema)
    FilterSheetFrame(onSchliessen = onSchliessen, resetOn = reset.takeIf { aktiv > 0 }) {
        AccountFilterSection(members, konto, onAccount)
        LocationFilterSection(orte, lager, onStorage)
        if (themen.isNotEmpty()) {
            FilterSection(stringResource(R.string.catalog_filter_theme)) {
                FilterChoice(stringResource(R.string.catalog_all_themes), thema.isEmpty()) { if (thema.isNotEmpty()) onTheme("") }
                themen.forEach { t -> FilterChoice(t, thema == t) { onTheme(if (thema == t) "" else t) } }
            }
        }
    }
}
