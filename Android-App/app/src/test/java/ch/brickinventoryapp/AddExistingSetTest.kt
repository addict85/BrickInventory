package ch.brickinventoryapp

import org.junit.Test

/**
 * Ein bereits erfasstes Set wird geöffnet, nicht stillschweigend erhöht.
 *
 * ── Marcos Festlegung ───────────────────────────────────────────────────────
 * „Besitzt der Account oder einer der Unteraccounts das Set bereits, soll sich
 * nur der Detail-Dialog des Sets öffnen. Egal ob die Erfassung via
 * Barcodescanner, OCR oder per Nummer-Erfassung erfolgt. Einziger Unterschied:
 * beim Barcodescanner oder OCR erscheint auch dann, wenn das Set NICHT
 * vorhanden ist, ein Zwischendialog zum Prüfen der erkannten Nummer."
 *
 * ── Was sich gegenüber den Nachträgen 57–59 geändert hat ────────────────────
 * Damals prüfte diese App selbst, VOR dem Anlegen, mit `repo.getSetDetail()`
 * und einer eigenen Auswertung von „Netzfehler" gegen „nicht gefunden". Die
 * Webapp hatte diese Regel gar nicht und erhöhte still die Menge — dieselbe
 * Eingabe, zwei Ausgänge.
 *
 * Jetzt liegt die Regel auf dem Server (utils/setAdd.ts, findSetInScope):
 *
 *   • NUMMERN-Weg: kein Vorab-Aufruf mehr. Das Erfassen selbst antwortet mit
 *     `action = "exists"` und schreibt nichts; die App öffnet daraufhin die
 *     Detailansicht. Ein Aufruf weniger, und die Regel kann nicht mehr
 *     zwischen den Clients auseinanderlaufen.
 *   • SCANNER und TEXTERKENNUNG: fragen weiterhin vorher — aber
 *     `GET /sets/exists/:nummer`, das ausdrücklich `exists: true|false` sagt.
 *     Sie MÜSSEN vorher fragen, weil die Antwort darüber entscheidet, ob
 *     überhaupt der Zwischendialog erscheint.
 *
 * Der frühere `transient`-Zweig ist damit entfallen: Ein Fehler ist jetzt
 * eindeutig ein Fehler, weil „nicht vorhanden" nicht mehr als Fehler kommt.
 *
 * Ausgeführt geprüft wird das in ErfassungViewModelTest (Nummern-Weg,
 * Scanner, Texterkennung, Fehler der Vorabfrage). Hier bleibt die Struktur:
 * der API-Vertrag und dass die Galerie den Auslöser auswertet.
 */
class AddExistingSetTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()

    /** Kommentare ausblenden — die Erklärtexte nennen die geprüften Muster selbst. */
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `die Existenzpruefung schickt keinen Kontofilter mit`() {
        // Die Frage lautet „habe ich das schon?", nicht „sehe ich das gerade?".
        // Ohne accounts-Parameter nimmt der Server sein Standard-Blickfeld —
        // Haupt- UND Unterkonten, unabhängig vom Filter der Ansicht. Genau
        // darauf beruht Marcos Zusage „oder einer der Unteraccounts".
        val api = code(java.io.File("src/main/java/ch/brickinventoryapp/data/api/BrickApiService.kt").readText())
        val i = api.indexOf("fun getSetExists(")
        assert(i > 0) { "getSetExists fehlt im API-Vertrag" }
        // NUR bis zum Ende der Signatur schneiden. Ein festes Zeichenfenster
        // reichte in die NÄCHSTE Deklaration hinein, und die hat einen
        // accounts-Parameter — die Prüfung wäre grundlos rot geworden.
        // Dasselbe Muster ist in diesem Projekt schon viermal aufgefallen.
        val ende = api.indexOf("): Response", i)
        val sig = api.substring(i, if (ende > i) ende else minOf(i + 300, api.length))
        assert(!sig.contains("accounts")) {
            "getSetExists schickt einen Kontofilter mit — dann fände ein auf \"eigene\" " +
                "gefilterter Client die Sets des Unterkontos nicht"
        }
    }

    @Test
    fun `der Auslöser wird auch ausgewertet und wieder zurückgesetzt`() {
        // Ein gesetzter Auslöser ohne Empfänger wäre wirkungslos — und ohne
        // Zurücksetzen liesse sich dasselbe Set kein zweites Mal öffnen.
        val nav = code(java.io.File("src/main/java/ch/brickinventoryapp/nav/CollectionGraph.kt").readText())
        // Geprueft wird das FELD, nicht der Name des Zustands davor.
        assert(Regex("""\w+\.gefundenesSet""").containsMatchIn(nav)) {
            "die Galerie beobachtet den Auslöser nicht — es passiert dann gar nichts"
        }
        assert(nav.contains("gallerySearchFoundConsumed()")) {
            "der Auslöser wird nicht zurückgesetzt"
        }
        assert(nav.contains("Screen.SetDetail.createRoute")) {
            "es wird nicht zur Detailansicht navigiert"
        }
    }
}
