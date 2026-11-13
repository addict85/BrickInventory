package ch.brickinventoryapp.sammlung.ui.screens

import ch.brickinventoryapp.model.ui.model.LagerortAnsicht
import ch.brickinventoryapp.model.ui.model.MitgliedAnsicht
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.zustand.ui.Filterzahl
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.gemeinsam.ui.FilterAbschnitt
import ch.brickinventoryapp.gemeinsam.ui.FilterBlattRahmen
import ch.brickinventoryapp.gemeinsam.ui.FilterWahl
import ch.brickinventoryapp.gemeinsam.ui.KontoFilterAbschnitt
import ch.brickinventoryapp.gemeinsam.ui.LagerortFilterAbschnitt

/** Das Filterblatt mit den Werten der Galerie. */
@Composable
internal fun GalerieFilter(zustand: GalerieZustand, ereignisse: GalerieEreignisse, onSchliessen: () -> Unit) {
    GalerieFilterBlatt(
        members = zustand.blick.householdMembers, konto = zustand.kontoWahl(), onKonto = ereignisse.konto,
        orte = zustand.lager.orte, lager = zustand.lagerWahl(), onLager = ereignisse.lagerort,
        themen = zustand.galerie.galleryThemes, thema = zustand.galerie.galleryTheme, onThema = ereignisse.thema,
        onSchliessen = onSchliessen,
    )
}

/**
 * Konto, Lagerort und Thema der Galerie. Angewandt wird jede Wahl sofort auf dem
 * Server; das Blatt bleibt offen, damit man mehrere setzen kann. Die Sortierung
 * hat ihr eigenes Menü neben dem Filterknopf.
 */
@Composable
private fun GalerieFilterBlatt(
    members: List<MitgliedAnsicht>, konto: String, onKonto: (String) -> Unit,
    orte: List<LagerortAnsicht>, lager: String, onLager: (String) -> Unit,
    themen: List<String>, thema: String, onThema: (String) -> Unit,
    onSchliessen: () -> Unit,
) {
    // Nur zurücksetzen, was abweicht: Jede Änderung lädt die Liste neu.
    val zuruecksetzen: () -> Unit = {
        if (Filterzahl.konto(members, konto) > 0) onKonto(ScopeFilter.ALL)
        if (Filterzahl.lager(orte, lager) > 0) onLager("")
        if (thema.isNotBlank()) onThema("")
    }
    val aktiv = Filterzahl.galerie(members, konto, orte, lager, thema)
    FilterBlattRahmen(onSchliessen = onSchliessen, onZuruecksetzen = zuruecksetzen.takeIf { aktiv > 0 }) {
        KontoFilterAbschnitt(members, konto, onKonto)
        LagerortFilterAbschnitt(orte, lager, onLager)
        if (themen.isNotEmpty()) {
            FilterAbschnitt(stringResource(R.string.catalog_filter_theme)) {
                FilterWahl(stringResource(R.string.catalog_all_themes), thema.isEmpty()) { if (thema.isNotEmpty()) onThema("") }
                themen.forEach { t -> FilterWahl(t, thema == t) { onThema(if (thema == t) "" else t) } }
            }
        }
    }
}
