package ch.brickinventoryapp.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * `tools/manifest-check.py` against outputs in the format of
 * `aapt2 dump xmltree --file AndroidManifest.xml`, with the real allow list.
 *
 * Counter-checks:
 *   manifest-export-unchecked  the comparison with the allow list deleted → red
 *                               “a foreign exported component …”
 *   manifest-debuggable-ignored    the check for debuggable deleted → red “a debuggable …”
 * ProfileInstallReceiver again in manifest-exported.txt →
 *                               red “removed library components …”
 * the loop over uses-permission deleted →
 *                               red “a permission outside the list …”
 *   (run here) REQUEST_INSTALL_PACKAGES back in manifest-permissions.txt →
 *                               red “installing packages is not allowed …”
 *   manifest-telemetry-unchecked  the check of the datatransport backends deleted →
 *                               red “a telemetry backend of ML Kit …”
 */
class ManifestCheckTest {

    private fun component(kind: String, name: String, exported: Boolean, right: String? = null) = buildString {
        append("      E: $kind (line=10)\n")
        append("        A: http://schemas.android.com/apk/res/android:name(0x01010003)=\"$name\" (Raw: \"$name\")\n")
        append("        A: http://schemas.android.com/apk/res/android:exported(0x01010010)=$exported\n")
        if (right != null) append("        A: http://schemas.android.com/apk/res/android:permission(0x01010006)=\"$right\" (Raw: \"$right\")\n")
    }

    private fun right(name: String) =
        "    E: uses-permission (line=16)\n" +
            "      A: http://schemas.android.com/apk/res/android:name(0x01010003)=\"$name\" (Raw: \"$name\")\n"

    private fun manifest(vararg components: String, application: String = "", rights: List<String> = listOf(
        "android.permission.INTERNET", "android.permission.CAMERA")) =
        "N: android=http://schemas.android.com/apk/res/android (line=2)\n" +
            "  E: manifest (line=2)\n" +
            "    A: package=\"ch.brickinventoryapp\" (Raw: \"ch.brickinventoryapp\")\n" +
            rights.joinToString("") { right(it) } +
            "    E: application (line=80)\n" +
            "      A: http://schemas.android.com/apk/res/android:allowBackup(0x01010280)=false\n" +
            application + components.joinToString("")

    private val good = arrayOf(
        component("activity", "ch.brickinventoryapp.app.MainActivity", true),
        component("activity", "ch.brickinventoryapp.app.MessageEntryPoint", false),
        component("receiver", "ch.brickinventoryapp.app.widget.CollectionWidgetReceiver", true, "android.permission.BIND_APPWIDGET"),
        component("service", "androidx.work.impl.background.systemjob.SystemJobService", true, "android.permission.BIND_JOB_SERVICE"),
    )

    private fun check(text: String): Pair<Int, String> {
        val f = File.createTempFile("manifest", ".txt").apply { deleteOnExit(); writeText(text) }
        val p = ProcessBuilder("python3", "../tools/manifest-check.py", f.path, "../tools/manifest-exported.txt",
            "../tools/manifest-permissions.txt")
            .redirectErrorStream(true).start()
        val output = p.inputStream.bufferedReader().readText()
        check(p.waitFor(30, TimeUnit.SECONDS)) { output }
        return p.exitValue() to output
    }

    @Test
    fun `the expected manifest passes`() {
        val (code, text) = check(manifest(*good))
        assertEquals(text, 0, code)
    }

    @Test
    fun `a foreign exported component stands out, even with a wrong permission`() {
        val (code, text) = check(manifest(*good, component("provider", "com.beispiel.Offen", true)))
        assertEquals(1, code)
        assertTrue(text, "com.beispiel.Offen" in text)
        val (code2, text2) = check(manifest(component("activity", "ch.brickinventoryapp.app.MainActivity", true),
            component("receiver", "ch.brickinventoryapp.app.widget.CollectionWidgetReceiver", true)))
        assertEquals(1, code2)
        assertTrue(text2, "BIND_APPWIDGET" in text2)
    }

    /** Both come from libraries; the manifest removes them. */
    @Test
    fun `removed library components are not in the allow list`() {
        for ((kind, name, right) in listOf(
            Triple("receiver", "androidx.profileinstaller.ProfileInstallReceiver", "android.permission.DUMP"),
            Triple("service", "com.google.android.gms.auth.api.signin.RevocationBoundService",
                "com.google.android.gms.auth.api.signin.permission.REVOCATION_NOTIFICATION"),
        )) {
            val (code, text) = check(manifest(*good, component(kind, name, true, right)))
            assertEquals(text, 1, code)
        }
    }

    @Test
    fun `a debuggable APK, backup or cleartext stand out`() {
        val debuggable = "      A: http://schemas.android.com/apk/res/android:debuggable(0x0101000f)=true\n"
        assertEquals(1, check(manifest(*good, application = debuggable)).first)
        val plaintext = "      A: http://schemas.android.com/apk/res/android:usesCleartextTraffic(0x010104ec)=true\n"
        assertEquals(1, check(manifest(*good, application = plaintext)).first)
        val backup = manifest(*good).replace("allowBackup(0x01010280)=false", "allowBackup(0x01010280)=true")
        assertEquals(1, check(backup).first)
    }

    @Test
    fun `without recognizable components the format is wrong, not the manifest good`() {
        assertEquals(1, check(manifest()).first)
        assertEquals(1, check("irgendwas\n").first)
    }

    @Test
    fun `a permission outside the list or testOnly stands out`() {
        val (code, text) = check(manifest(*good, rights = listOf("android.permission.INTERNET", "android.permission.READ_PHONE_STATE")))
        assertEquals(text, 1, code)
        assertTrue(text, "READ_PHONE_STATE" in text)
        val testOnly = "      A: http://schemas.android.com/apk/res/android:testOnly(0x01010272)=true\n"
        assertEquals(1, check(manifest(*good, application = testOnly)).first)
    }

    /** The app comes from Google Play and installs nothing itself. */
    @Test
    fun `installing packages is not allowed, the release check rejects it`() {
        val (code, text) = check(manifest(*good, rights = listOf("android.permission.INTERNET",
            "android.permission.REQUEST_INSTALL_PACKAGES")))
        assertEquals(text, 1, code)
        assertTrue(text, "REQUEST_INSTALL_PACKAGES" in text)
    }

    /** ML Kit reports usage data via Google's datatransport; the app removes its backend. */
    @Test
    fun `a telemetry backend of ML Kit stands out, the service without backend does not`() {
        val service = component("service", "com.google.android.datatransport.runtime.backends.TransportBackendDiscovery", false)
        val backend = "        E: meta-data (line=6)\n" +
            "          A: http://schemas.android.com/apk/res/android:name(0x01010003)=" +
            "\"backend:com.google.android.datatransport.cct.CctBackendFactory\" " +
            "(Raw: \"backend:com.google.android.datatransport.cct.CctBackendFactory\")\n" +
            "          A: http://schemas.android.com/apk/res/android:value(0x01010024)=\"cct\" (Raw: \"cct\")\n"
        val (without, text) = check(manifest(*good, service))
        assertEquals(text, 0, without)
        val (with, text2) = check(manifest(*good, service + backend))
        assertEquals(text2, 1, with)
        assertTrue(text2, "CctBackendFactory" in text2)
    }
}
