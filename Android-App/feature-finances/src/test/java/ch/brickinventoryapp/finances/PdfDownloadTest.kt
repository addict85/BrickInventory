package ch.brickinventoryapp.finances

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.finances.ui.pdf.PdfLoadState
import ch.brickinventoryapp.finances.ui.pdf.PdfSource
import ch.brickinventoryapp.finances.ui.screens.PdfViewerScreen
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream

/**
 * The download button copies the file the viewer has already loaded into Downloads — no second
 * fetch, which would not know the token — and it is there only once that file is there.
 *
 * Counter-checks (run here):
 *   the download button outside `if (s is PdfLoadState.Ready)` (with a fresh empty source) → red “while loading …”;
 *   savePdfToDownloads copies `ByteArray(0)` instead of `source.inbox()` → red “the button copies …”;
 *   the print button pulled ahead of `if (savable)` → red “a voucher PDF can be neither …”.
 */
@RunWith(RobolectricTestRunner::class)
class PdfDownloadTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val pdf = "%PDF-1.4 the loaded instruction".toByteArray()

    private val source = object : PdfSource {
        override fun open(): ParcelFileDescriptor = error("not rendered here")
        override fun inbox(): InputStream = ByteArrayInputStream(pdf)
        override fun close() = Unit
    }

    private var state by mutableStateOf<PdfLoadState>(PdfLoadState.Rendering)

    private fun show(state: PdfLoadState, savable: Boolean = true) {
        this.state = state
        compose.setContent {
            BrickInventoryManagerTheme {
                PdfViewerScreen(this.state, "Falcon", savable = savable, onBack = {},
                    renderPage = { _, _, w -> Bitmap.createBitmap(w, w, Bitmap.Config.ARGB_8888) },
                    write = { _, _ -> }, onAgain = {})
            }
        }
        compose.waitForIdle()
    }

    private fun buttons(label: Int = R.string.pdfview_download) =
        compose.onAllNodesWithContentDescription(ctx.getString(label)).fetchSemanticsNodes()

    /** The print dialog offers „Als PDF speichern“: a voucher PDF (number and PIN) gets neither. */
    @Test
    fun `a voucher PDF can be neither downloaded nor printed`() {
        show(PdfLoadState.Ready(source, pageCount = 1), savable = false)
        assertEquals(0, buttons().size)
        assertEquals(0, buttons(R.string.pdfview_print).size)
    }

    @Test
    fun `an instruction can be downloaded and printed`() {
        show(PdfLoadState.Ready(source, pageCount = 1))
        assertEquals(1, buttons().size)
        assertEquals(1, buttons(R.string.pdfview_print).size)
    }

    @Test
    fun `while loading there is no download button`() {
        show(PdfLoadState.Downloading(40, 400, 1000))
        assertEquals(0, buttons().size)
        state = PdfLoadState.Rendering
        compose.waitForIdle()
        assertEquals(0, buttons().size)
    }

    @Test
    fun `the button copies the loaded file into Downloads`() {
        val saved = ByteArrayOutputStream()
        shadowOf(ctx.contentResolver).registerOutputStream(ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI, 1), saved)
        show(PdfLoadState.Ready(source, pageCount = 1))
        compose.onNodeWithContentDescription(ctx.getString(R.string.pdfview_download)).performClick()
        compose.waitForIdle()
        assertArrayEquals(pdf, saved.toByteArray())
    }
}
