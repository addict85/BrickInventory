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
 * Exportierte Komponenten aus Bibliotheken, die die App nicht braucht, stehen nicht
 * im zusammengeführten Manifest. Gelesen über den PackageManager, der nur im Modul
 * app das Manifest der ganzen App kennt; in einem feature-Modul sähe er nur dessen
 * eigenes.
 *
 * Gegenproben (Robolectric, misst die CI; Job `gegenproben`):
 *   widerrufsdienst-exportiert  tools:node="remove" am RevocationBoundService entfernt →
 *                               rot „Google-Sign-in …“
 *   profilempfaenger-exportiert tools:node="remove" am ProfileInstallReceiver entfernt →
 *                               rot „der Profileinstaller …“
 *   pdf-renderer-im-app-prozess isolatedProcess am PdfRenderDienst entfernt → rot
 *                               „der PDF-Renderer läuft isoliert …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class BibliotheksKomponentenTest {

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
    fun `der Widerrufsdienst von Google-Sign-in ist nicht im Manifest`() =
        fehlt("com.google.android.gms.auth.api.signin.RevocationBoundService") { ctx.packageManager.getServiceInfo(it, 0) }

    @Test
    fun `der Profileinstaller ist nicht im Manifest`() =
        fehlt("androidx.profileinstaller.ProfileInstallReceiver") { ctx.packageManager.getReceiverInfo(it, 0) }

    @Test
    fun `die Pruefung sieht das Manifest ueberhaupt`() {
        // Sonst wären beide Tests oben grün, weil der PackageManager gar nichts kennt.
        val info = ctx.packageManager.getReceiverInfo(
            ComponentName(ctx.packageName, "ch.brickinventoryapp.app.widget.SammlungsWidgetEmpfaenger"), 0)
        assertTrue(info.exported)
    }

    @Test
    fun `der PDF-Renderer laeuft isoliert und ist von aussen nicht erreichbar`() {
        val info = ctx.packageManager.getServiceInfo(ComponentName(ctx, PDF_DIENST), 0)
        assertTrue("Ohne isolatedProcess rendert pdfium im Prozess mit Token und Schlüsseln",
            info.flags and ServiceInfo.FLAG_ISOLATED_PROCESS != 0)
        assertFalse(info.exported)
    }

    private companion object {
        // Die Klasse ist internal in feature-finanzen; das Manifest nennt sie beim Namen.
        const val PDF_DIENST = "ch.brickinventoryapp.finanzen.ui.pdf.PdfRenderDienst"
    }
}
