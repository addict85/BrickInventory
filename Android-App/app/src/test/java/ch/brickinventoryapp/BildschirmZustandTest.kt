package ch.brickinventoryapp

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Bildschirmzustand übersteht Drehung und Prozesstod (Nachtrag 155).
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 *
 * Fast aller Bildschirmzustand lag in `remember { mutableStateOf(...) }`. Das
 * gilt nur je Komposition: Bei einer Bildschirmdrehung, einem Wechsel in den
 * Dunkelmodus oder nachdem Android den Prozess im Hintergrund beendet hat,
 * beginnt alles wieder bei der Vorgabe. Für die Nutzenden heisst das: Suchfeld
 * leer, Filter zurückgesetzt, halb ausgefüllter Dialog weg.
 *
 * `rememberSaveable` legt den Wert im Bundle ab und stellt ihn wieder her.
 *
 * ── Warum NICHT pauschal ────────────────────────────────────────────────────
 *
 * Es gibt drei Sorten Zustand, und die Unterscheidung ist der eigentliche
 * Inhalt dieser Prüfung:
 *
 *  1. Was der Mensch eingegeben oder gewählt hat — Suchbegriff, Filter,
 *     geöffneter Dialog, Formularfelder. Das SOLL überleben.
 *
 *  2. Was einen laufenden Vorgang beschreibt — `isLoading`, `queueLoading`.
 *     Das darf NICHT überleben: Käme `isLoading = true` nach einer Drehung
 *     zurück, liefe die Koroutine, die es zurücksetzt, nicht mehr — der
 *     Ladekringel bliebe für immer stehen.
 *
 *     Dazu gehört auch eine laufende ZIEHGESTE (`dragging`, `ziehAnteil` in
 *     der Jahres-Leiste des Katalogs). Sie stand bis jetzt an `rememberSaveable`
 *     und fiel damit unter keine der beiden Sorten. Käme `dragging = true`
 *     nach einer Drehung zurück, läge kein Finger mehr auf der Leiste — das
 *     Etikett bliebe stehen, bis jemand das nächste Mal zieht. Dieselbe Falle
 *     wie beim Ladekringel, deshalb dieselbe Regel.
 *
 *  3. Was EINMALIG gemessen wurde — die Belegung der Vorschau-Ablage auf der
 *     Platte. Das darf ebenfalls NICHT überleben, aber aus dem umgekehrten
 *     Grund: Nicht weil der Erzeuger noch liefe, sondern weil ihn NIEMAND mehr
 *     anstösst — die wiederhergestellte Zahl stünde dauerhaft falsch da. Siehe
 *     den Ausdruck `gemessen` weiter unten; dort steht auch, warum eine
 *     Layout-Messung ausdrücklich NICHT dazugehört.
 *
 * Dieselbe Falle ist in diesem Baum schon einmal zugeschnappt: ScrollMemory.kt
 * hält in seiner eigenen Erklärung fest, dass der dortige Merker als
 * `rememberSaveable` „die Wiederherstellung nach dem ersten Betreten für immer
 * abschaltete" (Nachtrag 93). Deshalb ist die Datei hier ausdrücklich
 * ausgenommen.
 */
class BildschirmZustandTest {

    private val uiWurzel = File("src/main/java/ch/brickinventoryapp/ui")

    private fun kotlinDateien(): List<File> =
        uiWurzel.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()

    /** Zeilen der Form `var x by remember { mutableStateOf(...) }` — ohne Kommentarzeilen. */
    private fun zustandsZeilen(f: File): List<Pair<Int, String>> =
        f.readLines().mapIndexed { i, z -> (i + 1) to z }
            .filter { (_, z) ->
                val t = z.trim()
                !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") &&
                    Regex("""\bby\s+remember(Saveable)?\s*\{\s*mutableStateOf\(""").containsMatchIn(z)
            }

    private val nameAus = Regex("""\b(?:var|val)\s+(\w+)\s+by\s+remember""")

    /**
     * Zustand eines LAUFENDEN VORGANGS — der darf nicht wiederhergestellt werden.
     *
     * `export` kam nachtraeglich dazu (BrickLink-Wunschliste): Die Liste kannte
     * „laeuft", „loading", „saving" — aber nicht die Schreibweise, die im Baum
     * tatsaechlich stand. `isExporting` im PDF-Knopf war deshalb seit jeher
     * `rememberSaveable` und ist der Fall, gegen den diese Regel gebaut ist:
     * Nach einer Drehung waehrend des Exports kaeme `true` zurueck, die
     * Koroutine dazu ist aber tot — der Knopf bliebe fuer immer gesperrt und
     * zeigte einen Kreisel, der sich nie aufloest.
     *
     * Die Lehre ist die dieser ganzen Reihe: eine Sache in zwei Schreibweisen,
     * und die Suche kennt nur eine.
     */
    private val fluechtig = Regex("""(?i)lade|loading|busy|running|laeuft|laden|pending|saving|speichert|scanning|scannt|progress|fortschritt|zieh|drag|export|fokus|focus""")

    // ── „fokus" kam mit Nachtrag 175 dazu ───────────────────────────────────
    //
    // Zwei Eingabefelder (Lagerort in SetDetailSections.kt und
    // SetItemDetailDialog.kt) merken sich, ob sie den Fokus SCHON EINMAL
    // hatten — nur so laesst sich „beim Verlassen speichern" von „beim
    // ersten Zeichnen" unterscheiden.
    //
    // Er darf eine Drehung ausdruecklich NICHT ueberleben: Nach einer Drehung
    // baut Compose das Feld neu auf und der Fokus ist weg. Ein
    // wiederhergestelltes „hatte Fokus" liesse den naechsten Aufbau als
    // Fokusverlust gelten — und schickte eine Speicheranfrage, die niemand
    // ausgeloest hat.

    /**
     * Merker der Rollpositions-Wiederherstellung — dürfen ERST RECHT nicht überleben.
     *
     * ── Warum das eine eigene Kategorie ist (Nachtrag 155) ──────────────────
     *
     * Beim ersten Anlauf dieser Umstellung stand hier nur eine Ausnahme für die
     * DATEI ScrollMemory.kt. CatalogScreen.kt hat aber einen eigenen,
     * gleichnamigen Merker — dieselbe Mechanik, andere Datei. Der wurde
     * mitgenommen, und ListScrollPositionTest fiel darüber.
     *
     * Zu Recht: Überlebt so ein Merker den Ausflug in die Detailseite, gilt die
     * Liste nach dem allerersten Betreten für immer als wiederhergestellt, und
     * die Rückkehr springt nie mehr zurück. Genau das ist in Nachtrag 93 schon
     * einmal passiert und musste ein zweites Mal gemeldet werden.
     *
     * Deshalb wird jetzt die ART des Zustands geprüft, nicht sein Wohnort.
     */
    private val rollMerker = Regex("""(?i)wiederhergestellt|nutzerGeste|hatteGespeicherte""")

    /**
     * EINMALIG GEMESSENE WERTE — die muessen neu gelesen, nicht wiederhergestellt
     * werden (Nachtrag 158).
     *
     * Der Fall: `ablageBytes` in MonitoringSections.kt haelt fest, wie viele
     * Bytes die Vorschau-Ablage unter filesDir belegt. Der Wert wird EINMAL
     * beim Aufbau der Zeile gelesen und danach nur noch vom Leeren-Knopf
     * nachgefuehrt.
     *
     * Stuende er an `rememberSaveable`, kaeme nach einem Prozesstod die Zahl
     * aus dem Bundle zurueck — die Ablage auf der Platte kann sich in der
     * Zwischenzeit aber geaendert haben (ein anderer Bildschirm hat sie
     * gefuellt, Android hat den Prozess zwischen zwei Sitzungen beendet). Es
     * stuende dann dauerhaft eine falsche Zahl da, denn NICHTS liest sie
     * nochmals nach. Dieselbe Falle wie beim Ladekringel: ein Wert ueberlebt,
     * die Seite, die ihn erzeugt, laeuft nicht mehr.
     *
     * ── Die Abgrenzung, und warum sie nicht „jede Messung" heisst ──────────
     *
     * `heightPx` in CatalogScreen.kt ist AUCH eine Messung und steht zu Recht
     * an `rememberSaveable`: Sie kommt aus `onSizeChanged`, und dieser Erzeuger
     * laeuft nach einer Drehung sofort wieder — der wiederhergestellte Wert
     * wird im naechsten Layout-Durchgang ohnehin ueberschrieben und
     * ueberbrueckt nur das eine Bild dazwischen.
     *
     * Entscheidend ist also nicht, DASS gemessen wurde, sondern ob der
     * Erzeuger nach der Drehung noch laeuft. Deshalb fasst dieser Ausdruck
     * nur Messungen einer Ablage-Belegung und nicht Layout-Groessen.
     */
    private val gemessen = Regex("""(?i)bytes|belegt|belegung""")

    /** Werte, die das Bundle nicht aufnehmen kann. */
    private val nichtSpeicherbar = Regex("""Offset|listOf|mapOf|setOf|Bitmap""")

    /**
     * ZoomableImageDialog: Skalierung und Versatz gehören zusammen; der Versatz
     * (Offset) ist nicht speicherbar, also wäre nur die halbe Sache gerettet.
     *
     * ── ScrollMemory.kt stand hier und war überflüssig ──────────────────────
     *
     * Nachgemessen, nicht vermutet: KEINE Zeile dieser Datei erreicht die
     * Meldung überhaupt. Ihre vier Merker heissen `wiederhergestellt`,
     * `hatteGespeicherte` und `nutzerGeste` — allesamt schon von `rollMerker`
     * erfasst.
     *
     * Der Eintrag stammt aus dem ersten Anlauf, als die Prüfung noch am
     * WOHNORT hing. Nachtrag 155 hat sie auf die ART des Zustands umgestellt
     * (siehe KDoc am rollMerker) und die alte Ausnahme stehen lassen. Sie
     * verbarg seither nichts, nahm aber die ganze Datei dauerhaft aus der
     * Prüfung — auch für jeden Zustand, der später dazukäme.
     */
    private val ausgenommen = setOf("ZoomableImageDialog.kt")

    @Test
    fun `vom Menschen eingegebener Zustand uebersteht eine Drehung`() {
        val versaeumt = mutableListOf<String>()
        val ausnahmeGebraucht = mutableSetOf<String>()
        for (f in kotlinDateien()) {
            for ((zn, z) in zustandsZeilen(f)) {
                if ("rememberSaveable" in z) continue
                val name = nameAus.find(z)?.groupValues?.get(1) ?: continue
                if (fluechtig.containsMatchIn(name)) continue
                if (rollMerker.containsMatchIn(name)) continue
                if (gemessen.containsMatchIn(name)) continue
                if (nichtSpeicherbar.containsMatchIn(z)) continue
                // Eine ausgenommene Datei wird trotzdem DURCHSUCHT: Ihr Treffer
                // belegt, dass die Ausnahme noch etwas beschreibt. Wird sie
                // stattdessen gleich uebersprungen, bleibt ein toter Eintrag
                // jahrelang stehen und sperrt eine ganze Datei — genau das war
                // mit ScrollMemory.kt passiert.
                if (f.name in ausgenommen) { ausnahmeGebraucht += f.name; continue }
                versaeumt += "${f.name}:$zn  $name"
            }
        }
        assertTrue(
            "Diese Zustände gehen bei einer Bildschirmdrehung verloren — " +
                "rememberSaveable statt remember:\n  " + versaeumt.joinToString("\n  "),
            versaeumt.isEmpty(),
        )
        val veraltet = (ausgenommen - ausnahmeGebraucht).sorted()
        assertTrue(
            "Diese Ausnahmen beschreiben nichts mehr: " + veraltet.joinToString(", ") +
                " — die Datei hat keinen Zustand, den diese Pruefung ueberhaupt meldete. " +
                "Raus damit, sonst sperrt der Eintrag sie auch fuer alles Kuenftige.",
            veraltet.isEmpty(),
        )
    }

    @Test
    fun `laufender Vorgang und Rollmerker werden NICHT wiederhergestellt`() {
        val falsch = mutableListOf<String>()
        for (f in kotlinDateien()) {
            for ((zn, z) in zustandsZeilen(f)) {
                if ("rememberSaveable" !in z) continue
                val name = nameAus.find(z)?.groupValues?.get(1) ?: continue
                if (fluechtig.containsMatchIn(name) || rollMerker.containsMatchIn(name) ||
                    gemessen.containsMatchIn(name)
                ) falsch += "${f.name}:$zn  $name"
            }
        }
        assertTrue(
            "Ein laufender Vorgang, ein Merker der Rollpositions-" +
                "Wiederherstellung oder eine einmalig gemessene Belegung darf " +
                "NICHT wiederhergestellt werden — der Ladekringel bliebe für " +
                "immer stehen, die Rückkehr aus der Detailseite spränge nie " +
                "mehr zurück, bzw. es stünde dauerhaft eine falsche Zahl da:\n  " +
                falsch.joinToString("\n  "),
            falsch.isEmpty(),
        )
    }

    @Test
    fun `ScrollMemory benutzt bewusst remember und bleibt dabei`() {
        // Nicht der Vollständigkeit halber: Diese Datei hat den Fehler schon
        // einmal gehabt (Nachtrag 93). Eine spätere Sammel-Umstellung soll sie
        // nicht versehentlich mitnehmen.
        val f = File(uiWurzel, "ScrollMemory.kt")
        assertTrue("ScrollMemory.kt gibt es nicht mehr — diese Prüfung anpassen", f.exists())
        val zeilen = zustandsZeilen(f)
        assertTrue("ScrollMemory.kt hat keinen remember-Zustand mehr", zeilen.isNotEmpty())
        assertTrue(
            "ScrollMemory.kt wurde auf rememberSaveable umgestellt. Genau das " +
                "schaltete die Wiederherstellung nach dem ersten Betreten für immer ab.",
            zeilen.none { "rememberSaveable" in it.second },
        )
    }
}
