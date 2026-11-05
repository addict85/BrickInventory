package ch.brickinventoryapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * tools/manifest-pruefen.py gegen Ausgaben im Format von
 * `aapt2 dump xmltree --file AndroidManifest.xml`, mit der echten Positivliste.
 *
 * Gegenproben:
 *   manifest-export-ungeprueft  der Vergleich mit der Positivliste gestrichen → rot
 *                               „eine fremde exportierte Komponente …“
 *   manifest-debuggable-egal    die Prüfung auf debuggable gestrichen → rot „ein debuggable …“
 *   (05.11.2026, python3 lokal) ProfileInstallReceiver wieder in manifest-exportiert.txt →
 *                               rot „herausgenommene Bibliothekskomponenten …“
 *   (05.11.2026, sec17 B-N12, python3 lokal) die Schleife über uses-permission gestrichen →
 *                               rot „eine Berechtigung ausserhalb der Liste …“
 */
class ManifestPruefenTest {

    private fun komponente(art: String, name: String, exportiert: Boolean, recht: String? = null) = buildString {
        append("      E: $art (line=10)\n")
        append("        A: http://schemas.android.com/apk/res/android:name(0x01010003)=\"$name\" (Raw: \"$name\")\n")
        append("        A: http://schemas.android.com/apk/res/android:exported(0x01010010)=$exportiert\n")
        if (recht != null) append("        A: http://schemas.android.com/apk/res/android:permission(0x01010006)=\"$recht\" (Raw: \"$recht\")\n")
    }

    private fun recht(name: String) =
        "    E: uses-permission (line=16)\n" +
            "      A: http://schemas.android.com/apk/res/android:name(0x01010003)=\"$name\" (Raw: \"$name\")\n"

    private fun manifest(vararg komponenten: String, anwendung: String = "", rechte: List<String> = listOf(
        "android.permission.INTERNET", "android.permission.CAMERA")) =
        "N: android=http://schemas.android.com/apk/res/android (line=2)\n" +
            "  E: manifest (line=2)\n" +
            "    A: package=\"ch.brickinventoryapp\" (Raw: \"ch.brickinventoryapp\")\n" +
            rechte.joinToString("") { recht(it) } +
            "    E: application (line=80)\n" +
            "      A: http://schemas.android.com/apk/res/android:allowBackup(0x01010280)=false\n" +
            anwendung + komponenten.joinToString("")

    private val gut = arrayOf(
        komponente("activity", "ch.brickinventoryapp.MainActivity", true),
        komponente("activity", "ch.brickinventoryapp.MeldungsEinstieg", false),
        komponente("receiver", "ch.brickinventoryapp.widget.SammlungsWidgetEmpfaenger", true, "android.permission.BIND_APPWIDGET"),
        komponente("service", "androidx.work.impl.background.systemjob.SystemJobService", true, "android.permission.BIND_JOB_SERVICE"),
    )

    private fun pruefe(text: String): Pair<Int, String> {
        val f = File.createTempFile("manifest", ".txt").apply { deleteOnExit(); writeText(text) }
        val p = ProcessBuilder("python3", "../tools/manifest-pruefen.py", f.path, "../tools/manifest-exportiert.txt",
            "../tools/manifest-berechtigungen.txt")
            .redirectErrorStream(true).start()
        val ausgabe = p.inputStream.bufferedReader().readText()
        check(p.waitFor(30, TimeUnit.SECONDS)) { ausgabe }
        return p.exitValue() to ausgabe
    }

    @Test
    fun `das erwartete Manifest geht durch`() {
        val (code, text) = pruefe(manifest(*gut))
        assertEquals(text, 0, code)
    }

    @Test
    fun `eine fremde exportierte Komponente faellt auf, auch mit falscher Berechtigung`() {
        val (code, text) = pruefe(manifest(*gut, komponente("provider", "com.beispiel.Offen", true)))
        assertEquals(1, code)
        assertTrue(text, "com.beispiel.Offen" in text)
        val (code2, text2) = pruefe(manifest(komponente("activity", "ch.brickinventoryapp.MainActivity", true),
            komponente("receiver", "ch.brickinventoryapp.widget.SammlungsWidgetEmpfaenger", true)))
        assertEquals(1, code2)
        assertTrue(text2, "BIND_APPWIDGET" in text2)
    }

    /** CI-Lauf 42086613735: Beide kamen aus Bibliotheken; das Manifest nimmt sie heraus. */
    @Test
    fun `herausgenommene Bibliothekskomponenten stehen nicht in der Positivliste`() {
        for ((art, name, recht) in listOf(
            Triple("receiver", "androidx.profileinstaller.ProfileInstallReceiver", "android.permission.DUMP"),
            Triple("service", "com.google.android.gms.auth.api.signin.RevocationBoundService",
                "com.google.android.gms.auth.api.signin.permission.REVOCATION_NOTIFICATION"),
        )) {
            val (code, text) = pruefe(manifest(*gut, komponente(art, name, true, recht)))
            assertEquals(text, 1, code)
        }
    }

    @Test
    fun `ein debuggable APK, Sicherung oder Klartext fallen auf`() {
        val debuggable = "      A: http://schemas.android.com/apk/res/android:debuggable(0x0101000f)=true\n"
        assertEquals(1, pruefe(manifest(*gut, anwendung = debuggable)).first)
        val klartext = "      A: http://schemas.android.com/apk/res/android:usesCleartextTraffic(0x010104ec)=true\n"
        assertEquals(1, pruefe(manifest(*gut, anwendung = klartext)).first)
        val sicherung = manifest(*gut).replace("allowBackup(0x01010280)=false", "allowBackup(0x01010280)=true")
        assertEquals(1, pruefe(sicherung).first)
    }

    @Test
    fun `ohne erkennbare Komponenten ist das Format falsch, nicht das Manifest gut`() {
        assertEquals(1, pruefe(manifest()).first)
        assertEquals(1, pruefe("irgendwas\n").first)
    }

    @Test
    fun `eine Berechtigung ausserhalb der Liste oder testOnly faellt auf`() {
        val (code, text) = pruefe(manifest(*gut, rechte = listOf("android.permission.INTERNET", "android.permission.READ_PHONE_STATE")))
        assertEquals(text, 1, code)
        assertTrue(text, "READ_PHONE_STATE" in text)
        val testOnly = "      A: http://schemas.android.com/apk/res/android:testOnly(0x01010272)=true\n"
        assertEquals(1, pruefe(manifest(*gut, anwendung = testOnly)).first)
    }
}
