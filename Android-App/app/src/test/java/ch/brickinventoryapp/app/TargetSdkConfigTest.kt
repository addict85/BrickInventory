package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * Safeguarding of the target platform (SDK 36 / Android 16).
 *
 * The jump from 35 to 36 is harmless because the manifest does NOT do certain
 * things. Exactly that is what this class checks — otherwise it only stands out on
 * a tablet or when swiping back.
 *
 * The SDK levels stand in build-logic (Sdk.kt); a module script must not
 * override them, otherwise this class would check a number that does not apply.
 * Counter-checks (patches under counter-checks/, red as stated on 04.11.2026):
 *   sdk-minsdk-gehoben.patch   minSdk in Sdk.kt to 31 → red “minSdk is Android 11“
 */
class TargetSdkConfigTest {

    private val buildLogic = File(Sources.project, "build-logic/convention/src/main/kotlin/ch/brickinventoryapp/buildlogic")

    private val gradle: String by lazy {
        val f = File(buildLogic, "Sdk.kt")
        assert(f.exists()) { "build-logic/…/Sdk.kt nicht gefunden" }
        f.readText()
    }

    private val manifest: String by lazy {
        val f = Sources.manifest
        assert(f.exists()) { "AndroidManifest.xml nicht gefunden" }
        f.readText()
    }

    /** Hide XML comments — the explanatory texts name the patterns themselves. */
    private fun xmlCode(s: String) =
        s.replace(Regex("""<!--.*?-->""", RegexOption.DOT_MATCHES_ALL), "")

    private fun kotlinCode(s: String) =
        s.lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")

    private fun intAfter(key: String): Int {
        val m = Regex("""\b$key\s*=\s*(\d+)""").find(Sources.withoutComments(gradle))
        assert(m != null) { "$key nicht in Sdk.kt gefunden" }
        return m!!.groupValues[1].toInt()
    }

    @Test
    fun `no module script sets the SDK levels itself`() {
        val scripts = Sources.module.map { File(it, "build.gradle.kts") }
        assert(scripts.size >= 12) { "Nur ${scripts.size} Modulskripte gefunden — Suche veraltet?" }
        val set = Regex("""\b(compileSdk|minSdk|targetSdk)\s*=""")
        val own = scripts.filter { set.containsMatchIn(Sources.withoutComments(it.readText())) }
            .map { it.parentFile!!.name }
        assert(own.isEmpty()) { "Diese Module setzen SDK-Stände selbst statt über build-logic: $own" }
        // And the conventions take them from Sdk.kt, not as their own number.
        val conventions = buildLogic.listFiles { f -> f.extension == "kt" && f.name != "Sdk.kt" }.orEmpty()
        assert(conventions.size >= 2) { "Keine Konventionen unter ${buildLogic.path}" }
        val number = Regex("""\b(compileSdk|minSdk|targetSdk)\s*=\s*\d""")
        val fixed = conventions.filter { number.containsMatchIn(Sources.withoutComments(it.readText())) }.map { it.name }
        assert(fixed.isEmpty()) { "SDK-Stand als Zahl neben Sdk.kt: $fixed" }
    }

    @Test
    fun `compileSdk and targetSdk are 36 and identical`() {
        val compile = intAfter("compileSdk")
        val target = intAfter("targetSdk")
        assert(target >= 36) { "targetSdk ist $target, erwartet mindestens 36" }
        assert(compile == target) {
            "compileSdk ($compile) und targetSdk ($target) laufen auseinander. Erlaubt " +
                "wäre das, es verdeckt aber, welche Verhaltensänderungen tatsächlich " +
                "aktiv sind — hier bewusst gleichgezogen."
        }
    }

    // Android 11 as the lower bound: below it no security updates, and
    // only from 30 does the device lock bind a keystore key including PIN/pattern
    // (Schrittschutz). Whoever lowers it brings back the special paths for 8 to 10.
    @Test
    fun `minSdk is Android 11`() {
        assert(intAfter("minSdk") == 30) {
            "minSdk ist nicht mehr 30. Gesenkt fehlt die schlüsselgebundene Gerätesperre " +
                "für PIN und Muster; gehoben fallen Geräte weg, ohne dass es jemand entschieden hat."
        }
    }

    @Test
    fun `the manifest forces no orientation and no fixed size`() {
        val m = xmlCode(manifest)
        for (attr in listOf("android:screenOrientation", "android:resizeableActivity")) {
            assert(!m.contains(attr)) {
                "$attr im Manifest. Unter targetSdk 36 wird das auf grossen Displays " +
                    "ignoriert — die Zeile weckt also eine Erwartung, die das System " +
                    "nicht mehr erfüllt."
            }
        }
    }

    @Test
    fun `predictive back is opted in`() {
        val m = xmlCode(manifest)
        assert(m.contains("android:enableOnBackInvokedCallback")) {
            "enableOnBackInvokedCallback fehlt im Manifest. Unter targetSdk 36 ist es " +
                "standardmässig an — ausgeschrieben ist sichtbar, dass die Entscheidung " +
                "getroffen wurde, und der Schalter ist im Zweifel schnell zu finden."
        }
    }

    /**
     * If a BackHandler is introduced, predictive back swiping must be re-checked on
     * the device — until then the app leaves back
     * completely to the Navigation Compose default.
     */
    @Test
    fun `there is still no own BackHandler`() {
        // Lower bound: this check claims an ABSENCE.
        // If the file walk found nothing, it would be green — exactly when
        // it is worth least.
        val hits = Sources.all()
            .asSequence()
            .filter { kotlinCode(it.readText()).contains("BackHandler(") }
            .map { it.name }
            .toList()
        assert(hits.isEmpty()) {
            "Neuer BackHandler in ${hits.joinToString()}. Das ist erlaubt, aber unter " +
                "targetSdk 36 läuft vorhersagendes Zurück standardmässig — bitte auf " +
                "einem Gerät prüfen, dass die Wischgeste noch am richtigen Ziel landet."
        }
    }
}
