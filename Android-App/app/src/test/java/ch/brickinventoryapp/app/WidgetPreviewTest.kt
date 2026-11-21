package ch.brickinventoryapp.app

import android.content.Context
import android.content.res.XmlResourceParser
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.RemoteViews
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.resources.R as Texte
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import ch.brickinventoryapp.R as AppR

/**
 * Das Widget in der Auswahl des Startbildschirms (ab Android 12): Es trägt eine
 * Beschreibung und eine Vorschau, und die Vorschau lässt sich als RemoteViews aufbauen
 * (nur solche Layouts zeigt der Startbildschirm) und nennt Titel und Wert.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   widget-ohne-vorschau   previewLayout und description aus xml-v31 entfernt → rot „das Widget traegt …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "de-rCH")
class WidgetPreviewTest {

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val android = "http://schemas.android.com/apk/res/android"

    private fun provider(): XmlResourceParser = ctx.resources.getXml(AppR.xml.sammlungs_widget).apply {
        while (true) {
            val art = next()
            check(art != XmlResourceParser.END_DOCUMENT) { "Kein <appwidget-provider>" }
            if (art == XmlResourceParser.START_TAG && name == "appwidget-provider") break
        }
    }

    private fun texts(v: View): List<String> = when (v) {
        is TextView -> listOf(v.text.toString())
        is ViewGroup -> (0 until v.childCount).flatMap { texts(v.getChildAt(it)) }
        else -> emptyList()
    }

    @Test
    fun `the widget carries a description and a preview with title and value`() {
        val info = provider()
        val beschreibung = info.getAttributeResourceValue(android, "description", 0)
        val vorschau = info.getAttributeResourceValue(android, "previewLayout", 0)
        assertEquals("Beschreibung", ctx.getString(Texte.string.widget_beschreibung),
            if (beschreibung == 0) null else ctx.getString(beschreibung))
        assertNotEquals("Keine Vorschau", 0, vorschau)

        val ansicht = RemoteViews(ctx.packageName, vorschau).apply(ctx, FrameLayout(ctx))
        val gezeigt = texts(ansicht)
        for (id in listOf(Texte.string.widget_titel, Texte.string.widget_wert, Texte.string.widget_vorschau_wert)) {
            assertTrue("„${ctx.getString(id)}“ fehlt in der Vorschau: $gezeigt", ctx.getString(id) in gezeigt)
        }
    }
}
