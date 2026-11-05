package ch.brickinventoryapp

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Exportierte Komponenten aus Bibliotheken, die die App nicht braucht, stehen nicht
 * im zusammengeführten Manifest (CI-Lauf 42086613735, Job apk-pruefen). Gelesen über
 * den PackageManager, der das Manifest des Builds kennt.
 *
 * Gegenproben (Robolectric, misst die CI; Job `gegenproben`):
 *   widerrufsdienst-exportiert  tools:node="remove" am RevocationBoundService entfernt →
 *                               rot „Google-Sign-in …“
 *   profilempfaenger-exportiert tools:node="remove" am ProfileInstallReceiver entfernt →
 *                               rot „der Profileinstaller …“
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
            ComponentName(ctx.packageName, "ch.brickinventoryapp.widget.SammlungsWidgetEmpfaenger"), 0)
        assertTrue(info.exported)
    }
}
