package ch.brickinventoryapp.app

import android.content.Context
import android.content.res.XmlResourceParser
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.RemoteViews
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import ch.brickinventoryapp.R as AppR
import ch.brickinventoryapp.resources.R as Texts

/**
 * The widget in the home screen's picker (from Android 12): it carries a
 * description and a preview, and the preview can be built as RemoteViews
 * (the home screen only shows such layouts) and names title and value.
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   widget-without-preview   previewLayout and description removed from xml-v31 → red “the widget carries …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "de-rCH")
class WidgetPreviewTest {

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val android = "http://schemas.android.com/apk/res/android"

    private fun provider(): XmlResourceParser = ctx.resources.getXml(AppR.xml.collection_widget).apply {
        while (true) {
            val kind = next()
            check(kind != XmlResourceParser.END_DOCUMENT) { "no <appwidget-provider>" }
            if (kind == XmlResourceParser.START_TAG && name == "appwidget-provider") break
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
        val description = info.getAttributeResourceValue(android, "description", 0)
        val preview = info.getAttributeResourceValue(android, "previewLayout", 0)
        assertEquals("description", ctx.getString(Texts.string.widget_description),
            if (description == 0) null else ctx.getString(description))
        assertNotEquals("no preview", 0, preview)

        val view = RemoteViews(ctx.packageName, preview).apply(ctx, FrameLayout(ctx))
        val shown = texts(view)
        for (id in listOf(Texts.string.widget_title, Texts.string.widget_value, Texts.string.widget_preview_value)) {
            assertTrue("“${ctx.getString(id)}” missing in the preview: $shown", ctx.getString(id) in shown)
        }
    }
}
