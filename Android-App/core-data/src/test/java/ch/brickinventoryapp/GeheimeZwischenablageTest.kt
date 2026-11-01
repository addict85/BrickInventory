package ch.brickinventoryapp

import android.content.ClipDescription
import ch.brickinventoryapp.util.IST_GEHEIM
import ch.brickinventoryapp.util.geheimerClip
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Was die App an Geheimnissen kopiert, trägt die Markierung, die Android 13
 * auswertet: keine Vorschau des Inhalts, kein Tastaturvorschlag.
 *
 * Gegenprobe: nur in der CI messbar (Robolectric). Vorgesehen: in geheimerClip()
 * die Zeile mit `description.extras` entfernt → rot.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class GeheimeZwischenablageTest {

    @Test
    fun `ein Geheimnis ist fuer das System als sensibel markiert`() {
        val clip = geheimerClip("BrickInventory", "4711")
        assertEquals("4711", clip.getItemAt(0).text.toString())
        assertEquals(ClipDescription.EXTRA_IS_SENSITIVE, IST_GEHEIM)
        assertTrue(clip.description.extras.getBoolean(ClipDescription.EXTRA_IS_SENSITIVE))
    }
}
