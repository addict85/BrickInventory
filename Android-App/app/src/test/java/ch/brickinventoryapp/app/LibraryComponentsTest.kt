package ch.brickinventoryapp.app

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
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
 * Counter-checks (Robolectric, measured by CI; job `counter-checks`):
 *   revocation-service-exported  tools:node="remove" removed from RevocationBoundService →
 *                               red “the revocation service of Google sign-in …”
 *   profile-receiver-exported tools:node="remove" removed from ProfileInstallReceiver →
 *                               red “the profile installer …”
 *   pdf-renderer-in-app-process isolatedProcess removed from PdfRenderService → red
 *                               “the PDF renderer runs isolated …”
 *   (run here) `<uses-permission REQUEST_INSTALL_PACKAGES>` back in app/src/main/AndroidManifest.xml
 *                               → red “the app does not ask to install packages …”
 *   foreground-permission-back   tools:node="remove" taken from FOREGROUND_SERVICE → red
 *                               “the app asks for no foreground service …” (WorkManager brings it)
 *   foreground-service-back      tools:node="remove" taken from SystemForegroundService → the same test red
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LibraryComponentsTest {

    private val ctx = ApplicationProvider.getApplicationContext<Context>()

    private fun missing(name: String, fetch: (ComponentName) -> Unit) {
        try {
            fetch(ComponentName(ctx.packageName, name))
            fail("$name is in the manifest")
        } catch (_: PackageManager.NameNotFoundException) {
            // expected: taken out
        }
    }

    @Test
    fun `the revocation service of Google sign-in is not in the manifest`() =
        missing("com.google.android.gms.auth.api.signin.RevocationBoundService") { ctx.packageManager.getServiceInfo(it, 0) }

    @Test
    fun `the profile installer is not in the manifest`() =
        missing("androidx.profileinstaller.ProfileInstallReceiver") { ctx.packageManager.getReceiverInfo(it, 0) }

    @Test
    fun `the check sees the manifest at all`() {
        // Otherwise both tests above would be green because the PackageManager knows nothing at all.
        val info = ctx.packageManager.getReceiverInfo(
            ComponentName(ctx.packageName, "ch.brickinventoryapp.app.widget.CollectionWidgetReceiver"), 0)
        assertTrue(info.exported)
    }

    /** Google Play updates the app; it installs nothing itself. CAMERA proves the list is read at all. */
    @Test
    fun `the app does not ask to install packages, its own permissions are there`() {
        val requested = ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.GET_PERMISSIONS)
            .requestedPermissions.orEmpty().toList()
        assertTrue(requested.toString(), "android.permission.CAMERA" in requested)
        assertEquals(emptyList<String>(), requested.filter { it == "android.permission.REQUEST_INSTALL_PACKAGES" })
    }

    /** CSV import and PDF export are plain workers; setForeground() would need the permission back. */
    @Test
    fun `the app asks for no foreground service and declares none`() {
        val requested = ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.GET_PERMISSIONS)
            .requestedPermissions.orEmpty().toList()
        assertTrue(requested.toString(), "android.permission.POST_NOTIFICATIONS" in requested)
        assertEquals(emptyList<String>(), requested.filter { it.startsWith("android.permission.FOREGROUND_SERVICE") })
        missing("androidx.work.impl.foreground.SystemForegroundService") { ctx.packageManager.getServiceInfo(it, 0) }
    }

    @Test
    fun `the PDF renderer runs isolated and is not reachable from outside`() {
        val info = ctx.packageManager.getServiceInfo(ComponentName(ctx, PDF_SERVICE), 0)
        assertTrue("without isolatedProcess pdfium renders in the process with token and keys",
            info.flags and ServiceInfo.FLAG_ISOLATED_PROCESS != 0)
        assertFalse(info.exported)
    }

    private companion object {
        // The class is internal in feature-finances; the manifest names it by name.
        const val PDF_SERVICE = "ch.brickinventoryapp.finances.ui.pdf.PdfRenderService"
    }
}
