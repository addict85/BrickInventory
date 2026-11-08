package ch.brickinventoryapp

import android.app.Application
import android.content.ComponentName
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.util.INSTALLATION_BESTAETIGEN
import ch.brickinventoryapp.util.InstallationsEmpfaenger
import ch.brickinventoryapp.util.Installationsmeldung
import ch.brickinventoryapp.util.installiere
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import java.io.File

/**
 * Das Selbst-Update installiert über eine PackageInstaller-Sitzung, nicht über
 * einen impliziten Intent; die Antwort des Systems landet im eigenen Empfänger.
 *
 * Gegenproben (Robolectric, nur in der CI messbar; Job `gegenproben`):
 *   im Empfänger der Zweig STATUS_PENDING_USER_ACTION ohne Wirkung → rot „verlangt
 *   das System eine Bestaetigung …“ (gegenproben/installer-ohne-bestaetigung.patch)
 *   im Empfänger EXTRA_INTENT wieder ungeprüft gestartet → rot „eine Bestaetigung,
 *   die nicht zum System-Installer fuehrt …“ (gegenproben/installer-ziel-ungeprueft.patch)
 */
@RunWith(RobolectricTestRunner::class)
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

    /** Ein Paket mit einer Activity für den Bestätigungsdialog, als System-App oder nicht. */
    private fun installer(paket: String, system: Boolean): ComponentName {
        val komponente = ComponentName(paket, "$paket.InstallStart")
        val pm = shadowOf(app.packageManager)
        pm.installPackage(PackageInfo().apply {
            packageName = paket
            applicationInfo = ApplicationInfo().apply {
                packageName = paket
                flags = if (system) ApplicationInfo.FLAG_SYSTEM else 0
            }
        })
        pm.addActivityIfNotPresent(komponente)
        pm.addIntentFilterForActivity(komponente,
            IntentFilter(INSTALLATION_BESTAETIGEN).apply { addCategory(Intent.CATEGORY_DEFAULT) })
        return komponente
    }

    private fun meldeBestaetigung(dialog: Intent) = InstallationsEmpfaenger().onReceive(app, Intent()
        .putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_PENDING_USER_ACTION)
        .putExtra(Intent.EXTRA_INTENT, dialog))

    @Test
    fun `verlangt das System eine Bestaetigung, oeffnet der Empfaenger seinen Dialog`() {
        val system = installer("com.android.packageinstaller", system = true)
        meldeBestaetigung(Intent(INSTALLATION_BESTAETIGEN).setPackage(system.packageName))
        val gestartet = shadowOf(app).nextStartedActivity
        assertEquals(INSTALLATION_BESTAETIGEN, gestartet?.action)
        assertEquals("Gestartet wird genau die geprüfte Komponente", system, gestartet!!.component)
        assertTrue((gestartet.flags and Intent.FLAG_ACTIVITY_NEW_TASK) != 0)
    }

    @Test
    fun `eine Bestaetigung, die nicht zum System-Installer fuehrt, startet nichts`() {
        installer("com.android.packageinstaller", system = true)
        val fremd = installer("com.example.falscherinstaller", system = false)
        Installationsmeldung.fehler.value = null
        meldeBestaetigung(Intent(INSTALLATION_BESTAETIGEN).setPackage(fremd.packageName))
        assertNull("Eine App, die sich nur als Installer ausgibt, wird nicht gestartet",
            shadowOf(app).nextStartedActivity)
        assertNotNull("Der Nutzer erfährt, warum nichts kommt", Installationsmeldung.fehler.value)
    }

    @Test
    fun `eine Bestaetigung mit Uri-Rechten startet auch den System-Installer nicht`() {
        val system = installer("com.android.packageinstaller", system = true)
        meldeBestaetigung(Intent(INSTALLATION_BESTAETIGEN).setPackage(system.packageName)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        assertNull("Ein Uri-Recht würde mit unserer Identität vergeben", shadowOf(app).nextStartedActivity)
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
