package ch.brickinventoryapp.app

import ch.brickinventoryapp.contract.CatalogSetDetail
import ch.brickinventoryapp.contract.CatalogSetItem
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.contract.testing.decodeCompleted
import ch.brickinventoryapp.testing.Sources
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * Catalog models carry the server's `image_local`, and every function that resolves an
 * image address declares `serverUrl` itself. That the catalog screens use the local file
 * is rendered in CatalogLocalImagesTest (feature-catalog).
 *
 * Counter-check: in CatalogSetItem.asView `imageLocal =
 * null` → red “catalog models know image_local”.
 * Counter-check (local, reads only source; not compilable as a patch): in PartsCard.kt
 * `serverUrl: String` taken out of the signature of PartTableRow or ManualPartTile →
 * red „Funktion 'PartTableRow' …“ or „Funktion 'ManualPartTile' …“.
 */
class CatalogUsesLocalImagesTest {

    private fun read(rel: String): String {
        val f = File(Sources.root, "$rel")
        assert(f.exists()) { "File not found: $rel" }
        return f.readText()
    }

    @Test
    fun `catalog models know image_local`() {
        // What the server sends is read, and it arrives in the view.
        val item = decodeCompleted(CatalogSetItem.serializer(),
            """{"set_number": "75192-1", "image_local": "/images/sets/75192-1.jpg"}""").asView()
        assertEquals("/images/sets/75192-1.jpg", item.imageLocal)
        val detail = decodeCompleted(CatalogSetDetail.serializer(),
            """{"set_number": "75192-1", "image_local": "/images/sets/75192-1_thumb.jpg"}""").asView()
        assertEquals("/images/sets/75192-1_thumb.jpg", detail.imageLocal)
    }

    @Test
    fun `every function with a resolveThumbUrl-fullUrl call declares serverUrl itself`() {
        // Generic safeguard against exactly this error class: twice in
        // a row resolveThumbUrl()/resolveFullUrl() was built into a function
        // without checking whether IT ITSELF (not just a
        // surrounding file) has serverUrl as a parameter — compile error
        // "Unresolved reference 'serverUrl'", once at CatalogDetailScreen,
        // once at CatalogSetCard.
        //
        // Check: for every top-level function definition whose body contains a
        // resolve*Url(serverUrl, …) call, "serverUrl: String" must
        // stand in the SAME signature.
        val screensToCheck = listOf(
            "collection/ui/screens/GalleryCard.kt",
            "collection/ui/screens/SetDetailScreen.kt",
            "parts/ui/screens/PartsScreen.kt",
            "finances/ui/screens/FinanceScreen.kt",
            "parts/ui/screens/MinifigsScreen.kt",
            "catalog/ui/screens/CatalogScreen.kt",
            "catalog/ui/screens/CatalogDetailScreen.kt",
        ).flatMap { Sources.screenFiles(it) }
        for (rel in screensToCheck) {
            val raw = read(rel)
            // Only functions at the top level (column 0), also internal or private:
            // without visibility a call of the function before would count.
            val funcStarts = Regex("""^(?:(?:public|internal|private)\s+)?fun (\w+)\(""", RegexOption.MULTILINE)
                .findAll(raw).map { it.range.first to it.groupValues[1] }.toList()
            val useIdxs = Regex("""(resolve(Thumb|Full)Url|rememberTileImageWithFallback)\(\s*serverUrl""")
                .findAll(raw).map { it.range.first }.toList()
            for (u in useIdxs) {
                var owner: Pair<Int, String>? = null
                for ((start, name) in funcStarts) {
                    if (start > u) break
                    owner = start to name
                }
                assert(owner != null) { "$rel: no enclosing top-level function found" }
                val (start, name) = owner!!
                val sigWindow = raw.substring(start, minOf(start + 600, raw.length)).replace("\n", " ")
                assert(sigWindow.contains("serverUrl: String")) {
                    "$rel: function '$name' uses resolveThumbUrl()/resolveFullUrl() with serverUrl, " +
                    "but does not declare it as a parameter itself"
                }
            }
        }
    }
}
