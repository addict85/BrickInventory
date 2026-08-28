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
        val f = java.io.File("src/main/AndroidManifest.xml")
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

    @Test
    fun `minSdk bleibt unveraendert`() {
        assert(intAfter("minSdk") == 26) {
            "minSdk wurde mitgezogen. Der Sprung auf targetSdk 36 betrifft nur das " +
                "Verhalten auf neuen Geräten — ältere sollen weiter unterstützt bleiben."
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
