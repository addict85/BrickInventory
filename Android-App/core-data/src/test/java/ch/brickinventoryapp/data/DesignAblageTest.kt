package ch.brickinventoryapp.data

import android.app.Application
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.testing.testVertrauenschiffre
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * Das Design des Servers wird gemerkt, und zwar zweimal: im DataStore und in einem
 * synchron lesbaren Spiegel, damit schon das erste Bild eines Kaltstarts im richtigen
 * Design entsteht. Ein unbekannter oder leerer Wert heisst „keine Information“ und
 * löscht nichts. Unter Robolectric mit echter Ablage.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   design-ohne-spiegel   saveAppTheme schreibt den Spiegel nicht → rot „das gemerkte Design …“
 *   design-leer-loescht   saveAppTheme schreibt jeden Wert → rot „ein leerer oder unbekannter …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DesignAblageTest {

    private val ctx = ApplicationProvider.getApplicationContext<Application>()

    private fun ablage() = GeraeteAblage(ctx,
        PreferenceDataStoreFactory.create { File(ctx.filesDir, "design-${System.nanoTime()}.preferences_pb") },
        testVertrauenschiffre())

    @Test
    fun `das gemerkte Design ist beim naechsten Start sofort da`() = runBlocking {
        val jetzt = ablage()
        assertEquals("Ohne Eintrag gilt der Standard", "classic", jetzt.gemerktesDesign())
        jetzt.saveAppTheme("brick")
        assertEquals("brick", jetzt.appTheme.first())
        // Ein neuer Start, dessen DataStore noch nichts geliefert hat: nur der Spiegel zählt.
        assertEquals("brick", ablage().gemerktesDesign())
    }

    @Test
    fun `ein leerer oder unbekannter Wert loescht das gemerkte Design nicht`() = runBlocking {
        val a = ablage()
        a.saveAppTheme("noppe")
        a.saveAppTheme("")
        a.saveAppTheme("unbekannt")
        assertEquals("noppe", a.appTheme.first())
        assertEquals("noppe", a.gemerktesDesign())
    }
}
