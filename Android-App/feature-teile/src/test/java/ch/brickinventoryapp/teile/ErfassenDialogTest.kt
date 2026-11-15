package ch.brickinventoryapp.teile

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import ch.brickinventoryapp.model.fach.Figurenerfassung
import ch.brickinventoryapp.model.fach.Teilerfassung
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.teile.ui.screens.AddMinifigDialog
import ch.brickinventoryapp.teile.ui.screens.AddPartDialog
import ch.brickinventoryapp.ui.components.erfassenSchliessbar
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowDialog

/**
 * Teil und Minifigur erfassen: Eine unvollständige Eingabe schliesst den Dialog nicht, das
 * Feld sagt, was fehlt; erst eine gültige Erfassung geht hinaus. Ein ausgefüllter Dialog
 * schliesst weder durch Danebentippen noch durch Zurück ohne Rückfrage (ErfassenDialog).
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   teil-erfassen-schliesst-still  Hinzufügen ruft wieder submit() und onDismiss() → rot „ohne Teilenummer …“
 *   figur-erfassen-schliesst-still dasselbe im Figuren-Dialog → rot „ohne Figurnummer …“
 *   erfassen-verwirft-ohne-frage   Zurück schliesst auch Ausgefülltes sofort → rot „Zurueck fragt …“
 *   erfassen-daneben-schliesst     erfassenSchliessbar lässt Danebentippen immer zu → rot „daneben tippen …“
 */
@RunWith(RobolectricTestRunner::class)
class ErfassenDialogTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int) = compose.activity.getString(id)
    private val teile = mutableListOf<Teilerfassung>()
    private val figuren = mutableListOf<Figurenerfassung>()
    private var geschlossen = 0

    private fun zeigeTeil() {
        compose.setContent {
            BrickInventoryManagerTheme {
                var offen by remember { mutableStateOf(true) }
                if (offen) AddPartDialog(onDismiss = { offen = false; geschlossen++ }, onAdd = { teile += it; offen = false })
            }
        }
        compose.waitForIdle()
    }

    private fun zeigeFigur() {
        compose.setContent {
            BrickInventoryManagerTheme {
                var offen by remember { mutableStateOf(true) }
                if (offen) AddMinifigDialog(onDismiss = { offen = false; geschlossen++ }, onAdd = { figuren += it; offen = false })
            }
        }
        compose.waitForIdle()
    }

    private fun knopf(id: Int) = compose.onNode(hasText(text(id)) and hasClickAction() and hasAnyAncestor(isDialog()))
    private fun feld(id: Int) = compose.onNode(hasSetTextAction() and hasText(text(id)))

    private fun tippe(id: Int) {
        knopf(id).performClick()
        compose.waitForIdle()
    }

    /** Zurück, wie es das System an das oberste Dialogfenster gibt. */
    @Suppress("DEPRECATION")
    private fun zurueck() {
        compose.runOnUiThread { ShadowDialog.getLatestDialog().onBackPressed() }
        compose.waitForIdle()
    }

    @Test
    fun `ohne Teilenummer bleibt der Dialog offen und das Feld sagt warum`() {
        zeigeTeil()
        tippe(R.string.parts_add_button)
        assertEquals("Der Dialog schloss ohne Erfassung", 0, geschlossen)
        assertEquals(emptyList<Teilerfassung>(), teile)
        compose.onNodeWithText(text(R.string.parts_nummer_fehlt)).assertExists()

        feld(R.string.parts_part_number).performTextInput("3001")
        tippe(R.string.parts_add_button)
        assertEquals(listOf("3001"), teile.map { it.nummer })
        assertEquals("Erfolg schliesst über onAdd, nicht über Abbrechen", 0, geschlossen)
    }

    @Test
    fun `ohne Figurnummer bleibt der Dialog offen und das Feld sagt warum`() {
        zeigeFigur()
        tippe(R.string.minifigs_add_button)
        assertEquals("Der Dialog schloss ohne Erfassung", 0, geschlossen)
        compose.onNodeWithText(text(R.string.minifigs_nummer_fehlt)).assertExists()

        feld(R.string.minifigs_fig_number).performTextInput("fig-007357")
        tippe(R.string.minifigs_add_button)
        assertEquals(listOf("fig-007357"), figuren.map { it.nummer })
    }

    @Test
    fun `eine unlesbare Anzahl sperrt Hinzufuegen`() {
        zeigeTeil()
        feld(R.string.common_quantity).performTextClearance()
        feld(R.string.common_quantity).performTextInput("0")
        compose.waitForIdle()
        knopf(R.string.parts_add_button).assertIsNotEnabled()
        compose.onNodeWithText(text(R.string.erfassen_menge_ungueltig)).assertExists()
    }

    @Test
    fun `Zurueck fragt bei Eingaben erst nach`() {
        zeigeTeil()
        feld(R.string.parts_part_number).performTextInput("3001")
        compose.waitForIdle()
        zurueck()
        assertEquals("Zurück verwarf das Getippte ohne Rückfrage", 0, geschlossen)
        compose.onNodeWithText(text(R.string.erfassen_verwerfen_titel)).assertExists()
        tippe(R.string.erfassen_verwerfen)
        assertEquals(1, geschlossen)
    }

    @Test
    fun `Zurueck schliesst einen leeren Dialog sofort`() {
        zeigeTeil()
        zurueck()
        assertEquals("Ein leerer Dialog schliesst ohne Frage", 1, geschlossen)
    }

    @Test
    fun `daneben tippen schliesst nur einen leeren Dialog`() {
        assertTrue(erfassenSchliessbar(geaendert = false).dismissOnClickOutside)
        assertFalse(erfassenSchliessbar(geaendert = true).dismissOnClickOutside)
        assertTrue("Zurück bleibt an und fragt dann nach", erfassenSchliessbar(geaendert = true).dismissOnBackPress)
    }
}
