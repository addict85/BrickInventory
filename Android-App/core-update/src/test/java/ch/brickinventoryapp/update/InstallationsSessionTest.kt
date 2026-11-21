package ch.brickinventoryapp.update

import android.app.Application
import android.content.ComponentName
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.update.util.INSTALLATION_CONFIRM
import ch.brickinventoryapp.update.util.InstallationsEmpfaenger
import ch.brickinventoryapp.update.util.Installationsmeldung
import ch.brickinventoryapp.update.util.install
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
 * The self-update installs via a PackageInstaller session, not via
 * an implicit intent; the system's response lands in our own receiver.
 *
 * Counter-checks (Robolectric, measurable only in CI; job `gegenproben`):
 *   the STATUS_PENDING_USER_ACTION branch in the receiver has no effect → red „verlangt
 *   das System eine Bestaetigung …“ (gegenproben/installer-ohne-bestaetigung.patch)
 *   EXTRA_INTENT in the receiver launched unchecked again → red „eine Bestaetigung,
 *   die nicht zum System-Installer fuehrt …“ (gegenproben/installer-ziel-ungeprueft.patch)
 */
@RunWith(RobolectricTestRunner::class)
class InstallationsSessionTest {

    private val app = ApplicationProvider.getApplicationContext<Application>()

    @Test
    fun `the APK goes into a session for the own package, no intent to the outside`() {
        val apk = File(app.cacheDir, "probe.apk").apply { writeBytes(ByteArray(64) { it.toByte() }) }
        install(app, apk)
        val sitzung = app.packageManager.packageInstaller.allSessions.single()
        assertEquals(app.packageName, sitzung.appPackageName)
        assertNull("Kein Intent an andere Apps", shadowOf(app).nextStartedActivity)
    }

    /** A package with an Activity for the confirmation dialog, as a system app or not. */
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
            IntentFilter(INSTALLATION_CONFIRM).apply { addCategory(Intent.CATEGORY_DEFAULT) })
        return komponente
    }

    private fun reportConfirmation(dialog: Intent) = InstallationsEmpfaenger().onReceive(app, Intent()
        .putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_PENDING_USER_ACTION)
        .putExtra(Intent.EXTRA_INTENT, dialog))

    @Test
    fun `if the system requires a confirmation, the receiver opens its dialog`() {
        val system = installer("com.android.packageinstaller", system = true)
        reportConfirmation(Intent(INSTALLATION_CONFIRM).setPackage(system.packageName))
        val gestartet = shadowOf(app).nextStartedActivity
        assertEquals(INSTALLATION_CONFIRM, gestartet?.action)
        assertEquals("Gestartet wird genau die geprüfte Komponente", system, gestartet!!.component)
        assertTrue((gestartet.flags and Intent.FLAG_ACTIVITY_NEW_TASK) != 0)
    }

    @Test
    fun `a confirmation that does not lead to the system installer starts nothing`() {
        installer("com.android.packageinstaller", system = true)
        val fremd = installer("com.example.falscherinstaller", system = false)
        Installationsmeldung.fehler.value = null
        reportConfirmation(Intent(INSTALLATION_CONFIRM).setPackage(fremd.packageName))
        assertNull("Eine App, die sich nur als Installer ausgibt, wird nicht gestartet",
            shadowOf(app).nextStartedActivity)
        assertNotNull("Der Nutzer erfährt, warum nichts kommt", Installationsmeldung.fehler.value)
    }

    @Test
    fun `a confirmation with Uri rights does not start the system installer either`() {
        val system = installer("com.android.packageinstaller", system = true)
        reportConfirmation(Intent(INSTALLATION_CONFIRM).setPackage(system.packageName)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        assertNull("Ein Uri-Recht würde mit unserer Identität vergeben", shadowOf(app).nextStartedActivity)
    }

    @Test
    fun `a failure is reported`() {
        Installationsmeldung.fehler.value = null
        InstallationsEmpfaenger().onReceive(app, Intent()
            .putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE_CONFLICT)
            .putExtra(PackageInstaller.EXTRA_STATUS_MESSAGE, "Signatur passt nicht"))
        assertEquals("Signatur passt nicht", Installationsmeldung.fehler.value)
    }
}
