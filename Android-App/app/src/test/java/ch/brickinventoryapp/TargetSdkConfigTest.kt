package ch.brickinventoryapp

import org.junit.Test
import java.io.File

/**
 * Absicherung der Ziel-Plattform (SDK 36 / Android 16).
 *
 * Der Sprung von 35 auf 36 ist deshalb harmlos, weil das Manifest bestimmte
 * Dinge NICHT tut. Genau das prüft diese Klasse — sonst fällt es erst auf
 * einem Tablet oder beim Zurückwischen auf.
 *
 * Die SDK-Stände stehen in build-logic (Sdk.kt); ein Modulskript darf sie nicht
 * überschreiben, sonst prüfte diese Klasse eine Zahl, die nicht gilt.
 * Gegenproben (Patches unter gegenproben/, am 04.11.2026 rot wie angegeben):
 *   sdk-minsdk-gehoben.patch   minSdk in Sdk.kt auf 31 → rot „minSdk ist Android 11“
 */
class TargetSdkConfigTest {

    private val buildLogic = File(Quellen.projekt, "build-logic/convention/src/main/kotlin/ch/brickinventoryapp/buildlogic")

    private val gradle: String by lazy {
        val f = File(buildLogic, "Sdk.kt")
        assert(f.exists()) { "build-logic/…/Sdk.kt nicht gefunden" }
        f.readText()
    }

    private val manifest: String by lazy {
        val f = Quellen.manifest
        assert(f.exists()) { "AndroidManifest.xml nicht gefunden" }
        f.readText()
    }

    /** XML-Kommentare ausblenden — die Erklärtexte nennen die Muster selbst. */
    private fun xmlCode(s: String) =
        s.replace(Regex("""<!--.*?-->""", RegexOption.DOT_MATCHES_ALL), "")

    private fun kotlinCode(s: String) =
        s.lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")

    private fun intAfter(key: String): Int {
        val m = Regex("""\b$key\s*=\s*(\d+)""").find(Quellen.ohneKommentare(gradle))
        assert(m != null) { "$key nicht in Sdk.kt gefunden" }
        return m!!.groupValues[1].toInt()
    }

    @Test
    fun `kein Modulskript setzt die SDK-Stände selbst`() {
        val skripte = Quellen.module.map { File(it, "build.gradle.kts") }
        assert(skripte.size >= 12) { "Nur ${skripte.size} Modulskripte gefunden — Suche veraltet?" }
        val setzen = Regex("""\b(compileSdk|minSdk|targetSdk)\s*=""")
        val eigene = skripte.filter { setzen.containsMatchIn(Quellen.ohneKommentare(it.readText())) }
            .map { it.parentFile!!.name }
        assert(eigene.isEmpty()) { "Diese Module setzen SDK-Stände selbst statt über build-logic: $eigene" }
        // Und die Konventionen nehmen sie aus Sdk.kt, nicht als eigene Zahl.
        val konventionen = buildLogic.listFiles { f -> f.extension == "kt" && f.name != "Sdk.kt" }.orEmpty()
        assert(konventionen.size >= 2) { "Keine Konventionen unter ${buildLogic.path}" }
        val zahl = Regex("""\b(compileSdk|minSdk|targetSdk)\s*=\s*\d""")
        val fest = konventionen.filter { zahl.containsMatchIn(Quellen.ohneKommentare(it.readText())) }.map { it.name }
        assert(fest.isEmpty()) { "SDK-Stand als Zahl neben Sdk.kt: $fest" }
    }

    @Test
    fun `compileSdk und targetSdk sind 36 und identisch`() {
        val compile = intAfter("compileSdk")
        val target = intAfter("targetSdk")
        assert(target >= 36) { "targetSdk ist $target, erwartet mindestens 36" }
        assert(compile == target) {
            "compileSdk ($compile) und targetSdk ($target) laufen auseinander. Erlaubt " +
                "wäre das, es verdeckt aber, welche Verhaltensänderungen tatsächlich " +
                "aktiv sind — hier bewusst gleichgezogen."
        }
    }

    // Android 11 als Untergrenze: Darunter keine Sicherheitsupdates, und
    // erst ab 30 bindet die Gerätesperre einen Keystore-Schlüssel samt PIN/Muster
    // (Schrittschutz). Wer sie senkt, holt die Sonderwege für 8 bis 10 zurück.
    @Test
    fun `minSdk ist Android 11`() {
        assert(intAfter("minSdk") == 30) {
            "minSdk ist nicht mehr 30. Gesenkt fehlt die schlüsselgebundene Gerätesperre " +
                "für PIN und Muster; gehoben fallen Geräte weg, ohne dass es jemand entschieden hat."
        }
    }

    @Test
    fun `das Manifest erzwingt keine Ausrichtung und keine feste Groesse`() {
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
    fun `vorhersagendes Zurueck ist ausgeschrieben`() {
        val m = xmlCode(manifest)
        assert(m.contains("android:enableOnBackInvokedCallback")) {
            "enableOnBackInvokedCallback fehlt im Manifest. Unter targetSdk 36 ist es " +
                "standardmässig an — ausgeschrieben ist sichtbar, dass die Entscheidung " +
                "getroffen wurde, und der Schalter ist im Zweifel schnell zu finden."
        }
    }

    /**
     * Wird ein BackHandler eingeführt, muss vorhersagendes Zurückwischen auf
     * dem Gerät nachgeprüft werden — bis dahin überlässt die App Zurück
     * komplett der Navigation-Compose-Voreinstellung.
     */
    @Test
    fun `es gibt weiterhin keinen eigenen BackHandler`() {
        // Untergrenze (Nachtrag 118): Diese Prüfung behauptet eine ABWESENHEIT.
        // Fände der Dateilauf nichts, wäre sie grün — und zwar genau dann,
        // wenn sie am wenigsten wert ist.
        val hits = Quellen.alle()
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
