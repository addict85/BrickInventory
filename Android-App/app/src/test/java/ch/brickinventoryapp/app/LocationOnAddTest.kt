package ch.brickinventoryapp.app

import org.junit.Test
import ch.brickinventoryapp.testing.Sources

/**
 * Every adding path asks for the storage location — and the wishlist item for the account.
 *
 * ── The pattern behind it ───────────────────────────────────────────────────
 *
 * A field built into ONE adding path is easily missing from the other
 * four; that is why the rule counts off all paths.
 *
 * This rule counts off the paths. It cannot check whether the field is also
 * sent — that is done by the web app's database checks
 * (test/location-on-add-db.test.js), and both UIs call
 * the same routes.
 *
 * ── Counter-check (performed, result in the commit) ──────────────────────────
 * One call removed at a time → the rule reports exactly this path.
 */
class LocationOnAddTest {

    /** The body of a function: from its name to the next one at the start of a column. */
    private fun body(source: String, header: String): String {
        val i = source.indexOf(header)
        check(i >= 0) { "$header nicht gefunden — umbenannt?" }
        val rest = source.substring(i + header.length)
        val j = Regex("\\n(?:@Composable|private fun |internal fun |fun )").find(rest)?.range?.first
        return rest.substring(0, j ?: rest.length)
    }

    @Test
    fun `every adding path has a storage location field`() {
        // Five paths, five files. Fewer than five means: the search no longer
        // applies, and the rule would be silently satisfied.
        val routes = listOf(
            Triple("collection/ui/screens/GalleryRecord.kt", "fun AddSetDialog(", "Set hinzufuegen (Galerie)"),
            Triple("catalog/ui/screens/CatalogDetailScreen.kt", "fun CatalogAddDialog(", "Katalog → Galerie"),
            Triple("collection/ui/screens/WantedListDialogs.kt", "fun AdoptionDialog(", "Merkliste → Galerie"),
            Triple("shared/ui/ManualItemComposables.kt", "fun EntryFields(", "manuelle Teile und Figuren"),
            Triple("collection/ui/dialogs/BarcodeResultDialog.kt", "fun BarcodeResultDialog(", "Barcode"),
        )
        check(routes.size >= 5) { "Nur ${routes.size} Wege — Liste unvollstaendig?" }
        val without = mutableListOf<String>()
        for ((file, header, name) in routes) {
            // Without comment lines: a paragraph that EXPLAINS the field necessarily
            // names it — and the rule would thus be blind to its absence.
            val source = Sources.withoutComments(Sources.read(file))
            if (!body(source, header).contains("StorageLocationEntry(")) without += name
        }
        assert(without.isEmpty()) {
            "Diese Erfassungswege fragen nicht nach dem Lagerort: " +
                "${without.joinToString(", ")} — er laesst sich dort erst nachtraeglich setzen."
        }
    }

    /**
     * Every adding path STARTS at the default (the star in the storage location supply).
     *
     * “I would also like to be able to set a storage location as default in the
     *  settings. It should then already be preselected when adding something
     *  new."
     *
     * ── Why the same list a second time ─────────────────────────────────────
     *
     * The check above counts off which path HAS a storage location field. This
     * one counts off which PRESETS it — two different statements about
     * the same paths; a field built into one path is easily missing from
     * the others.
     *
     * The STATE is checked and not the field: the preset stands in
     * the line that creates it. Six holders and not five paths, because
     * manual adding has two — part and minifigure share the field
     * (EntryFields) but each hold the state themselves.
     */
    @Test
    fun `every adding path starts at the default storage location`() {
        val holder = listOf(
            Triple("collection/ui/screens/GalleryRecord.kt", "fun AddSetDialog(", "Set hinzufuegen (Galerie)"),
            Triple("catalog/ui/screens/CatalogDetailScreen.kt", "fun CatalogAddDialog(", "Katalog → Galerie"),
            Triple("collection/ui/screens/WantedListDialogs.kt", "fun AdoptionDialog(", "Merkliste → Galerie"),
            Triple("parts/ui/screens/PartsDialogs.kt", "fun AddPartDialog(", "manuelles Teil"),
            Triple("parts/ui/screens/FiguresRecord.kt", "fun AddMinifigDialog(", "manuelle Minifigur"),
            Triple("collection/ui/dialogs/BarcodeResultDialog.kt", "fun BarcodeResultDialog(", "Barcode"),
        )
        check(holder.size >= 6) { "Nur ${holder.size} Halter — Liste unvollstaendig?" }
        val empty = mutableListOf<String>()
        for ((file, header, name) in holder) {
            val source = Sources.withoutComments(Sources.read(file))
            val bodyBytes = body(source, header)
            // The line that creates the storage location state. `storageLocation` also hits
            // `barcodeLocation` — intentionally, it is the same thing.
            val row = bodyBytes.lines().firstOrNull {
                Regex("""var \w*(?:[Ll]agerort|[Ll]ocation)\b.*mutableStateOf\(""").containsMatchIn(it)
            }
            if (row == null) { empty += "$name (kein Zustand gefunden)"; continue }
            // `mutableStateOf("")` is the old state: start at empty. A
            // default is recognized by a NAME standing there.
            if (Regex("""mutableStateOf\(\s*""\s*\)""").containsMatchIn(row)) empty += name
            else if (!row.contains("orgabe") && !row.contains("efault")) empty += "$name (kein Vorgabe-Wert)"
        }
        assert(empty.isEmpty()) {
            "Diese Erfassungswege starten nicht bei der Vorgabe: " +
                "${empty.joinToString(", ")} — Marcos Stern wirkt dort nicht, und " +
                "man muesste den Ort jedes Mal von Hand waehlen."
        }
    }

    @Test
    fun `the wishlist item dialog asks for the account`() {
        // The server always accepted owner_user_id (routes/api_v1/wanted.ts),
        // and the web app asked for it (cat-m-owner) — only this dialog did not.
        val source = Sources.withoutComments(Sources.read("catalog/ui/screens/CatalogDetailScreen.kt"))
        val bodyBytes = body(source, "fun WantedItemDialog(")
        assert(bodyBytes.contains("OwnerPicker(")) {
            "Der Merkposten-Dialog im Katalog hat keine Kontowahl — ein Wunsch " +
                "fuer das Kind landete damit still beim eigenen Konto."
        }
    }
}
