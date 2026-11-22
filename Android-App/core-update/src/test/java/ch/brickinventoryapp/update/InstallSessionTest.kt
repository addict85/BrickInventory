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
import ch.brickinventoryapp.update.util.InstallMessage
import ch.brickinventoryapp.update.util.InstallReceiver
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
 * Counter-checks (Robolectric, measurable only in CI; job `counter-checks`):
 *   the STATUS_PENDING_USER_ACTION branch in the receiver has no effect → red „verlangt das System eine Bestaetigung …“ (counter-checks/installer-ohne-bestaetigung.patch)
 *   EXTRA_INTENT in the receiver launched unchecked again → red „eine Bestaetigung, die nicht zum System-Installer fuehrt …“ (counter-checks/installer-ziel-ungeprueft.patch)
 */
@RunWith(RobolectricTestRunner::class)
class InstallSessionTest {

    private val app = ApplicationProvider.getApplicationContext<Application>()

    @Test
    fun `the APK goes into a session for the own package, no intent to the outside`() {
        val apk = File(app.cacheDir, "probe.apk").apply { writeBytes(ByteArray(64) { it.toByte() }) }
        install(app, apk)
        val session = app.packageManager.packageInstaller.allSessions.single()
        assertEquals(app.packageName, session.appPackageName)
        assertNull("Kein Intent an andere Apps", shadowOf(app).nextStartedActivity)
    }

    /** A package with an Activity for the confirmation dialog, as a system app or not. */
    private fun installer(pkg: String, system: Boolean): ComponentName {
        val component = ComponentName(pkg, "$pkg.InstallStart")
        val pm = shadowOf(app.packageManager)
        pm.installPackage(PackageInfo().apply {
            packageName = pkg
            applicationInfo = ApplicationInfo().apply {
                packageName = pkg
                flags = if (system) ApplicationInfo.FLAG_SYSTEM else 0
            }
        })
        pm.addActivityIfNotPresent(component)
        pm.addIntentFilterForActivity(component,
            IntentFilter(INSTALLATION_CONFIRM).apply { addCategory(Intent.CATEGORY_DEFAULT) })
        return component
    }

    private fun reportConfirmation(dialog: Intent) = InstallReceiver().onReceive(app, Intent()
        .putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_PENDING_USER_ACTION)
        .putExtra(Intent.EXTRA_INTENT, dialog))

    @Test
    fun `if the system requires a confirmation, the receiver opens its dialog`() {
        val system = installer("com.android.packageinstaller", system = true)
        reportConfirmation(Intent(INSTALLATION_CONFIRM).setPackage(system.packageName))
        val started = shadowOf(app).nextStartedActivity
        assertEquals(INSTALLATION_CONFIRM, started?.action)
        assertEquals("Gestartet wird genau die geprüfte Komponente", system, started!!.component)
        assertTrue((started.flags and Intent.FLAG_ACTIVITY_NEW_TASK) != 0)
    }

    @Test
    fun `a confirmation that does not lead to the system installer starts nothing`() {
        installer("com.android.packageinstaller", system = true)
        val foreign = installer("com.example.falscherinstaller", system = false)
        InstallMessage.error.value = null
        reportConfirmation(Intent(INSTALLATION_CONFIRM).setPackage(foreign.packageName))
        assertNull("Eine App, die sich nur als Installer ausgibt, wird nicht gestartet",
            shadowOf(app).nextStartedActivity)
        assertNotNull("Der Nutzer erfährt, warum nichts kommt", InstallMessage.error.value)
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
        InstallMessage.error.value = null
        InstallReceiver().onReceive(app, Intent()
            .putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE_CONFLICT)
            .putExtra(PackageInstaller.EXTRA_STATUS_MESSAGE, "Signatur passt nicht"))
        assertEquals("Signatur passt nicht", InstallMessage.error.value)
    }
}
