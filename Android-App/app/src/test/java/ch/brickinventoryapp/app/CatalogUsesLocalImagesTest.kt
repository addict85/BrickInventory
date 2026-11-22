package ch.brickinventoryapp.app

import ch.brickinventoryapp.contract.CatalogSetDetail
import ch.brickinventoryapp.contract.CatalogSetItem
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.testing.Sources
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * Catalog images use the user-independent local file determined by the server
 * instead of hard-setting it to null.
 *
 * Previously CatalogScreen.kt/CatalogDetailScreen.kt always passed `null` as
 * imageLocal to resolveThumbUrl()/resolveFullUrl() — with the reasoning that the
 * catalog knows no local images. That was only half right: a
 * DIFFERENT user (or the same one with an earlier set) may already have downloaded
 * the same image file, because it is named after the set number
 * and is user-independent. The server checks that now and delivers
 * `image_local` if the file exists.
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
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    private fun code(src: String) = src.lines().joinToString("\n") { line ->
        if (line.trim().startsWith("//")) "" else line
    }

    @Test
    fun `catalog models know image_local`() {
        // What the server sends is read, and it arrives in the view.
        val item = BrickJson.decodeFromString(CatalogSetItem.serializer(),
            """{"set_number": "75192-1", "image_local": "/images/sets/75192-1.jpg"}""").asView()
        assertEquals("/images/sets/75192-1.jpg", item.imageLocal)
        val detail = BrickJson.decodeFromString(CatalogSetDetail.serializer(),
            """{"set_number": "75192-1", "image_local": "/images/sets/75192-1_thumb.jpg"}""").asView()
        assertEquals("/images/sets/75192-1_thumb.jpg", detail.imageLocal)
    }

    @Test
    fun `catalog screens pass the field through instead of forcing null`() {
        val list = code(Sources.screen("catalog/ui/screens/CatalogScreen.kt"))
        // rememberTileImageWithFallback(...) counts as well:
        assert(list.contains("resolveThumbUrl(serverUrl, set.imageLocal, set.imageUrl)") ||
               list.contains("rememberTileImageWithFallback(serverUrl, set.imageLocal, set.imageUrl)")) {
            "Die Katalog-Liste muss set.imageLocal durchreichen, nicht null"
        }
        assert(!list.contains("resolveThumbUrl(serverUrl, null, set.imageUrl)")) {
            "Ein hart verdrahtetes null verhindert die Nutzung bereits vorhandener Dateien"
        }

        val detail = code(read("catalog/ui/screens/CatalogDetailScreen.kt"))
        assert(detail.contains("resolveFullUrl(serverUrl, detail.imageLocal, detail.imageUrl)")) {
            "Der Katalog-Detail-Dialog muss detail.imageLocal an resolveFullUrl() übergeben"
        }
        assert(!detail.contains("resolveFullUrl(serverUrl, null, detail.imageUrl)")) {
            "Ein hart verdrahtetes null verhindert die Nutzung bereits vorhandener Dateien"
        }
    }

    @Test
    fun `CatalogDetailScreen declares and receives serverUrl`() {
        // Regression: resolveFullUrl() was built in without the
        // function knowing serverUrl as a parameter at all — compile error
        // "Unresolved reference 'serverUrl'". Now in the signature AND
        // supplied with state.serverUrl at the only call site.
        val screenSrc = read("catalog/ui/screens/CatalogDetailScreen.kt").replace("\n", " ")
        assert(Regex("""fun CatalogDetailScreen\([^)]*serverUrl: String""").containsMatchIn(screenSrc)) {
            "serverUrl fehlt in der Funktionssignatur"
        }
        val graphSrc = code(read("catalog/ui/CatalogGraph.kt"))
        assert(graphSrc.contains("serverUrl = state.serverUrl")) {
            "Der Aufrufer in CatalogGraph.kt muss serverUrl übergeben"
        }
    }

    @Test
    fun `CatalogSetCard is called with serverUrl`() {
        // The generic check above covers the SIGNATURE; here additionally
        // the concrete call that was actually missing in the reported error.
        //
        // ── Checked for the RULE, not for the wording ────
        //
        // Previously a contains() on the whole call stood here, closing
        // bracket included. This assertion fell when the design
        // `noppe` needed a fifth argument (the position of the tile for
        // the stud color) — although serverUrl stood unchanged in third place
        // and the matter this is about was not touched at all.
        //
        // The statement is „serverUrl stands in third place“, not „the call has exactly four arguments“
        // . The character after it may therefore
        // be a comma.
        val src = read("catalog/ui/screens/CatalogScreen.kt")
        assert(Regex("""CatalogSetCard\(set, imageLoader, serverUrl, onSetClick[,)]""")
                .containsMatchIn(src)) {
            "Der Aufruf muss serverUrl an dritter Stelle übergeben"
        }
        assert(!src.contains("CatalogSetCard(set, imageLoader, onSetClick)")) {
            "Der alte Aufruf ohne serverUrl darf nicht mehr vorkommen"
        }
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
                assert(owner != null) { "$rel: keine umschliessende Top-Level-Funktion gefunden" }
                val (start, name) = owner!!
                val sigWindow = raw.substring(start, minOf(start + 600, raw.length)).replace("\n", " ")
                assert(sigWindow.contains("serverUrl: String")) {
                    "$rel: Funktion '$name' benutzt resolveThumbUrl()/resolveFullUrl() mit serverUrl, " +
                    "deklariert es aber nicht selbst als Parameter"
                }
            }
        }
    }

    @Test
    fun `parts, minifigures and catalog use the same fallback as the gallery`() {
        // Switched at the user's request to the same pattern as GalleryScreen.kt:
        // resolveThumbUrl() alone is not enough when the preview is (still)
        // missing — rememberTileImageWithFallback() switches to the full
        // resolution on a loading error.
        val expectations = mapOf(
            "parts/ui/screens/PartsScreen.kt" to 2,      // ManualPartTile, PartCard
            "parts/ui/screens/MinifigsScreen.kt" to 2,   // ManualFigTile, MinifigCard
            "catalog/ui/screens/CatalogScreen.kt" to 1,     // CatalogSetCard
        )
        for ((rel, expectedCount) in expectations) {
            val src = Sources.screen(rel)
            val count = Regex("""rememberTileImageWithFallback\(serverUrl""").findAll(src).count()
            assert(count == expectedCount) {
                "$rel: $count statt $expectedCount Verwendungen von rememberTileImageWithFallback()"
            }
            assert(!Regex("""[^.]resolveThumbUrl\(serverUrl""").containsMatchIn(src)) {
                "$rel: benutzt noch direkt resolveThumbUrl() statt des Rückfall-Helfers"
            }
        }
    }
}
