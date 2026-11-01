package ch.brickinventoryapp

import android.app.Application
import android.content.Intent
import android.content.pm.PackageInstaller
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.util.InstallationsEmpfaenger
import ch.brickinventoryapp.util.Installationsmeldung
import ch.brickinventoryapp.util.installiere
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File

/**
 * Das Selbst-Update installiert über eine PackageInstaller-Sitzung, nicht über
 * einen impliziten Intent; die Antwort des Systems landet im eigenen Empfänger.
 *
 * Gegenprobe (Robolectric, nur in der CI messbar; Job `gegenproben`):
 *   im Empfänger der Zweig STATUS_PENDING_USER_ACTION ohne Wirkung → rot „verlangt
 *   das System eine Bestaetigung …“ (gegenproben/installer-ohne-bestaetigung.patch)
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class InstallationsSitzungTest {

    private val app = ApplicationProvider.getApplicationContext<Application>()

    @Test
    fun `das APK geht in eine Sitzung fuer das eigene Paket, kein Intent nach aussen`() {
        val apk = File(app.cacheDir, "probe.apk").apply { writeBytes(ByteArray(64) { it.toByte() }) }
        installiere(app, apk)
        val sitzung = app.packageManager.packageInstaller.allSessions.single()
        assertEquals(app.packageName, sitzung.appPackageName)
        assertNull("Kein Intent an andere Apps", shadowOf(app).nextStartedActivity)
    }

    @Test
    fun `verlangt das System eine Bestaetigung, oeffnet der Empfaenger seinen Dialog`() {
        val dialog = Intent("android.content.pm.action.CONFIRM_INSTALL")
        InstallationsEmpfaenger().onReceive(app, Intent()
            .putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_PENDING_USER_ACTION)
            .putExtra(Intent.EXTRA_INTENT, dialog))
        val gestartet = shadowOf(app).nextStartedActivity
        assertEquals("android.content.pm.action.CONFIRM_INSTALL", gestartet?.action)
        assertTrue((gestartet!!.flags and Intent.FLAG_ACTIVITY_NEW_TASK) != 0)
    }

    @Test
    fun `ein Fehlschlag wird gemeldet`() {
        Installationsmeldung.fehler.value = null
        InstallationsEmpfaenger().onReceive(app, Intent()
            .putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE_CONFLICT)
            .putExtra(PackageInstaller.EXTRA_STATUS_MESSAGE, "Signatur passt nicht"))
        assertEquals("Signatur passt nicht", Installationsmeldung.fehler.value)
    }
}
