package ch.brickinventoryapp

import org.junit.Test

/**
 * Jeder Erfassungsweg fragt nach dem Lagerort — und der Merkposten nach dem Konto.
 *
 * ── Marcos Befund vom 24.09. ────────────────────────────────────────────────
 *
 *   „Wenn ich etwas aus dem Katalog auf die Merkliste setze kann ich den
 *    Account nicht waehlen. Wenn ich aus dem Katalog etwas in die Galerie
 *    aufnehme, kann ich den Lagerort nicht setzen. Wenn ich etwas aus der
 *    Merkliste in die Galerie aufnehme, kann ich den Lagerort nicht setzen.
 *    Wenn ich ein Set in der Galerie hinzufuegen will, kann ich den Lagerort
 *    nicht waehlen. Egal ob ich des manuell oder per Barcode hinzufuege. Bei
 *    den manuell erfassten Teilen kann ich beim Erfassen keinen Lagerort
 *    setzten. Bei manuelle erfassten Minifiguren kann ich beim Erfassen keinen
 *    Lagerort setzen."
 *
 * ── Das Muster dahinter ─────────────────────────────────────────────────────
 *
 * Es ist dasselbe, das diesen Baum schon mehrfach erwischt hat: Ein Feld wird
 * an EINEM Erfassungsweg eingebaut, und die anderen vier bleiben zurueck. Beim
 * Eigentuemer war es der Barcode-Weg (Nachtrag 44) und der Katalog-Dialog
 * (Nachtrag 66), jetzt beim Lagerort gleich fuenf Wege auf einmal — er liess
 * sich ueberhaupt nur NACH dem Erfassen setzen, im Detaildialog.
 *
 * Diese Regel zaehlt die Wege ab. Sie kann nicht pruefen, ob das Feld auch
 * gesendet wird — das tun die Datenbankpruefungen der Webapp
 * (test/lagerort-beim-erfassen-db.test.js), und beide Oberflaechen rufen
 * dieselben Routen.
 *
 * ── Gegenprobe (durchgefuehrt, Ergebnis im Commit) ──────────────────────────
 * Je einen Aufruf entfernt → die Regel meldet genau diesen Weg.
 */
class LagerortBeimErfassenTest {

    /** Der Rumpf einer Funktion: ab ihrem Namen bis zur naechsten auf Spaltenanfang. */
    private fun rumpf(quelle: String, kopf: String): String {
        val i = quelle.indexOf(kopf)
        check(i >= 0) { "$kopf nicht gefunden — umbenannt?" }
        val rest = quelle.substring(i + kopf.length)
        val j = Regex("\\n(?:@Composable|private fun |internal fun |fun )").find(rest)?.range?.first
        return rest.substring(0, j ?: rest.length)
    }

    @Test
    fun `jeder Erfassungsweg hat ein Lagerortfeld`() {
        // Fuenf Wege, fuenf Dateien. Weniger als fuenf heisst: Die Suche greift
        // nicht mehr, und die Regel waere still zufrieden.
        val wege = listOf(
            Triple("ui/screens/GalleryScreen.kt", "fun AddSetDialog(", "Set hinzufuegen (Galerie)"),
            Triple("ui/screens/CatalogDetailScreen.kt", "fun CatalogAddDialog(", "Katalog → Galerie"),
            Triple("ui/screens/MerklisteScreen.kt", "fun UebernahmeDialog(", "Merkliste → Galerie"),
            Triple("ui/screens/ManualItemComposables.kt", "fun ErfassungsFelder(", "manuelle Teile und Figuren"),
            Triple("ui/dialogs/BarcodeResultDialog.kt", "fun BarcodeResultDialog(", "Barcode"),
        )
        check(wege.size >= 5) { "Nur ${wege.size} Wege — Liste unvollstaendig?" }
        val ohne = mutableListOf<String>()
        for ((datei, kopf, name) in wege) {
            // Ohne Kommentarzeilen: Ein Absatz, der das Feld ERKLAERT, nennt es
            // zwangslaeufig — und die Regel waere damit blind fuer sein Fehlen.
            val quelle = Quellen.ohneKommentare(Quellen.lies(datei))
            if (!rumpf(quelle, kopf).contains("LagerortErfassung(")) ohne += name
        }
        assert(ohne.isEmpty()) {
            "Diese Erfassungswege fragen nicht nach dem Lagerort: " +
                "${ohne.joinToString(", ")} — er laesst sich dort erst nachtraeglich setzen."
        }
    }

    @Test
    fun `der Merkposten-Dialog fragt nach dem Konto`() {
        // Der Server nahm owner_user_id seit jeher an (routes/api_v1/wanted.ts),
        // und die Webapp fragte es ab (cat-m-owner) — nur dieser Dialog nicht.
        val quelle = Quellen.ohneKommentare(Quellen.lies("ui/screens/CatalogDetailScreen.kt"))
        val koerper = rumpf(quelle, "fun MerkpostenDialog(")
        assert(koerper.contains("OwnerPicker(")) {
            "Der Merkposten-Dialog im Katalog hat keine Kontowahl — ein Wunsch " +
                "fuer das Kind landete damit still beim eigenen Konto."
        }
    }
}
