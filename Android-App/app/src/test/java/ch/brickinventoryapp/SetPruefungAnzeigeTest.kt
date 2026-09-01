package ch.brickinventoryapp

import org.junit.Test

/**
 * Prüfen ist sichtbar, Erfassen läuft im Hintergrund.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 * „Wenn man mit dem Barcode oder auch manuell ein Set erfasst, sieht man nicht,
 * dass die App am Prüfen ist, ob man das Set bereits besitzt. Erst das
 * effektive Hinzufügen soll im Hintergrund passieren — sonst passiert es, dass
 * man zu schnell Sets einscannt."
 *
 * Der Zustand davor, nachgemessen:
 *
 *   • `resolveBarcode()` zeigte eine Schnellmeldung, die von selbst wieder
 *     verschwindet, während die Auflösung (bis zu acht Rebrickable-Abrufe)
 *     und die Bestandsfrage noch liefen.
 *   • `useScannedSetNumber()` zeigte GAR NICHTS — der Weg war komplett still.
 *   • `addSet()` (Galerie/Katalog) wartete stumm auf die Antwort des Servers.
 *
 * Der Scanner-Bildschirm schliesst sich vor alldem: nav/ToolsGraph.kt ruft
 * `popBackStack()` VOR der Auflösung. Genau in dieser Lücke scannt man weiter.
 *
 * ── Warum es diesen Wächter braucht ─────────────────────────────────────────
 * Es ist die vierte Ausprägung desselben Musters in diesem Baum: „dieselbe
 * Regel fehlt am zweiten Weg" (Nachträge 60, 64, 88). Die Erfassung hat vier
 * Eingänge, und dreimal in Folge hat ein neuer Eingang eine Regel nicht
 * mitbekommen, die am ersten längst galt. Ein Wächter, der die Regel an ALLEN
 * Wegen prüft, ist die einzige Form, die das nächste Mal überlebt.
 *
 * ── Nicht ausführbar in der Prüfumgebung ────────────────────────────────────
 * Kotlin lässt sich hier nicht übersetzen (dl.google.com wird vom Netzproxy mit
 * 403 abgelehnt, das Android-Plugin fehlt im Gradle-Cache). Die Regeln unten
 * wurden deshalb vor dem Einchecken in einer Nachbildung gegengeprobt; die
 * Übersetzung selbst weist die Action nach.
 */
class SetPruefungAnzeigeTest {

    private fun ui(datei: String) = Quellen.lies("ui/$datei")

    /** Alle `internal fun MainViewModel.name(`-Signaturen einer Datei. */
    private fun wege(datei: String): List<String> =
        Regex("""internal fun MainViewModel\.(\w+)\(""")
            .findAll(Quellen.ohneKommentare(ui(datei)))
            .map { it.groupValues[1] }.toList()

    private fun fenster(datei: String, name: String) =
        Quellen.funktion(ui(datei), "internal fun MainViewModel.$name(")

    /**
     * Die Abrufe, die NUR fragen und nichts schreiben.
     *
     * Nur sie stehen unter der Anzeigepflicht: Ein Schreib-Abruf darf nicht
     * anhalten, sonst wäre die zweite Hälfte von Marcos Regel verletzt.
     */
    private val fragen = listOf("repo.sets.getSetExists(", "repo.sets.resolveBarcode(")

    @Test
    fun `jeder Weg, der den Bestand erfragt, zeigt das auch an`() {
        val dateien = listOf("BarcodeFeature.kt", "GalleryFeature.kt", "SetDetailFeature.kt")
        val stumm = mutableListOf<String>()
        var geprueft = 0
        for (d in dateien) {
            for (name in wege(d)) {
                val f = fenster(d, name)
                if (fragen.none { it in f }) continue
                geprueft++
                if ("zeigePruefung(" !in f) stumm += "$d: $name"
            }
        }
        // Untergrenze wie in den übrigen Sammelprüfungen: Ein leerer Lauf
        // liesse die Zusicherung darunter stillschweigend bestehen.
        assert(geprueft >= 2) { "Nur $geprueft fragende Wege gefunden — Muster veraltet?" }
        assert(stumm.isEmpty()) {
            "Diese Wege fragen den Server, ob das Set schon vorhanden ist, ohne es " +
                "anzuzeigen:\n  " + stumm.joinToString("\n  ") +
                "\nGenau so war useScannedSetNumber() vor diesem Nachtrag: Der Scanner " +
                "ist längst geschlossen, und man scannt weiter, während noch geprüft wird."
        }
    }

    @Test
    fun `jede Anzeige wird in einem finally wieder geraeumt`() {
        val dateien = listOf("BarcodeFeature.kt", "GalleryFeature.kt")
        val offen = mutableListOf<String>()
        var geprueft = 0
        for (d in dateien) {
            for (name in wege(d)) {
                val f = fenster(d, name)
                if ("zeigePruefung(" !in f) continue
                geprueft++
                // Bewusst eng: Das `finally` muss `pruefungFertig()` DIREKT
                // enthalten, ohne verschachtelte Blöcke dazwischen. Ein finally
                // mit eigener Verzweigung wäre hier schon der Anfang des
                // Fehlers — dann gäbe es wieder Rückwege, die nichts räumen.
                if (!Regex("""finally\s*\{[^{}]*pruefungFertig\(\)""").containsMatchIn(f))
                    offen += "$d: $name"
            }
        }
        assert(geprueft >= 3) { "Nur $geprueft anzeigende Wege gefunden — Muster veraltet?" }
        assert(offen.isEmpty()) {
            "Diese Wege zeigen die Prüfung an, räumen sie aber nicht in einem finally " +
                "wieder ab:\n  " + offen.joinToString("\n  ") +
                "\nresolveBarcode() allein hat sechs Rückwege, vier davon vorzeitig. " +
                "Ein einziger übersehener lässt den Dialog stehen, und die App wirkt " +
                "eingefroren."
        }
    }

    @Test
    fun `das Erfassen aus dem Barcode-Dialog zeigt nichts an`() {
        // Die zweite Hälfte der Regel, und die leichter zu verlierende: „Erst
        // das effektive Hinzufügen soll im Hintergrund passieren."
        //
        // confirmAddBarcode() schliesst den Dialog SOFORT und erfasst danach
        // (Nachtrag 88). Käme hier eine Anzeige dazu, wäre genau das
        // zurückgenommen — und der Scanner-Weg wieder so langsam wie vor
        // Nachtrag 88, nur mit anderem Aussehen.
        val f = fenster("BarcodeFeature.kt", "confirmAddBarcode")
        assert(f.isNotEmpty()) { "confirmAddBarcode() nicht gefunden — Anker veraltet?" }
        assert("repo.sets.addSet(" in f) { "confirmAddBarcode() erfasst nichts mehr — Anker veraltet?" }
        assert("zeigePruefung(" !in f) {
            "confirmAddBarcode() hält die Oberfläche an, während es erfasst. Das " +
                "Hinzufügen gehört in den Hintergrund — angezeigt wird nur die Frage davor."
        }
    }

    @Test
    fun `der Galerie-Weg zeigt nur den Abruf an, nicht das Nachladen`() {
        // Die Ausnahme, und warum sie eine ist: Beim manuellen Erfassen gibt es
        // keine eigene Vorabfrage — der Server beantwortet die Bestandsfrage IM
        // Erfassungsaufruf (`action = "exists"`). Die Wartezeit auf DIESE
        // Antwort ist die Prüfung, also wird sie angezeigt.
        //
        // Entscheidend ist, wo die Anzeige endet: VOR loadSets()/loadStats()/
        // loadValuation(). Stünde sie noch währenddessen, wartete man wieder
        // auf das Nachladen — und Nachtrag 87 wäre zurückgenommen.
        val f = Quellen.ohneKommentare(fenster("GalleryFeature.kt", "addSet"))
        val fertig = f.indexOf("pruefungFertig()")
        val nachladen = f.indexOf("loadSets()")
        assert(fertig >= 0) { "addSet() räumt die Anzeige nicht — Anker veraltet?" }
        assert(nachladen >= 0) { "addSet() lädt nichts mehr nach — Anker veraltet?" }
        assert(fertig < nachladen) {
            "Die Prüfanzeige in addSet() endet erst nach dem Nachladen der Galerie. " +
                "Damit wartet man wieder auf loadSets()/loadStats()/loadValuation() — " +
                "genau das, was Nachtrag 87 abgeschafft hat."
        }
    }

    @Test
    fun `der Abbruch beendet den Abruf und nicht nur die Anzeige`() {
        val f = Quellen.funktion(ui("ErfassungFeature.kt"), "internal fun MainViewModel.brichPruefungAb(")
        assert(f.isNotEmpty()) { "brichPruefungAb() nicht gefunden — Anker veraltet?" }
        assert("erfassungsJob?.cancel()" in f) {
            "brichPruefungAb() blendet die Anzeige nur aus, statt den laufenden Abruf " +
                "zu beenden. Dann liefe er weiter und könnte den Zwischendialog öffnen, " +
                "nachdem der Nutzer abgebrochen hat."
        }
        assert("pruefungFertig()" in f) {
            "brichPruefungAb() räumt die Anzeige nicht. Auf das finally der Koroutine " +
                "ist hier kein Verlass: Es läuft erst, wenn sie den Abbruch bemerkt — " +
                "bei hängender Verbindung dauert das, und bis dahin stünde der Dialog."
        }
    }

    @Test
    fun `das Abmelden raeumt die Pruefanzeige mit`() {
        // Sonst stünde der Dialog über dem Anmeldebildschirm — und liesse sich
        // nicht wegklicken, weil sein Abbrechen-Knopf im Dialog selbst sitzt.
        val s = Quellen.ohneKommentare(ui("SessionFeature.kt"))
        assert("brichPruefungAb()" in s) {
            "Beim Abmelden bleibt die Prüfanzeige stehen. Sie nennt dann die Setnummer " +
                "des vorigen Kontos — dieselbe Lücke, die Nachtrag 117 für den " +
                "Barcode-Dialog geschlossen hat."
        }
    }
}
