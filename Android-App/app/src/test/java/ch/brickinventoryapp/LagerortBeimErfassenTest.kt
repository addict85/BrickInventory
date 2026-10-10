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

    /**
     * Jeder Erfassungsweg STARTET bei der Vorgabe — Marcos Stern.
     *
     * „Weiter moechte ich ein Lagerort in den Einstellungen als Default setzen
     *  koennen. Der soll dann bei einer Neuerfassung bereits vorausgewaehlt
     *  sein."
     *
     * ── Warum dieselbe Liste ein zweites Mal ────────────────────────────────
     *
     * Die Pruefung darueber zaehlt ab, welcher Weg ein Lagerortfeld HAT. Diese
     * hier zaehlt ab, welcher es VORBELEGT — zwei verschiedene Aussagen ueber
     * dieselben Wege. Und es ist genau das Muster, an dem dieser Baum schon
     * mehrfach haengengeblieben ist: Ein Feld wird an einem Weg eingebaut, die
     * anderen bleiben zurueck (Eigentuemer: Nachtrag 44 und 66, Lagerort: fuenf
     * Wege auf einmal).
     *
     * Geprueft wird der ZUSTAND und nicht das Feld: Die Vorbelegung steht in
     * der Zeile, die ihn anlegt. Sechs Halter und nicht fuenf Wege, weil die
     * manuelle Erfassung zwei hat — Teil und Minifigur teilen das Feld
     * (ErfassungsFelder), halten den Zustand aber je selbst.
     */
    @Test
    fun `jeder Erfassungsweg startet beim vorgegebenen Lagerort`() {
        val halter = listOf(
            Triple("ui/screens/GalleryScreen.kt", "fun AddSetDialog(", "Set hinzufuegen (Galerie)"),
            Triple("ui/screens/CatalogDetailScreen.kt", "fun CatalogAddDialog(", "Katalog → Galerie"),
            Triple("ui/screens/MerklisteScreen.kt", "fun UebernahmeDialog(", "Merkliste → Galerie"),
            Triple("ui/screens/PartsDialogs.kt", "fun AddPartDialog(", "manuelles Teil"),
            Triple("ui/screens/MinifigsScreen.kt", "fun AddMinifigDialog(", "manuelle Minifigur"),
            Triple("ui/dialogs/BarcodeResultDialog.kt", "fun BarcodeResultDialog(", "Barcode"),
        )
        check(halter.size >= 6) { "Nur ${halter.size} Halter — Liste unvollstaendig?" }
        val leer = mutableListOf<String>()
        for ((datei, kopf, name) in halter) {
            val quelle = Quellen.ohneKommentare(Quellen.lies(datei))
            val koerper = rumpf(quelle, kopf)
            // Die Zeile, die den Lagerort-Zustand anlegt. `lagerort` trifft auch
            // `barcodeLagerort` — gewollt, es ist dieselbe Sache.
            val zeile = koerper.lines().firstOrNull {
                Regex("""var \w*[Ll]agerort\b.*mutableStateOf\(""").containsMatchIn(it)
            }
            if (zeile == null) { leer += "$name (kein Zustand gefunden)"; continue }
            // `mutableStateOf("")` ist der alte Stand: Start bei leer. Eine
            // Vorgabe erkennt man daran, dass dort ein NAME steht.
            if (Regex("""mutableStateOf\(\s*""\s*\)""").containsMatchIn(zeile)) leer += name
            else if (!zeile.contains("orgabe")) leer += "$name (kein Vorgabe-Wert)"
        }
        assert(leer.isEmpty()) {
            "Diese Erfassungswege starten nicht bei der Vorgabe: " +
                "${leer.joinToString(", ")} — Marcos Stern wirkt dort nicht, und " +
                "man muesste den Ort jedes Mal von Hand waehlen."
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
