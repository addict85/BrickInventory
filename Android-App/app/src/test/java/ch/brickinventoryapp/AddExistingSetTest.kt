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
 * Der Test liest nur die Quelldateien — kein Gerät, kein Compose.
 */
class AddExistingSetTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()

    /** Kommentare ausblenden — die Erklärtexte nennen die geprüften Muster selbst. */
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    private val addSetBlock: String by lazy {
        val c = code(read("ui/GalleryFeature.kt"))
        val start = c.indexOf("internal fun MainViewModel.addSet(")
        val ende = c.indexOf("internal fun MainViewModel.updateQuantity(")
        c.substring(start, if (ende > start) ende else c.length)
    }

    @Test
    fun `der Nummern-Weg prueft nicht mehr selbst, sondern folgt der Serverantwort`() {
        assert(!addSetBlock.contains("repo.getSetDetail(")) {
            "Der Vorab-Aufruf ist zurück. Die Regel gehört auf den Server — sonst " +
                "existiert sie zweimal, und die Webapp hatte sie nie."
        }
        assert(addSetBlock.contains("action == \"exists\"")) {
            "Die Antwort des Servers wird nicht ausgewertet — dann bliebe ein bereits " +
                "vorhandenes Set unbemerkt und der Nutzer sähe nur eine Meldung"
        }
        val exists = addSetBlock.indexOf("action == \"exists\"")
        val geladen = addSetBlock.indexOf("loadSets()")
        assert(geladen < 0 || exists < geladen) {
            "Der exists-Zweig muss VOR dem Normalfall stehen — sonst läuft das " +
                "Nachladen samt Erfolgsmeldung für einen Vorgang, der nichts geschrieben hat"
        }
        assert(addSetBlock.contains("gallerySearchFoundSetNumber")) {
            "Bei vorhandenem Set muss der Auslöser für die Detailansicht gesetzt werden"
        }
    }

    @Test
    fun `Scanner und Texterkennung fragen vorher — mit der eindeutigen Antwort`() {
        // Sie müssen vorher fragen: Ob der Zwischendialog erscheint, hängt an
        // der Antwort. Aber sie fragen den Endpunkt, der „gibt es das schon?"
        // ausdrücklich beantwortet, statt aus dem FEHLER von getSetDetail zu
        // schliessen — das vermischte „nicht vorhanden" mit „nicht erreichbar".
        val bc = code(read("ui/BarcodeFeature.kt"))
        assert(!bc.contains("repo.getSetDetail(")) {
            "getSetDetail als Existenzprüfung ist zurück — die Antwort ist dort " +
                "ein Fehler, und Fehler haben mehr als eine Bedeutung"
        }
        assert(bc.contains("repo.getSetExists(")) { "die Existenzprüfung fehlt ganz" }
        // Beide Wege: der Scanner-Zweig und useScannedSetNumber (Texterkennung).
        assert(Regex("repo\\.getSetExists\\(").findAll(bc).count() >= 2) {
            "Nur EIN Weg prüft — Scanner und Texterkennung müssen sich gleich verhalten"
        }
        assert(bc.contains("data.exists")) {
            "Das Ergebnis wird nicht am Feld `exists` abgelesen"
        }
        assert(!bc.contains(".sets.any")) {
            "Die Prüfung gegen die geladene Liste ist zurück — sie ist seitenweise " +
                "geladen und kontogefiltert"
        }
    }

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
    fun `ein Fehler der Vorabfrage bricht ab, statt zu raten`() {
        // ── Nachtrag 59, in neuer Form ──────────────────────────────────────
        // Der gefährliche Fall war fein: Die Prüfung scheitert an einer
        // Zeitüberschreitung, der Anlege-Aufruf kommt eine Sekunde später
        // durch — ein vorhandenes Set wäre doch erhöht worden. Damals musste
        // dafür `transient` von „nicht gefunden" getrennt werden, weil beides
        // als Fehler kam. Jetzt ist „nicht vorhanden" eine ERFOLGREICHE
        // Antwort mit `exists = false`; ein Fehler ist eindeutig ein Fehler und
        // führt zum Abbruch.
        val bc = code(read("ui/BarcodeFeature.kt"))
        val stellen = Regex("""is Result\.Error -> \{[^}]*return@launch""", RegexOption.DOT_MATCHES_ALL)
            .findAll(bc).count()
        assert(stellen >= 2) {
            "Ein gescheiterter exists-Aufruf muss abbrechen — sonst wird auf gut Glück " +
                "ein womöglich vorhandenes Set zum Erfassen angeboten"
        }
    }

    @Test
    fun `der Auslöser wird auch ausgewertet und wieder zurückgesetzt`() {
        // Ein gesetzter Auslöser ohne Empfänger wäre wirkungslos — und ohne
        // Zurücksetzen liesse sich dasselbe Set kein zweites Mal öffnen.
        val nav = code(java.io.File("src/main/java/ch/brickinventoryapp/nav/CollectionGraph.kt").readText())
        assert(nav.contains("state.gallerySearchFoundSetNumber")) {
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
