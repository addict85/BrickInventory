package ch.brickinventoryapp

import org.junit.Test
import java.io.File

/**
 * Welche Schicht welche Importe nicht haben darf. ModulgrenzenTest prüft die
 * Build-Dateien; hier steht, was innerhalb der Module gilt (arch17 H3, M2, M7, M11).
 * Eine Strukturprüfung: Sie liest Importzeilen, keine Kommentare.
 *
 * Gegenproben (05.11.2026, gemessen mit kotlinc lokal, je ein Patch in gegenproben/):
 *   schicht-viewmodel-android   `import android.net.Uri` in GutscheinViewModel → rot „ein ViewModel …“
 *   schicht-viewmodel-okhttp    `import okhttp3.OkHttpClient` in UpdateViewModel → rot „ein ViewModel …“
 *   schicht-praesentation-netz  `import retrofit2.Response` in GalleryScreen → rot „Präsentation …“
 *   schicht-bereich-api         `import ch.brickinventoryapp.data.api.SetsApi` in MerklisteViewModel
 *                               → rot „ein Bereich kennt die Retrofit-Schnittstellen nicht“
 *   schicht-zustand-context     `import android.content.Context` in Sitzung.kt → rot „core-zustand …“
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

    private fun praesentation(d: Datei) = d.modul == "core-zustand" || d.modul.startsWith("feature-")

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

    @Test
    fun `ein Bereich kennt die Retrofit-Schnittstellen nicht`() {
        val f = verstoesse({ it.modul.startsWith("feature-") }) { it.startsWith("ch.brickinventoryapp.data.api.") }
        assert(f.isEmpty()) { "Bereiche mit Importen aus data.api (M2):\n  " + f.joinToString("\n  ") }
    }

    /** AppTexte.kt ist die bewusste Ausnahme: Texte und Dateien gehen über Context, bis M7 sie verlegt. */
    @Test
    fun `core-zustand kennt keinen Context`() {
        val f = verstoesse({ it.modul == "core-zustand" && it.name != "AppTexte.kt" }) {
            it == "android.content.Context" || it.endsWith(".ApplicationContext")
        }
        assert(f.isEmpty()) { "core-zustand mit Context (M7):\n  " + f.joinToString("\n  ") }
    }
}
