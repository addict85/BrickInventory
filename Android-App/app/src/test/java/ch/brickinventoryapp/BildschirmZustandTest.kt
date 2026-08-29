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
 * Es gibt zwei Sorten Zustand, und die Unterscheidung ist der eigentliche
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

    /** Zustand eines LAUFENDEN VORGANGS — der darf nicht wiederhergestellt werden. */
    private val fluechtig = Regex("""(?i)lade|loading|busy|running|laeuft|laden|pending|saving|speichert|scanning|scannt|progress|fortschritt""")

    /** Werte, die das Bundle nicht aufnehmen kann. */
    private val nichtSpeicherbar = Regex("""Offset|listOf|mapOf|setOf|Bitmap""")

    /**
     * ScrollMemory: siehe KDoc oben — dort ist `remember` die RICHTIGE Wahl.
     * ZoomableImageDialog: Skalierung und Versatz gehören zusammen; der Versatz
     * (Offset) ist nicht speicherbar, also wäre nur die halbe Sache gerettet.
     */
    private val ausgenommen = setOf("ScrollMemory.kt", "ZoomableImageDialog.kt")

    @Test
    fun `vom Menschen eingegebener Zustand uebersteht eine Drehung`() {
        val versaeumt = mutableListOf<String>()
        for (f in kotlinDateien()) {
            if (f.name in ausgenommen) continue
            for ((zn, z) in zustandsZeilen(f)) {
                if ("rememberSaveable" in z) continue
                val name = nameAus.find(z)?.groupValues?.get(1) ?: continue
                if (fluechtig.containsMatchIn(name)) continue
                if (nichtSpeicherbar.containsMatchIn(z)) continue
                versaeumt += "${f.name}:$zn  $name"
            }
        }
        assertTrue(
            "Diese Zustände gehen bei einer Bildschirmdrehung verloren — " +
                "rememberSaveable statt remember:\n  " + versaeumt.joinToString("\n  "),
            versaeumt.isEmpty(),
        )
    }

    @Test
    fun `Zustand eines laufenden Vorgangs wird NICHT wiederhergestellt`() {
        val falsch = mutableListOf<String>()
        for (f in kotlinDateien()) {
            for ((zn, z) in zustandsZeilen(f)) {
                if ("rememberSaveable" !in z) continue
                val name = nameAus.find(z)?.groupValues?.get(1) ?: continue
                if (fluechtig.containsMatchIn(name)) falsch += "${f.name}:$zn  $name"
            }
        }
        assertTrue(
            "Ein laufender Vorgang darf nicht wiederhergestellt werden — der " +
                "Ladekringel bliebe nach einer Drehung für immer stehen:\n  " +
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
