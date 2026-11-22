package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * Which layer must not have which imports. ModuleBoundariesTest checks the
 * build files; here stands what applies within the modules.
 * A structure check: it reads import lines, not comments.
 *
 * Counter-checks (05.11.2026, measured locally with kotlinc, one patch each in counter-checks/):
 *   schicht-viewmodel-android   `import android.net.Uri` in VoucherViewModel → red “a ViewModel …”
 *   schicht-viewmodel-okhttp    `import okhttp3.OkHttpClient` in UpdateViewModel → red “presentation …”
 *   schicht-praesentation-netz  `import retrofit2.Response` in GalleryScreen → red “presentation …”
 *   schicht-bereich-api         `import ch.brickinventoryapp.data.api.SetsApi` in WantedListViewModel
 *                               → red “an area does not know the Retrofit interfaces”
 *   schicht-zustand-api         `import ch.brickinventoryapp.data.api.AccountApi` in AppTexts → the same red
 *   zustand-texte-mit-context   `import android.content.Context` in AppTexts → red “core-state and core-session know no Context“
 *   schicht-zustand-context     `import android.content.Context` in Session.kt (core-session) → red
 *                               “core-state and core-session know no Context“
 *   bereich-mehr-wireformat     an import of a response type in CatalogViewModel → red
 *                               “an area does not know … only core-data knows the wire format”
 *   bereich-kennt-umsetzung     `import …CatalogRepositoryImpl` in CatalogViewModel → red, the same test
 */
class LayerRulesTest {

    private class FileEntry(val module: String, val name: String, val imports: List<String>)

    private val files: List<FileEntry> by lazy {
        Sources.module.flatMap { m ->
            File(m, "src/main/java").walkTopDown().filter { it.extension == "kt" }.map { f ->
                FileEntry(m.name, f.name, Regex("""^import\s+([\w.]+)""", RegexOption.MULTILINE)
                    .findAll(f.readText()).map { it.groupValues[1] }.toList())
            }.toList()
        }
    }

    private fun violations(which: (FileEntry) -> Boolean, forbidden: (String) -> Boolean): List<String> {
        val checked = files.filter(which)
        assert(checked.isNotEmpty()) { "Keine Dateien geprüft — Muster veraltet?" }
        return checked.flatMap { d -> d.imports.filter(forbidden).map { "${d.module}/${d.name}: $it" } }
    }

    private val WIRE_MARKER = setOf("core-contract", "core-data", "core-testing")

    private fun presentation(d: FileEntry) = d.module in setOf("core-state", "core-session") || d.module.startsWith("feature-")

    @Test
    fun `a ViewModel knows neither Android nor network nor screen code`() {
        val f = violations({ it.name.endsWith("ViewModel.kt") }) {
            it.startsWith("android.") || it.startsWith("okhttp3.") || it.startsWith("retrofit2.") ||
                Regex("""\.ui\.(screens|components)\.""").containsMatchIn(it)
        }
        assert(f.isEmpty()) { "ViewModels mit verbotenen Importen (M11, H3, N7):\n  " + f.joinToString("\n  ") }
    }

    @Test
    fun `presentation fetches nothing from the network itself`() {
        val f = violations(::presentation) { it.startsWith("okhttp3.") || it.startsWith("retrofit2.") }
        assert(f.isEmpty()) { "Präsentation mit OkHttp oder Retrofit:\n  " + f.joinToString("\n  ") }
    }

    /**
     * Not the state either: it sees repositories and Ergebnis, not the Retrofit path behind them.
     * Only core-data translates the wire format (mappings in core-contract); every other
     * module, the store too, takes domain types. ModuleEdges checks the edge for it. The implementations
     * of the repositories are public because core-testing builds them; nobody else may use them.
     */
    @Test
    fun `an area does not know the Retrofit interfaces, only core-data knows the wire format`() {
        val f = violations(::presentation) { it.startsWith("ch.brickinventoryapp.data.api.") }
        assert(f.isEmpty()) { "Bereiche oder Zustand mit Importen aus data.api:\n  " + f.joinToString("\n  ") }
        val wire = violations({ it.module !in WIRE_MARKER }) { it.startsWith("ch.brickinventoryapp.contract.") }
        assert(wire.isEmpty()) { "Importe aus core-contract ausserhalb von core-data:\n  " + wire.joinToString("\n  ") }
        val implementation = violations({ it.module !in setOf("core-data", "core-testing") }) {
            Regex("""^ch\.brickinventoryapp\.data\.repository\.\w+Impl$""").matches(it)
        }
        assert(implementation.isEmpty()) { "Repository-Umsetzungen ausserhalb von core-data und core-testing:\n  " + implementation.joinToString("\n  ") }
    }

    /** Texts and files come via Textquelle and FileReader from core-data, without exception. */
    @Test
    fun `core-state and core-session know no Context`() {
        val f = violations({ it.module in setOf("core-state", "core-session") }) {
            it == "android.content.Context" || it.endsWith(".ApplicationContext")
        }
        assert(f.isEmpty()) { "core-state oder core-session mit Context:\n  " + f.joinToString("\n  ") }
    }
}
