package ch.brickinventoryapp.app

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Exported components from libraries the app does not need are not in
 * the merged manifest. Read via the PackageManager, which only in the module
 * app knows the manifest of the whole app; in a feature module it would only see its
 * own.
 *
 * Counter-checks (Robolectric, measured by CI; job `gegenproben`):
 *   widerrufsdienst-exportiert  tools:node="remove" removed from RevocationBoundService →
 *                               red “the revocation service of Google sign-in …”
 *   profilempfaenger-exportiert tools:node="remove" removed from ProfileInstallReceiver →
 *                               red “the profile installer …”
 *   pdf-renderer-im-app-prozess isolatedProcess removed from PdfRenderDienst → red
 *                               “the PDF renderer runs isolated …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LibraryComponentsTest {

    private val ctx = ApplicationProvider.getApplicationContext<Context>()

    private fun fehlt(name: String, holen: (ComponentName) -> Unit) {
        try {
            holen(ComponentName(ctx.packageName, name))
            fail("$name steht im Manifest")
        } catch (_: PackageManager.NameNotFoundException) {
            // erwartet: herausgenommen
        }
    }

    @Test
    fun `the revocation service of Google sign-in is not in the manifest`() =
        fehlt("com.google.android.gms.auth.api.signin.RevocationBoundService") { ctx.packageManager.getServiceInfo(it, 0) }

    @Test
    fun `the profile installer is not in the manifest`() =
        fehlt("androidx.profileinstaller.ProfileInstallReceiver") { ctx.packageManager.getReceiverInfo(it, 0) }

    @Test
    fun `the check sees the manifest at all`() {
        // Otherwise both tests above would be green because the PackageManager knows nothing at all.
        val info = ctx.packageManager.getReceiverInfo(
            ComponentName(ctx.packageName, "ch.brickinventoryapp.app.widget.SammlungsWidgetEmpfaenger"), 0)
        assertTrue(info.exported)
    }

    @Test
    fun `the PDF renderer runs isolated and is not reachable from outside`() {
        val info = ctx.packageManager.getServiceInfo(ComponentName(ctx, PDF_SERVICE), 0)
        assertTrue("Ohne isolatedProcess rendert pdfium im Prozess mit Token und Schlüsseln",
            info.flags and ServiceInfo.FLAG_ISOLATED_PROCESS != 0)
        assertFalse(info.exported)
    }

    private companion object {
        // The class is internal in feature-finances; the manifest names it by name.
        const val PDF_SERVICE = "ch.brickinventoryapp.finances.ui.pdf.PdfRenderDienst"
    }
}
