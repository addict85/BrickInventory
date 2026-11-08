package ch.brickinventoryapp.app

import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Absicherung der 16-KB-Speicherseiten-Tauglichkeit.
 *
 * Vier native Bibliotheken lagen im APK, alle mit 4-KB-Ausrichtung:
 *
 * Jede dieser Entscheidungen lässt sich mit einer einzigen Zeile in
 * libs.versions.toml wieder rückgängig machen, ohne dass es auffiele —
 * deshalb dieser Test.
 */
class SixteenKbAlignmentTest {

    private val toml: String by lazy {
        val f = File("../gradle/libs.versions.toml")
        assert(f.exists()) { "gradle/libs.versions.toml nicht gefunden" }
        f.readText()
    }

    private val gradle: String by lazy {
        val f = File("build.gradle.kts")
        assert(f.exists()) { "app/build.gradle.kts nicht gefunden" }
        f.readText().lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")
    }

    private val manifest: String by lazy {
        val f = Quellen.manifest
        assert(f.exists()) { "AndroidManifest.xml nicht gefunden" }
        f.readText().replace(Regex("""<!--.*?-->""", RegexOption.DOT_MATCHES_ALL), "")
    }

    @Test
    fun `CameraX ist mindestens 1_4`() {
        val m = Regex("""camerax\s*=\s*"(\d+)\.(\d+)\.""").find(toml)
        assert(m != null) { "camerax-Version nicht gefunden" }
        val major = m!!.groupValues[1].toInt()
        val minor = m.groupValues[2].toInt()
        assert(major > 1 || minor >= 4) {
            "CameraX $major.$minor: erst ab 1.4.0 ist libimage_processing_util_jni.so " +
                "auf 16 KB ausgerichtet."
        }
    }

    @Test
    fun `ML Kit laeuft unbundled ueber die Play-Dienste`() {
        assert(toml.contains("play-services-mlkit-barcode-scanning")) {
            "Das gebündelte ML Kit (com.google.mlkit:barcode-scanning) ist zurück. " +
                "Dessen libbarhopper_v3.so war auch in 17.3.0 noch 4-KB-ausgerichtet — " +
                "die einzige verlässliche Lösung ist das unbundled Paket, bei dem das " +
                "Modell in den Play-Diensten liegt und gar nicht erst ins APK kommt."
        }
        assert(!Regex("""name\s*=\s*"barcode-scanning"""").containsMatchIn(toml)) {
            "Es ist noch ein gebündeltes barcode-scanning-Artefakt deklariert"
        }
    }

    /**
     * Ohne diesen Eintrag lädt das Modell erst beim ersten Scan — dann geht der
     * erste Scan ohne Netz nicht.
     */
    @Test
    fun `das Barcode-Modul wird bei der Installation angefordert`() {
        assert(manifest.contains("com.google.mlkit.vision.DEPENDENCIES")) {
            "meta-data com.google.mlkit.vision.DEPENDENCIES fehlt im Manifest"
        }
        assert(Regex("""android:value\s*=\s*"barcode"""").containsMatchIn(manifest)) {
            "Der DEPENDENCIES-Eintrag fordert nicht das barcode-Modul an"
        }
    }

    @Test
    fun `DataStore wird auf EINE Fassung festgenagelt`() {
        // ── Was diese Pruefung NICHT mehr tut ───────────────────────────────
        //
        // Hier stand `== "1.1.7"`: eine bestimmte NUMMER, weil 1.2.0 die
        // 16-KB-Ausrichtung verloren hatte. Das hatte zwei Luecken, und beide
        // sind grundsaetzlich:
        //
        //   1. Es prueft die Nummer, nicht die Ausrichtung. Richtet Google
        //      eine spaetere Fassung wieder aus, bleibt der Riegel trotzdem
        //      zu. Faellt eine ANDERE Bibliothek zurueck, merkt es niemand.
        //
        // Gemessen wird das jetzt am ERGEBNIS: tools/apk-ausrichtung.py liest
        // die ELF-Koepfe aller .so im gebauten APK und meldet jede Ausrichtung
        // unter 16 KB. Die Action ruft es nach dem Release-Bau auf.
        //
        // Was hier BLEIBT, ist das, was ein Texttest kann und jene Messung
        // nicht: dass die Fassung ueberhaupt FESTGENAGELT ist. Ohne den
        // force-Block zoege eine andere Abhaengigkeit die Fassung transitiv
        // hoch, und das APK waere beim naechsten Mal ein anderes als geprueft.
        assert(Regex("""datastore\s*=\s*"([\d.]+)"""").containsMatchIn(toml)) { "datastore-Version nicht gefunden" }
        val block = gradle.substringAfter("resolutionStrategy", "")
        assert("libs.versions.datastore.get()" in gradle && "force(\"androidx.datastore:\$it:\$datastore\")" in block) {
            "DataStore wird nicht auf die Fassung des Katalogs festgenagelt"
        }
        for (artefakt in listOf("datastore", "datastore-android", "datastore-core",
                                "datastore-core-android", "datastore-preferences",
                                "datastore-preferences-android")) {
            assert("\"$artefakt\"" in block) {
                "androidx.datastore:$artefakt wird nicht festgenagelt. Eine " +
                    "transitive Anhebung wuerde ein anderes APK ergeben als das geprüfte."
            }
        }
    }

    /**
     * graphics-path kommt sonst transitiv über Compose herein. Der direkte
     * Eintrag hebt es auf die eigene, neuere Versionslinie — ohne die
     * Compose-BOM anzufassen, was eine breite Änderung quer durch die
     * Oberfläche wäre.
     */
    @Test
    fun `graphics-path ist direkt festgelegt`() {
        assert(toml.contains("graphics-path")) {
            "graphics-path wird nicht mehr direkt deklariert — dann zieht Compose " +
                "wieder die transitive 1.0.x-Fassung mit der 4-KB-ausgerichteten " +
                "libandroidx.graphics.path.so herein."
        }
        val m = Regex("""graphicsPath\s*=\s*"(\d+)\.(\d+)\.""").find(toml)
        assert(m != null) { "graphicsPath-Version nicht gefunden" }
        val major = m!!.groupValues[1].toInt()
        val minor = m.groupValues[2].toInt()
        assert(major > 1 || minor >= 1) {
            "graphics-path $major.$minor liegt unter 1.1 — das ist die Fassung, " +
                "mit der die Ausrichtung überhaupt erst eine Chance hat."
        }
    }

    @Test
    fun `native Bibliotheken werden unkomprimiert verpackt`() {
        assert(gradle.contains("useLegacyPackaging = false")) {
            "useLegacyPackaging steht wieder auf true. Legacy Packaging komprimiert " +
                "die .so-Dateien und entpackt sie bei der Installation — an der " +
                "ELF-Ausrichtung im Bibliothekskörper ändert das nichts. Unkomprimiert " +
                "richtet AGP ab 8.5.1 die Dateien im Archiv auf 16 KB aus."
        }
    }
}
