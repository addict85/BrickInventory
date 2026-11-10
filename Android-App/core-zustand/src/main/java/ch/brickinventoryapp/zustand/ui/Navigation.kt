package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.data.model.KEINE_FARBE
import ch.brickinventoryapp.model.fach.Postenart
import kotlinx.serialization.Serializable

/**
 * Die Ziele der App als typsichere Routen: Navigation kodiert die Werte selbst und
 * liest sie mit `toRoute()` zurück, darum gibt es weder Routentexte noch eine
 * eigene Kodierung. Werte, die ein Ziel braucht, stehen als Feld an seiner Klasse.
 */
@Serializable
sealed interface Screen {
    @Serializable data object Setup : Screen
    @Serializable data object Login : Screen
    @Serializable data object Gallery : Screen
    @Serializable data object Catalog : Screen
    @Serializable data object Wanted : Screen

    /** Dasselbe Set kann neu und gebraucht auf der Merkliste stehen; erst der Zustand macht es eindeutig. */
    @Serializable data class MerkpostenDetail(val setNumber: String, val condition: Zustand) : Screen
    @Serializable data class CatalogDetail(val setNumber: String) : Screen
    @Serializable data class SetDetail(val setNumber: String) : Screen
    @Serializable data object Parts : Screen
    @Serializable data object Finance : Screen
    @Serializable data object Minifigs : Screen
    @Serializable data object PartsList : Screen
    @Serializable data object Settings : Screen

    /** Alles, was kein Bestandsreiter ist — das fünfte Ziel der unteren Leiste. */
    @Serializable data object Mehr : Screen

    // Die Unterseiten der Einstellungen
    @Serializable data object Gutscheine : Screen
    @Serializable data object Preisalarme : Screen
    @Serializable data object Lagerorte : Screen
    @Serializable data object Haushalt : Screen
    @Serializable data object CsvImport : Screen
    @Serializable data object Konto : Screen
    @Serializable data class BarcodeScanner(val herkunft: Scannerherkunft) : Screen
    @Serializable data object Comparison : Screen
    @Serializable data object Monitoring : Screen

    /** Käufe eines Sets, Teils oder einer Figur. */
    @Serializable data class AcquisitionManagement(
        val art: Postenart,
        val id: String,
        val colorId: Int = KEINE_FARBE,
        val title: String,
    ) : Screen

    /** Detail eines manuell erfassten Teils oder einer Figur. */
    @Serializable data class ManualItemDetail(
        val art: Postenart,
        val id: String,
        val colorId: Int = KEINE_FARBE,
        val title: String,
    ) : Screen

    @Serializable data class PdfViewer(val url: String, val title: String) : Screen
}

/**
 * Schlüssel der gemerkten Rollposition eines Reiters. Die Reiter-Ziele und ihre
 * Listen benutzen denselben Text, damit „Reiter angetippt, oben anfangen“ genau
 * die Position verwirft, die das Ziel gemerkt hat.
 */
val Screen.rollSchluessel: String
    get() = when (this) {
        Screen.Gallery -> "gallery"
        Screen.Parts -> "parts"
        Screen.Minifigs -> "minifigs"
        Screen.Finance -> "finance"
        Screen.Settings -> "settings"
        else -> toString()
    }

/**
 * Der Teilgraph aus Einrichtung und Anmeldung. Kein [Screen]: Er ist kein Ziel,
 * sondern hält das ViewModel, das beide teilen; die App beginnt in ihm.
 */
@Serializable
data object AnmeldungBereich
