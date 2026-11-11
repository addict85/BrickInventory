package ch.brickinventoryapp.sammlung

import ch.brickinventoryapp.model.ui.theme.Design
import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.model.ui.model.KennzahlenAnsicht
import ch.brickinventoryapp.model.ui.model.SetAnsicht
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.sammlung.ui.BarcodeUiState
import ch.brickinventoryapp.sammlung.ui.GalleryUiState
import ch.brickinventoryapp.sammlung.ui.screens.GalerieEreignisse
import ch.brickinventoryapp.sammlung.ui.screens.GalerieZustand
import ch.brickinventoryapp.sammlung.ui.screens.GalleryScreen
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.zustand.ui.AppUiState
import ch.brickinventoryapp.zustand.ui.BlickfeldUiState
import ch.brickinventoryapp.zustand.ui.LagerUiState
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * Die Galerie sucht, filtert und sortiert nicht selbst: Suchtext, Thema und Sortierung
 * gehen als Ereignis nach oben (zum Server), die Liste bleibt, wie der Server sie
 * schickte, und die Sortierwerte sind die Schlüssel des Servers. Dazu die Zahl der
 * Anleitungen im Kopf. Gezeichnet mit einem festen Zustand und Ereignissen, die
 * mitschreiben.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   galerie-filtert-selbst      das Raster zeigt nur Sets, deren Name den Suchtext enthält → rot „Suchtext …“
 *   galerie-sortierwert-falsch  „Name A–Z“ meldet name statt name_asc → rot „die Sortierung …“
 *   galerie-thema-verschluckt   die Themenwahl im Filter meldet nichts → rot „ein Thema …“
 *   galerie-ohne-anleitungen    der Chip der Anleitungen fehlt im Kopf → rot „der Kopf nennt …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class GalerieMeldetNachObenTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val vorher = Locale.getDefault()

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() = Locale.setDefault(vorher)

    private val gesucht = mutableListOf<String>()
    private val sortiert = mutableListOf<String>()
    private val themen = mutableListOf<String>()

    private val ereignisse = GalerieEreignisse(
        suche = { gesucht += it }, thema = { themen += it }, sortierung = { sortiert += it.kennung },
        mehrLaden = {}, konto = {}, lagerort = {}, aktualisieren = {},
        setErfassen = {}, manuelleErfassungQuittiert = {},
    )

    private fun zeige() {
        val galerie = GalleryUiState(
            sets = listOf(SetAnsicht(setNumber = "75192-1", name = "Millennium Falcon"), SetAnsicht(setNumber = "10294-1", name = "Titanic")),
            galleryThemes = listOf("Star Wars", "Icons"), galleryTotal = 2,
            stats = KennzahlenAnsicht(totalSets = 2, totalQuantity = 3, totalInstructions = 7, totalParts = 16631, totalMinifigs = 4),
        )
        val zustand = GalerieZustand(AppUiState(isLoggedIn = true), BlickfeldUiState(), galerie, emptyMap(), BarcodeUiState(), LagerUiState())
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) {
                    GalleryScreen(zustand, ereignisse, coil3.ImageLoader.Builder(ctx).build(), onScanBarcode = {}, onSetClick = {})
                }
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `Suchtext geht nach oben, die Liste bleibt die des Servers`() {
        zeige()
        compose.onNode(hasSetTextAction()).performTextInput("Lambo")
        compose.waitForIdle()
        assertEquals("Lambo", gesucht.lastOrNull())
        // Keiner der beiden passt zum Suchtext; gezeigt wird trotzdem, was der Server schickte.
        compose.onNodeWithText("Millennium Falcon", useUnmergedTree = true).fetchSemanticsNode()
        compose.onNodeWithText("Titanic", useUnmergedTree = true).fetchSemanticsNode()
    }

    @Test
    fun `die Sortierung meldet die Schluessel des Servers`() {
        zeige()
        val menue = ctx.getString(R.string.sort_menu_cd, ctx.getString(R.string.gallery_sort_added_desc))
        val namen = mapOf(R.string.gallery_sort_added_asc to "added_asc", R.string.gallery_sort_name to "name_asc",
            R.string.gallery_sort_number to "num_asc", R.string.gallery_sort_year_desc to "year_desc",
            R.string.gallery_sort_price_desc to "price_desc", R.string.gallery_sort_price_asc to "price_asc",
            R.string.gallery_sort_qty_desc to "qty_desc", R.string.gallery_sort_qty_asc to "qty_asc")
        for (text in namen.keys) {
            compose.onNodeWithContentDescription(menue).performClick()
            compose.waitForIdle()
            compose.onNodeWithText(ctx.getString(text)).performClick()
            compose.waitForIdle()
        }
        assertEquals(namen.values.toList(), sortiert)
    }

    @Test
    fun `ein Thema aus dem Filter geht nach oben`() {
        zeige()
        compose.onNodeWithContentDescription(ctx.getString(R.string.filter_button)).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Star Wars").performClick()
        compose.waitForIdle()
        assertEquals(listOf("Star Wars"), themen)
    }

    @Test
    fun `der Kopf nennt die Zahl der Anleitungen`() {
        zeige()
        compose.onNodeWithText(ctx.resources.getQuantityString(R.plurals.gallery_stat_instructions, 7, "7"),
            useUnmergedTree = true).fetchSemanticsNode()
    }
}
