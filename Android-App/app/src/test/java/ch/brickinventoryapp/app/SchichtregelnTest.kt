package ch.brickinventoryapp.app

import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Welche Schicht welche Importe nicht haben darf. ModulgrenzenTest prüft die
 * Build-Dateien; hier steht, was innerhalb der Module gilt.
 * Eine Strukturprüfung: Sie liest Importzeilen, keine Kommentare.
 *
 * Gegenproben (05.11.2026, gemessen mit kotlinc lokal, je ein Patch in gegenproben/):
 *   schicht-viewmodel-android   `import android.net.Uri` in GutscheinViewModel → rot „ein ViewModel …“
 *   schicht-viewmodel-okhttp    `import okhttp3.OkHttpClient` in UpdateViewModel → rot „Präsentation …“
 *   schicht-praesentation-netz  `import retrofit2.Response` in GalleryScreen → rot „Präsentation …“
 *   schicht-bereich-api         `import ch.brickinventoryapp.data.api.SetsApi` in MerklisteViewModel
 *                               → rot „ein Bereich kennt die Retrofit-Schnittstellen nicht“
 *   schicht-zustand-api         `import ch.brickinventoryapp.data.api.KontoApi` in AppTexte → dasselbe rot
 *   schicht-zustand-context     `import android.content.Context` in Sitzung.kt (core-sitzung) → rot
 *                               „core-zustand und core-sitzung kennen keinen Context“
 *   bereich-mehr-wireformat     ein weiterer Import eines Antworttyps in CatalogViewModel → rot
 *                               „ein Bereich kennt … das Wire-Format immer seltener“
 */
class SchichtregelnTest {

    private class Datei(val modul: String, val name: String, val importe: List<String>)

    private val dateien: List<Datei> by lazy {
        Quellen.module.flatMap { m ->
            File(m, "src/main/java").walkTopDown().filter { it.extension == "kt" }.map { f ->
                Datei(m.name, f.name, Regex("""^import\s+([\w.]+)""", RegexOption.MULTILINE)
                    .findAll(f.readText()).map { it.groupValues[1] }.toList())
            }.toList()
        }
    }

    private fun verstoesse(welche: (Datei) -> Boolean, verboten: (String) -> Boolean): List<String> {
        val geprueft = dateien.filter(welche)
        assert(geprueft.isNotEmpty()) { "Keine Dateien geprüft — Muster veraltet?" }
        return geprueft.flatMap { d -> d.importe.filter(verboten).map { "${d.modul}/${d.name}: $it" } }
    }

    private fun praesentation(d: Datei) = d.modul in setOf("core-zustand", "core-sitzung") || d.modul.startsWith("feature-")

    @Test
    fun `ein ViewModel kennt weder Android noch Netz noch Bildschirmcode`() {
        val f = verstoesse({ it.name.endsWith("ViewModel.kt") }) {
            it.startsWith("android.") || it.startsWith("okhttp3.") || it.startsWith("retrofit2.") ||
                Regex("""\.ui\.(screens|components)\.""").containsMatchIn(it)
        }
        assert(f.isEmpty()) { "ViewModels mit verbotenen Importen (M11, H3, N7):\n  " + f.joinToString("\n  ") }
    }

    @Test
    fun `Praesentation holt nichts selbst am Netz`() {
        val f = verstoesse(::praesentation) { it.startsWith("okhttp3.") || it.startsWith("retrofit2.") }
        assert(f.isEmpty()) { "Präsentation mit OkHttp oder Retrofit (H3):\n  " + f.joinToString("\n  ") }
    }

    /**
     * Auch der Zustand nicht: Er sieht Repositories und Ergebnis, nicht den Retrofit-Weg dahinter.
     * Das Wire-Format (core-vertrag) sehen Bereiche nur, wo ein Aufruf es noch verlangt: Die Zahl
     * der Importe darf sinken, nie steigen; die Abbildungen (vertrag.abbildung) zählen nicht.
     */
    @Test
    fun `ein Bereich kennt die Retrofit-Schnittstellen nicht, das Wire-Format immer seltener`() {
        val f = verstoesse(::praesentation) { it.startsWith("ch.brickinventoryapp.data.api.") }
        assert(f.isEmpty()) { "Bereiche oder Zustand mit Importen aus data.api (M2):\n  " + f.joinToString("\n  ") }
        val SCHRANKE = 45
        val n = dateien.filter { it.modul.startsWith("feature-") }.sumOf { d ->
            d.importe.count { it.startsWith("ch.brickinventoryapp.vertrag.") && !it.startsWith("ch.brickinventoryapp.vertrag.abbildung.") }
        }
        assert(n <= SCHRANKE) { "$n Importe aus core-vertrag in den Bereichen, erlaubt $SCHRANKE: Ansicht statt Antworttyp nehmen." }
        assert(n == SCHRANKE) { "Nur noch $n Importe aus core-vertrag: SCHRANKE auf $n senken." }
    }

    /** AppTexte.kt ist die bewusste Ausnahme: Texte und Dateien gehen über Context, bis M7 sie verlegt. */
    @Test
    fun `core-zustand und core-sitzung kennen keinen Context`() {
        val f = verstoesse({ it.modul in setOf("core-zustand", "core-sitzung") && it.name != "AppTexte.kt" }) {
            it == "android.content.Context" || it.endsWith(".ApplicationContext")
        }
        assert(f.isEmpty()) { "core-zustand oder core-sitzung mit Context (M7):\n  " + f.joinToString("\n  ") }
    }
}
