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
 *   layer-viewmodel-android   `import android.net.Uri` in VoucherViewModel → red “a ViewModel …”
 *   layer-viewmodel-okhttp    `import okhttp3.OkHttpClient` in UpdateViewModel → red “presentation …”
 *   layer-presentation-network  `import retrofit2.Response` in GalleryScreen → red “presentation …”
 *   layer-scope-api         `import ch.brickinventoryapp.data.api.SetsApi` in WantedListViewModel
 *                               → red “an area does not know the Retrofit interfaces”
 *   layer-state-api         `import ch.brickinventoryapp.data.api.AccountApi` in AppTexts → the same red
 *   state-texts-with-context   `import android.content.Context` in AppTexts → red “core-state and core-session know no Context“
 *   layer-state-context     `import android.content.Context` in Session.kt (core-session) → red
 *                               “core-state and core-session know no Context“
 *   scope-more-wire-format     an import of a response type in CatalogViewModel → red
 *                               “an area does not know … only core-data knows the wire format”
 *   scope-knows-implementation     `import …CatalogRepositoryImpl` in CatalogViewModel → red, the same test
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
        assert(checked.isNotEmpty()) { "No files checked — pattern outdated?" }
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
        assert(f.isEmpty()) { "ViewModels with forbidden imports (M11, H3, N7):\n  " + f.joinToString("\n  ") }
    }

    @Test
    fun `presentation fetches nothing from the network itself`() {
        val f = violations(::presentation) { it.startsWith("okhttp3.") || it.startsWith("retrofit2.") }
        assert(f.isEmpty()) { "presentation with OkHttp or Retrofit:\n  " + f.joinToString("\n  ") }
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
        assert(f.isEmpty()) { "areas or state with imports from data.api:\n  " + f.joinToString("\n  ") }
        val wire = violations({ it.module !in WIRE_MARKER }) { it.startsWith("ch.brickinventoryapp.contract.") }
        assert(wire.isEmpty()) { "imports from core-contract outside core-data:\n  " + wire.joinToString("\n  ") }
        val implementation = violations({ it.module !in setOf("core-data", "core-testing") }) {
            Regex("""^ch\.brickinventoryapp\.data\.repository\.\w+Impl$""").matches(it)
        }
        assert(implementation.isEmpty()) { "repository implementations outside core-data and core-testing:\n  " + implementation.joinToString("\n  ") }
    }

    /** Texts and files come via Textquelle and FileReader from core-data, without exception. */
    @Test
    fun `core-state and core-session know no Context`() {
        val f = violations({ it.module in setOf("core-state", "core-session") }) {
            it == "android.content.Context" || it.endsWith(".ApplicationContext")
        }
        assert(f.isEmpty()) { "core-state or core-session with Context:\n  " + f.joinToString("\n  ") }
    }
}
