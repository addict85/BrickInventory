package ch.brickinventoryapp

import org.junit.Test

/**
 * Absicherung der Ziel-Plattform (SDK 36 / Android 16).
 *
 * Der Sprung von 35 auf 36 ist deshalb harmlos, weil das Manifest bestimmte
 * Dinge NICHT tut. Genau das prüft diese Klasse — sonst fällt es erst auf
 * einem Tablet oder beim Zurückwischen auf.
 */
class TargetSdkConfigTest {

    private val gradle: String by lazy {
        val f = java.io.File("build.gradle.kts")
        assert(f.exists()) { "app/build.gradle.kts nicht gefunden" }
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
        val m = Regex("""$key\s*=\s*(\d+)""").find(kotlinCode(gradle))
        assert(m != null) { "$key nicht in build.gradle.kts gefunden" }
        return m!!.groupValues[1].toInt()
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

    // Android 11 als Untergrenze (sec8 H11): Darunter keine Sicherheitsupdates, und
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
