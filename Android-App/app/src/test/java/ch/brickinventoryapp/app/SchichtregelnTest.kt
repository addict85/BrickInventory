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
 *   schicht-zustand-api         `import ch.brickinventoryapp.data.api.AccountApi` in AppTexte → dasselbe rot
 *   zustand-texte-mit-context   `import android.content.Context` in AppTexte → rot „core-state und core-session kennen keinen Context“
 *   schicht-zustand-context     `import android.content.Context` in Sitzung.kt (core-session) → rot
 *                               „core-state und core-session kennen keinen Context“
 *   bereich-mehr-wireformat     ein Import eines Antworttyps in CatalogViewModel → rot
 *                               „ein Bereich kennt … das Wire-Format nur core-data“
 *   bereich-kennt-umsetzung     `import …KatalogRepositoryImpl` in CatalogViewModel → rot, derselbe Test
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

    private fun violations(welche: (Datei) -> Boolean, verboten: (String) -> Boolean): List<String> {
        val geprueft = dateien.filter(welche)
        assert(geprueft.isNotEmpty()) { "Keine Dateien geprüft — Muster veraltet?" }
        return geprueft.flatMap { d -> d.importe.filter(verboten).map { "${d.modul}/${d.name}: $it" } }
    }

    private val WIRE_KENNER = setOf("core-contract", "core-data", "core-testing")

    private fun presentation(d: Datei) = d.modul in setOf("core-state", "core-session") || d.modul.startsWith("feature-")

    @Test
    fun `ein ViewModel kennt weder Android noch Netz noch Bildschirmcode`() {
        val f = violations({ it.name.endsWith("ViewModel.kt") }) {
            it.startsWith("android.") || it.startsWith("okhttp3.") || it.startsWith("retrofit2.") ||
                Regex("""\.ui\.(screens|components)\.""").containsMatchIn(it)
        }
        assert(f.isEmpty()) { "ViewModels mit verbotenen Importen (M11, H3, N7):\n  " + f.joinToString("\n  ") }
    }

    @Test
    fun `Praesentation holt nichts selbst am Netz`() {
        val f = violations(::presentation) { it.startsWith("okhttp3.") || it.startsWith("retrofit2.") }
        assert(f.isEmpty()) { "Präsentation mit OkHttp oder Retrofit:\n  " + f.joinToString("\n  ") }
    }

    /**
     * Auch der Zustand nicht: Er sieht Repositories und Ergebnis, nicht den Retrofit-Weg dahinter.
     * Das Wire-Format übersetzt nur core-data (Abbildungen in core-contract); jedes andere
     * Modul, auch die Ablage, nimmt Fachtypen. Die Kante dazu prüft Modulkanten. Die Umsetzungen
     * der Repositories sind öffentlich, weil core-testing sie baut; benutzen darf sie sonst niemand.
     */
    @Test
    fun `ein Bereich kennt die Retrofit-Schnittstellen nicht, das Wire-Format nur core-data`() {
        val f = violations(::presentation) { it.startsWith("ch.brickinventoryapp.data.api.") }
        assert(f.isEmpty()) { "Bereiche oder Zustand mit Importen aus data.api:\n  " + f.joinToString("\n  ") }
        val wire = violations({ it.modul !in WIRE_KENNER }) { it.startsWith("ch.brickinventoryapp.contract.") }
        assert(wire.isEmpty()) { "Importe aus core-contract ausserhalb von core-data:\n  " + wire.joinToString("\n  ") }
        val implementation = violations({ it.modul !in setOf("core-data", "core-testing") }) {
            Regex("""^ch\.brickinventoryapp\.data\.repository\.\w+Impl$""").matches(it)
        }
        assert(implementation.isEmpty()) { "Repository-Umsetzungen ausserhalb von core-data und core-testing:\n  " + implementation.joinToString("\n  ") }
    }

    /** Texte und Dateien kommen über Textquelle und FileReader aus core-data, ohne Ausnahme. */
    @Test
    fun `core-state und core-session kennen keinen Context`() {
        val f = violations({ it.modul in setOf("core-state", "core-session") }) {
            it == "android.content.Context" || it.endsWith(".ApplicationContext")
        }
        assert(f.isEmpty()) { "core-state oder core-session mit Context:\n  " + f.joinToString("\n  ") }
    }
}
