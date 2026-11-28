package ch.brickinventoryapp.app

import android.content.Context
import android.content.res.XmlResourceParser
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.RemoteViews
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.app.widget.WidgetNumbers
import ch.brickinventoryapp.app.widget.widgetContent
import ch.brickinventoryapp.model.domain.CurrencyCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.ZoneId
import java.time.ZonedDateTime
import ch.brickinventoryapp.R as AppR
import ch.brickinventoryapp.resources.R as Texts

/**
 * The widget in the home screen's picker (from Android 12): it carries a
 * description and a preview, and the preview can be built as RemoteViews
 * (the home screen only shows such layouts) and names title and value.
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   widget-without-preview   previewLayout and description removed from xml-v31 → red “the widget carries …”
 *   widget-without-stamp     widgetContent() drops the fetch time → red “the widget says when …”
 *   widget-stale-not-dimmed  widgetContent() passes stale = false → red “the widget says when …”
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

    /** The worker can be stuck for days; the home screen then says from when the numbers are. */
    @Test
    fun `the widget says when its numbers are from and dims them after a day`() {
        val zone = ZoneId.of("Europe/Zurich")
        val fetched = ZonedDateTime.of(2026, 11, 28, 14, 5, 0, 0, zone).toInstant().toEpochMilli()
        val numbers = WidgetNumbers(CurrencyCode.CHF, value = 1250.5, total = 250.5, today = 10.5, state = fetched)
        val fresh = widgetContent(ctx, numbers, show = true, now = fetched + 60_000, zone = zone)
        assertEquals(ctx.getString(Texts.string.widget_as_of, "14:05"), fresh.stamp)
        assertEquals("Stand 14:05", fresh.stamp)
        assertTrue("fresh numbers are dimmed", !fresh.stale)
        assertEquals(listOf(ctx.getString(Texts.string.widget_today), ctx.getString(Texts.string.widget_total)),
            fresh.rows.map { it.first })
        val old = widgetContent(ctx, numbers, show = true, now = fetched + 25 * 3_600_000L, zone = zone)
        assertTrue("a day later the numbers are not dimmed", old.stale)
        assertTrue("a day later the time alone is named: ${old.stamp}", old.stamp!!.contains("28.11."))
    }
}
