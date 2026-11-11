package ch.brickinventoryapp.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Ratschen: Zahlen, die nur sinken dürfen. Jede steht genau auf dem gemessenen Wert;
 * steigt sie, ist der Test rot, sinkt sie, verlangt er, die Schranke nachzuziehen.
 * Eine Regex auf den Quelltext bestätigt nur, dass eine Zeile dasteht; gezählt wird,
 * wie viele Testfunktionen das noch tun. Gegenstück zu Web-App/test/ratschen.test.js.
 *
 * Gegenproben (Patches unter gegenproben/):
 *   schranke-zu-hoch           Schranke der Quelltext-Funktionen +1 → rot „Testfunktionen,
 *                              die Quelltext lesen …“ (gesunken, nachziehen)
 *   helfer-zaehlt-nicht        ein lesender Helfer zählt nicht mehr → rot, derselbe Test
 *   werkzeugausgabe-zaehlt     die Ausgabe eines Werkzeugs zählt wieder als Quelltext → rot „die Ausgabe
 *                              eines Werkzeugs …“ und „Testfunktionen, die Quelltext lesen …“
 *   geschichte-im-testkopf     Nachtragsnummer und Melder im Kopf von TabOpensAtTopTest → rot „lange
 *                              Kommentare im Workflow und in Tests …“
 *   kommentar-zu-lang          sechs Zeilen Prosa über AppViewModel → rot „kein Kommentar hat …“
 *   bau-kommentar-zu-lang      sechs Zeilen in gradle.properties → rot „kein Kommentar in Build …“
 *   verweis-aufs-archiv        ein „Ausführlich: docs/begruendungen/…“ in TokenTresor.kt → rot „kein Verweis
 *                              auf das Begründungsarchiv …“
 *   kdoc-doppelt               ein verwaister KDoc-Block vor Alarmabholung → rot, derselbe Test
 *   detekt-baseline-waechst    Obergrenze eins unter den Einträgen → rot „die detekt-Baseline …“
 *   detekt-baseline-fremde-regel  ein MagicNumber-Eintrag → rot, derselbe Test
 *   cache-schluckt-abbruch     macht „kein breiter Fang …“ rot
 *   runcatching-um-suspend     BrickInventoryApp übernimmt das alte Token wieder in runCatching
 *                              → rot „kein runCatching verschluckt …“
 *   runcatching-um-suspend-lambda  Offlineablage ruft die suspend-Quelle (ein Feld vom Typ
 *                              `suspend () -> String?`) in runCatching auf → rot, derselbe Test
 *   voll-qualifiziert          `ch.brickinventoryapp.model.util.fangeAusserAbbruch` ausgeschrieben → rot
 *                              „kein voll qualifizierter Projektname …“ und „voll qualifizierte Namen …“
 *   warten-in-echtzeit         TeileViewModelTest schläft wieder 200 ms → rot „Echtzeit-Warten …“
 *   core-data-oeffentlich      liegtUnter ohne internal → rot „die oeffentliche Flaeche der Datenmodule …“
 *   bereich-oeffentlich        qrWechseltServer ohne internal → rot „die oeffentliche Flaeche der Bereiche …“
 *   erfassung-an-der-activity  ErfassungViewModel wieder per `by viewModels()` in MainActivity
 *                              → rot „die Activity haelt nicht mehr ViewModels …“
 */
class QuelltextRatscheTest {

    private val zeichenkette = Regex("\"\"\"[\\s\\S]*?\"\"\"|\"(?:\\\\.|[^\"\\\\\n])*\"")

    /** Ohne Kommentare und Zeichenketten: Ein Dateiname wie "GalleryScreen.kt" ist kein Aufruf. */
    private fun code(roh: String) = zeichenkette.replace(Quellen.ohneKommentare(roh), "\"\"")

    /** Gleichheit: Steigt die Zahl, ist das ein Fehler; sinkt sie, wird die Schranke nachgezogen. */
    private fun ratsche(was: String, schranke: Number, gemessen: Number, hinweis: String = "") {
        assertTrue("$was: $gemessen, erlaubt $schranke. $hinweis", gemessen.toDouble() <= schranke.toDouble())
        assertEquals("$was ist auf $gemessen gesunken — die Schranke von $schranke auf $gemessen senken",
            schranke.toDouble(), gemessen.toDouble(), 0.0)
    }

    /**
     * Was als Lesen von Quelltext zählt: Quellen.*, Pfade unter src/main, Workflow, Ressourcen,
     * Dateitext. Die Ausgabe eines gestarteten Werkzeugs (`bufferedReader().readText()`) ist
     * ein Ergebnis, kein Quelltext.
     */
    private val liestQuelle = Regex("""Quellen\.|"src/main/|File\("src/main|\.\./\.\./\.github|res/values|(?<!bufferedReader\(\)\.)readText\(\)|readLines\(\)""")

    /**
     * (Testfunktionen, davon lesend) einer Datei. Eine Funktion liest Quelltext, wenn ihr Rumpf
     * es tut oder einen Wert bzw. eine Funktion der Datei benutzt, die es tut.
     */
    internal fun quelltextFunktionen(roh: String): Pair<Int, Int> {
        val c = Quellen.ohneKommentare(roh)
        val helfer = Regex("""(?:val|fun)\s+(\w+)[^\n]*""").findAll(c).filter { m ->
            val stueck = c.substring(m.range.first, minOf(c.length, m.range.first + 400)).substringBefore("\n\n")
            liestQuelle.containsMatchIn(m.value) || (m.value.startsWith("fun") && liestQuelle.containsMatchIn(stueck))
        }.map { it.groupValues[1] }.toSet()
        val tests = c.split(Regex("""@Test\b""")).drop(1).map { it.substringBefore("\n    }\n") }
        val lesend = tests.count { t -> liestQuelle.containsMatchIn(t) || helfer.any { Regex("""\b${Regex.escape(it)}\b""").containsMatchIn(t) } }
        return tests.size to lesend
    }

    @Test
    fun `Testfunktionen, die Quelltext lesen, werden weniger, nie mehr`() {
        val FUNKTIONEN = 222
        val NUR_QUELLTEXT = 37
        val alle = Quellen.tests.walkTopDown().filter { it.isFile && it.name.endsWith("Test.kt") }
            .filter { it.name != "QuelltextRatscheTest.kt" }.toList()
        val zaehlung = alle.associate { it.name to quelltextFunktionen(it.readText()) }
        val gesamt = zaehlung.values.sumOf { it.first }
        assertTrue("Nur ${alle.size} Testdateien, $gesamt Tests — greift die Suche noch?", alle.size >= 200 && gesamt >= 1000)
        val nur = zaehlung.filterValues { (n, l) -> n > 0 && l == n }.keys.sorted()
        ratsche("Testfunktionen, die Quelltext lesen", FUNKTIONEN, zaehlung.values.sumOf { it.second },
            "Prüft der neue Test Verhalten, soll er den Code ausführen statt nachzusehen, ob eine Zeile dasteht.")
        ratsche("Testdateien, die nur Quelltext lesen", NUR_QUELLTEXT, nur.size, nur.joinToString())
    }

    @Test
    fun `ein lesender Helfer zaehlt fuer jede Funktion, die ihn benutzt`() {
        val datei = "private val src = Quellen.lies(\"x.kt\")\n" +
            "@Test\nfun a() {\n    assert(\"y\" in src)\n    }\n" +
            "@Test\nfun b() {\n    assert(1 + 1 == 2)\n    }\n"
        assertEquals(2 to 1, quelltextFunktionen(datei))
    }

    @Test
    fun `die Ausgabe eines Werkzeugs ist kein Quelltext`() {
        val datei = "private fun lauf() = ProcessBuilder(\"python3\").start().inputStream.bufferedReader().readText()\n" +
            "@Test\nfun a() {\n    assert(\"ok\" in lauf())\n    }\n\n" +
            "@Test\nfun b() {\n    assert(\"x\" in File(\"y\").readText())\n    }\n"
        assertEquals(2 to 1, quelltextFunktionen(datei))
    }

    /** Die Kotlin-Dateien unter src/main aller Module, ohne die aus den Design-Tokens erzeugten. */
    private fun produktivDateien(): List<File> = Quellen.module.flatMap { m ->
        File(m, "src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
    }.filterNot { "ERZEUGT aus shared/design-tokens.json" in it.readText() }

    private fun istKommentar(t: String) = t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")

    /** Prosazeilen je Kommentarblock (//-Folge gleicher Einrückung oder /* … */), ohne KDoc-Tags. */
    private fun bloecke(zeilen: List<String>): List<Pair<Int, Int>> {
        val ergebnis = mutableListOf<Pair<Int, Int>>()
        var i = 0
        while (i < zeilen.size) {
            val t = zeilen[i].trim()
            val einzug = zeilen[i].length - zeilen[i].trimStart().length
            var j = i
            val text = mutableListOf<String>()
            when {
                t.startsWith("//") -> {
                    while (j + 1 < zeilen.size && zeilen[j + 1].trim().startsWith("//") &&
                        zeilen[j + 1].length - zeilen[j + 1].trimStart().length == einzug) j++
                    (i..j).mapTo(text) { zeilen[it].trim().removePrefix("//").trim() }
                }
                t.startsWith("/*") && !t.contains("*/") -> {
                    while (j + 1 < zeilen.size && !zeilen[j].contains("*/")) j++
                    (i..j).mapTo(text) { zeilen[it].trim().removePrefix("/**").removePrefix("/*").removeSuffix("*/").removePrefix("*").trim() }
                }
                else -> { i++; continue }
            }
            ergebnis += (i + 1) to prosa(text)
            i = j + 1
        }
        return ergebnis
    }

    /** Prosazeilen ohne KDoc-Tags; ein Tag gilt bis zur nächsten Leerzeile. */
    private fun prosa(text: List<String>): Int {
        var imTag = false
        return text.count { z ->
            if (z.startsWith("@")) imTag = true else if (z.isEmpty()) imTag = false
            z.isNotEmpty() && !imTag
        }
    }

    @Test
    fun `der Kommentaranteil sinkt, nie steigt`() {
        // Ein Anteil, keine Zahl: Er darf sinken, ohne dass jemand nachziehen muss.
        val SCHRANKE = 22.7
        var zeilen = 0
        var kommentar = 0
        for (f in produktivDateien()) for (z in f.readLines()) {
            val t = z.trim()
            if (t.isEmpty()) continue
            zeilen++
            if (istKommentar(t)) kommentar++
        }
        assert(zeilen > 30_000) { "Nur $zeilen Zeilen gefunden — greift die Suche noch?" }
        val anteil = Math.round(1000.0 * kommentar / zeilen) / 10.0
        assert(anteil <= SCHRANKE) { "Kommentaranteil $anteil %, erlaubt $SCHRANKE %" }
    }

    @Test
    fun `kein Kommentar hat mehr als fuenf Zeilen Prosa`() {
        var gezaehlt = 0
        val lang = produktivDateien().flatMap { f ->
            bloecke(f.readLines()).also { gezaehlt += it.size }
                .filter { it.second > 5 }.map { "${f.name}:${it.first} (${it.second} Zeilen)" }
        }
        assert(gezaehlt > 1000) { "Nur $gezaehlt Kommentarblöcke gefunden — greift die Suche noch?" }
        assert(lang.isEmpty()) { "Kommentare über fünf Zeilen; das Warum kürzen, die Geschichte in den Commit:\n  " + lang.joinToString("\n  ") }
    }

    /** Prosazeilen je `#`-Block (gleiche Einrückung); leere `#`-Zeilen zählen nicht. */
    private fun rautenBloecke(zeilen: List<String>): List<Pair<Int, Int>> {
        val ergebnis = mutableListOf<Pair<Int, Int>>()
        var i = 0
        while (i < zeilen.size) {
            val einzug = zeilen[i].length - zeilen[i].trimStart().length
            if (!zeilen[i].trimStart().startsWith("#")) { i++; continue }
            var j = i
            while (j + 1 < zeilen.size && zeilen[j + 1].trimStart().startsWith("#") &&
                zeilen[j + 1].length - zeilen[j + 1].trimStart().length == einzug) j++
            ergebnis += (i + 1) to (i..j).count { zeilen[it].trim().trimStart('#').isNotBlank() }
            i = j + 1
        }
        return ergebnis
    }

    /** Buildskripte aller Module, build-logic, Katalog und gradle.properties. */
    private fun baudateien(): List<File> =
        Quellen.module.map { File(it, "build.gradle.kts") }.filter { it.isFile } +
            listOf("build.gradle.kts", "settings.gradle.kts", "gradle/libs.versions.toml", "gradle.properties")
                .map { File(Quellen.projekt, it) }.filter { it.isFile } +
            File(Quellen.projekt, "build-logic").walkTopDown()
                .filter { it.isFile && (it.extension == "kt" || it.name.endsWith(".gradle.kts")) && "/build/" !in it.invariantSeparatorsPath }

    @Test
    fun `kein Kommentar in Build-Dateien hat mehr als fuenf Zeilen Prosa`() {
        var gezaehlt = 0
        val lang = baudateien().flatMap { f ->
            val z = f.readLines()
            val bloecke = if (f.extension in setOf("toml", "properties")) rautenBloecke(z) else bloecke(z)
            bloecke.also { gezaehlt += it.size }.filter { it.second > 5 }.map { "${f.name}:${it.first} (${it.second} Zeilen)" }
        }
        assertTrue("Nur $gezaehlt Kommentarblöcke in Build-Dateien — greift die Suche noch?", gezaehlt > 30)
        assertTrue("Kommentare über fünf Zeilen; das Warum kürzen, die Geschichte in den Commit:\n  " + lang.joinToString("\n  "),
            lang.isEmpty())
    }

    @Test
    fun `lange Kommentare im Workflow und in Tests werden weniger`() {
        val WORKFLOW = 3
        val TESTS = 52
        val DATUM_UND_KENNUNG = 0
        val GESCHICHTE = 0
        val wf = File(Quellen.projekt, "../.github/workflows/android.yml").readLines()
        val wfLang = rautenBloecke(wf).filter { it.second > 5 }
        // In Tests darf ein Absatz nur dann länger sein, wenn er die Gegenproben aufzählt.
        val dateien = Quellen.tests.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        val testLang = dateien.flatMap { f -> langeAbsaetze(f.readLines()).map { "${f.name}:$it" } }
        val kennung = Regex("""[0-9]{2}\.[0-9]{2}\.20[0-9]{2}|\b(?:arch|sec|ux|perf)[0-9]+\b|\bhardened-[0-9]+""")
        val geschichte = dateien.flatMap { f ->
            f.readLines().filter { z ->
                val t = z.trim()
                (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) &&
                    kennung.containsMatchIn(t) && !t.contains("Gegenprobe", ignoreCase = true)
            }.map { "${f.name}: ${it.trim()}" }
        }
        // Wer was gemeldet hat und in welchem Nachtrag, steht im Commit, nicht im Testkopf.
        val erzaehlung = Regex("""Nachtr[aä]g\w*\s+[0-9]|\bMarcos?\b|Woher dies|\bLauf [0-9]{2,}|CI-Lauf|\bRunde [0-9]+""")
        val erzaehlt = dateien.flatMap { f ->
            f.readLines().filter { z ->
                val t = z.trim()
                (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) && erzaehlung.containsMatchIn(t)
            }.map { "${f.name}: ${it.trim()}" }
        }
        assertTrue("Nur ${wf.size} Zeilen Workflow — Pfad veraltet?", wf.size > 500)
        ratsche("Workflow-Kommentare über fünf Zeilen", WORKFLOW, wfLang.size, wfLang.joinToString())
        ratsche("Absätze über fünf Zeilen in Tests ohne Gegenproben", TESTS, testLang.size, testLang.take(20).joinToString())
        ratsche("Datum oder Prüfkennung in Testkommentaren ausserhalb der Gegenproben", DATUM_UND_KENNUNG, geschichte.size,
            geschichte.take(20).joinToString("\n  "))
        ratsche("Geschichte (Nachtrag, Melder, Herkunft) in Testkommentaren", GESCHICHTE, erzaehlt.size,
            erzaehlt.take(20).joinToString("\n  "))
    }

    /** Zeilennummern der Kommentar-Absätze über fünf Prosazeilen, die nicht mit „Gegenprobe“ beginnen. */
    private fun langeAbsaetze(zeilen: List<String>): List<Int> {
        val funde = mutableListOf<Int>()
        var anfang = -1
        val absatz = mutableListOf<String>()
        fun schliessen() {
            if (absatz.size > 5 && !absatz.first().startsWith("Gegenprobe")) funde += anfang + 1
            absatz.clear()
        }
        for ((i, z) in zeilen.withIndex()) {
            val t = z.trim()
            val kommentar = t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")
            val text = t.removePrefix("/**").removePrefix("/*").removePrefix("//").removeSuffix("*/").removePrefix("*").trim()
            if (!kommentar || text.isEmpty() || text.startsWith("@")) { schliessen(); continue }
            if (absatz.isEmpty()) anfang = i
            absatz += text
        }
        schliessen()
        return funde
    }

    @Test
    fun `kein Verweis auf das Begruendungsarchiv, und keine KDoc haengt an nichts`() {
        // Das Archiv docs/begruendungen ist nicht mehr im Baum; das Warum steht im Kommentar,
        // die Geschichte im Commit. Ein zweiter KDoc-Block direkt davor hängt an nichts.
        var kdocs = 0
        val funde = produktivDateien().flatMap { f ->
            val z = f.readLines()
            z.indices.mapNotNull { i ->
                if (z[i].trim().startsWith("/**")) kdocs++
                when {
                    "docs/begruendungen/" in z[i] -> "${f.name}:${i + 1} verweist auf das Archiv"
                    z[i].trim().startsWith("/**") && i > 0 && z[i - 1].trim().endsWith("*/") -> "${f.name}:${i + 1} zweite KDoc"
                    else -> null
                }
            }
        }
        assert(kdocs >= 500) { "Nur $kdocs KDoc-Blöcke gefunden — greift die Suche noch?" }
        assert(funde.isEmpty()) { "Das Warum in den Kommentar, die Geschichte in den Commit:\n  " + funde.joinToString("\n  ") }
    }

    /** Index der öffnenden Klammer zur schliessenden bei [zu], -1 wenn keine. */
    private fun oeffnendeKlammer(c: String, zu: Int): Int {
        var tiefe = 0
        for (i in zu downTo 0) {
            if (c[i] == '}') tiefe++
            if (c[i] == '{' && --tiefe == 0) return i
        }
        return -1
    }

    private val breiterFang = Regex("""\}\s*catch\s*\(\s*\w+\s*:\s*(?:Exception|Throwable)\s*\)""")
    private val fangKlausel = Regex("""\}\s*catch\s*\(\s*\w+\s*:\s*([\w.]+)\s*\)$""")

    /** true, wenn der Fang keinen Abbruch-Zweig hat und sein try-Rumpf [aufruf] enthält; null ohne try. */
    private fun schlucktAbbruch(c: String, fang: MatchResult, aufruf: Regex): Boolean? {
        var zu = fang.range.first
        var abbruch = false
        var auf = oeffnendeKlammer(c, zu)
        var klausel = if (auf < 0) null else fangKlausel.find(c.substring(maxOf(0, auf - 200), auf).trimEnd())
        while (auf >= 0 && klausel != null) {
            if (klausel.groupValues[1].endsWith("CancellationException")) abbruch = true
            zu = c.lastIndexOf('}', auf - 1)
            auf = oeffnendeKlammer(c, zu)
            klausel = if (auf < 0) null else fangKlausel.find(c.substring(maxOf(0, auf - 200), auf).trimEnd())
        }
        if (auf < 0 || !c.substring(0, auf).trimEnd().endsWith("try")) return null
        return !abbruch && aufruf.containsMatchIn(c.substring(auf + 1, zu))
    }

    /** Die Quelltexte der App und ein Muster für den Aufruf einer ihrer suspend-Funktionen. */
    private val suspendAufrufe: Pair<Map<File, String>, Pair<Set<String>, Regex>> by lazy {
        val texte = produktivDateien().associateWith { code(it.readText()) }
        val namen = texte.values.flatMap { c ->
            Regex("""\bsuspend\s+fun\s+(?:<[^>]*>\s*)?(?:\w+\.)?(\w+)""").findAll(c).map { it.groupValues[1] }.toList()
        }.toSet() + setOf("collect", "withContext", "withLock", "delay", "await", "join", "emit", "first")
        texte to (namen to Regex("""\b(?:${namen.joinToString("|")})\s*[({]"""))
    }

    /** Parameter und Felder mit suspend-Funktionstyp (`quelle: suspend () -> T`); nur in ihrer Datei ein Name. */
    private val suspendTyp = Regex("""\b(\w+)\s*:\s*\(?\s*suspend\b""")

    /** Das Aufrufmuster für [c]: die suspend-Funktionen der App und die suspend-Lambdas der Datei. */
    private fun aufrufIn(c: String): Regex {
        val (namen, _) = suspendAufrufe.second
        val alle = namen + suspendTyp.findAll(c).map { it.groupValues[1] }
        return Regex("""\b(?:${alle.joinToString("|")})\s*[({]""")
    }

    private val koroutinenBlock = Regex("""\b(?:launch|async|runBlocking|withContext\([^()]*\)|coroutineScope|supervisorScope|flow|runTest)\s*(?:\([^()]*\))?\s*$""")

    /** Läuft die Stelle [ab] in einer suspend-Funktion oder einem Koroutinen-Block? Nur dort gibt es einen Abbruch zu verschlucken. */
    private fun inKoroutine(c: String, ab: Int): Boolean {
        val davor = c.substring(maxOf(0, ab - 300), ab)
        val anweisung = davor.substring(maxOf(davor.lastIndexOf('{'), davor.lastIndexOf('}')) + 1)
        if (Regex("""\bsuspend\s+fun\b[^=]*=\s*$""").containsMatchIn(anweisung)) return true
        var tiefe = 0
        for (j in ab - 1 downTo 0) {
            when (c[j]) {
                '}' -> tiefe++
                '{' -> if (tiefe > 0) tiefe-- else {
                    val kopf = c.substring(maxOf(0, j - 300), j)
                    if (koroutinenBlock.containsMatchIn(kopf)) return true
                    val fn = kopf.lastIndexOf("fun ")
                    if (fn >= 0 && !kopf.substring(fn).contains('{') && !kopf.substring(fn).contains('}'))
                        return Regex("""\bsuspend\s+(?:\w+\s+)*$""").containsMatchIn(kopf.substring(0, fn))
                }
            }
        }
        return false
    }

    @Test
    fun `kein runCatching verschluckt das Abbrechen eines suspendierenden Aufrufs`() {
        // runCatching fängt auch die CancellationException wie ein breiter catch; der
        // abgebrochene Aufrufer liefe weiter. Dafür gibt es fangeAusserAbbruch.
        val texte = suspendAufrufe.first
        var geprueft = 0
        val funde = texte.flatMap { (f, c) ->
            val aufruf = aufrufIn(c)
            Regex("""\brunCatching\s*\{""").findAll(c).mapNotNull { m ->
                geprueft++
                var tiefe = 1
                var i = m.range.last + 1
                while (i < c.length && tiefe > 0) { if (c[i] == '{') tiefe++ else if (c[i] == '}') tiefe--; i++ }
                if (inKoroutine(c, m.range.first) && aufruf.containsMatchIn(c.substring(m.range.last + 1, i - 1)))
                    "${f.name}:${c.substring(0, m.range.first).count { it == '\n' } + 1}" else null
            }.toList()
        }
        assert(geprueft >= 10) { "Nur $geprueft runCatching gefunden — greift die Suche noch?" }
        assert(funde.isEmpty()) {
            "runCatching um einen suspendierenden Aufruf; fangeAusserAbbruch verwenden:\n  " + funde.joinToString("\n  ")
        }
    }

    @Test
    fun `kein breiter Fang verschluckt das Abbrechen eines suspendierenden Aufrufs`() {
        // Ein `catch (_: Exception)` um einen suspendierenden Aufruf fängt auch die
        // CancellationException; der abgebrochene Aufrufer liefe weiter. Dafür gibt
        // es fangeAusserAbbruch oder einen vorangestellten Abbruch-Zweig.
        val (texte, suche) = suspendAufrufe
        val namen = suche.first
        var geprueft = 0
        val funde = texte.flatMap { (f, c) ->
            val aufruf = aufrufIn(c)
            breiterFang.findAll(c).mapNotNull { m ->
                val schluckt = schlucktAbbruch(c, m, aufruf) ?: return@mapNotNull null
                geprueft++
                if (schluckt) "${f.name}:${c.substring(0, m.range.first).count { it == '\n' } + 1}" else null
            }.toList()
        }
        assert(namen.size > 100 && geprueft >= 15) { "Nur ${namen.size} suspend-Funktionen, $geprueft Fänge — greift die Suche noch?" }
        assert(funde.isEmpty()) {
            "Breiter Fang um einen suspendierenden Aufruf ohne Abbruch-Zweig; fangeAusserAbbruch verwenden:\n  " +
                funde.joinToString("\n  ")
        }
    }

    @Test
    fun `die detekt-Baseline haelt nur Laenge und Verzweigung und schrumpft`() {
        val baseline = File(Quellen.projekt, "config/detekt/baseline.xml").readText()
        val ids = Regex("""<ID>(\w+):""").findAll(baseline).map { it.groupValues[1] }.toList()
        val grenze = File(Quellen.projekt, "tools/detekt-obergrenze.txt").readLines()
            .first { it.isNotBlank() && !it.startsWith("#") }.trim().toInt()
        assert(ids.size >= 10) { "Nur ${ids.size} Einträge in der Baseline — Muster veraltet?" }
        val fremd = ids.filter { it !in setOf("LongMethod", "CyclomaticComplexMethod") }.distinct()
        assert(fremd.isEmpty()) { "Die Baseline verschweigt andere Regeln: $fremd. Den Fund beheben, nicht eintragen." }
        ratsche("Funktionen in der detekt-Baseline (tools/detekt-obergrenze.txt)", grenze, ids.size,
            "Eine neue lange oder verzweigte Funktion zerlegen, statt sie einzutragen.")
    }

    @Test
    fun `Echtzeit-Warten in Tests wird weniger, nie mehr`() {
        // Ein Test, der schläft, ist langsam und auf einem vollen Runner brüchig. ViewModel-Tests
        // laufen im Takt (PfadServer.imTakt, Test-Dispatcher); gezählt wird, was noch wartet.
        val SCHLAFEN = 4
        val WARTEN = 17
        val dateien = (Quellen.tests.walkTopDown() + File(Quellen.projekt, "core-testing/src/main").walkTopDown())
            .filter { it.isFile && it.extension == "kt" }.toList()
        val texte = dateien.map { code(it.readText()) }
        val schlafen = texte.sumOf { Regex("""\bThread\.sleep\(""").findAll(it).count() }
        val warten = texte.sumOf { Regex("""\bwarteBis\(""").findAll(it).count() }
        assert(dateien.size > 200) { "Nur ${dateien.size} Testdateien gefunden — greift die Suche noch?" }
        val hinweis = "Neue Tests laufen im Takt: PfadServer.imTakt() oder FakeApi mit Test-Dispatcher."
        ratsche("Thread.sleep in Tests", SCHLAFEN, schlafen, hinweis)
        ratsche("warteBis in Tests", WARTEN, warten, hinweis)
    }

    private val oeffentlicheDekl = Regex("""^(?:@[\w.:]+(?:\([^)\n]*\))?\s+)*((?:(?:public|internal|private|protected|data|sealed|abstract|open|enum|inline|value|annotation|const|suspend|operator|infix|tailrec|lateinit|fun interface)\s+)*)(?:fun\s+interface|class|interface|object|typealias|fun|val|var)\s""", RegexOption.MULTILINE)

    /** Öffentliche Deklarationen auf oberster Ebene im Hauptcode der [module]. */
    private fun oeffentlich(module: List<File>, mindestens: Int): Int {
        val dateien = module.flatMap { m ->
            File(m, "src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        }
        assert(dateien.size > mindestens) { "Nur ${dateien.size} Dateien in ${module.map { it.name }} — greift die Suche noch?" }
        return dateien.sumOf { f ->
            oeffentlicheDekl.findAll(f.readText()).count { "private" !in it.groupValues[1] && "internal" !in it.groupValues[1] }
        }
    }

    @Test
    fun `die oeffentliche Flaeche der Datenmodule waechst nicht`() {
        // Was nur das eigene Modul braucht, ist internal: Jede öffentliche Deklaration ist
        // Schnittstelle für alle Bereiche. Gezählt wird auf oberster Ebene, über core-data und
        // alles, was aus ihm abgespalten wird; sonst sänke die Zahl beim Verschieben zum Schein.
        // Darin UPDATE_ORDNER: öffentlich, weil core-data und core-update ihn teilen.
        val GRENZE = 228
        val andere = setOf("core-model", "core-ressourcen", "core-ui", "core-ui-bestand", "core-zustand", "core-testing")
        val module = Quellen.module.filter { it.name.startsWith("core-") && it.name !in andere }
        assert("core-data" in module.map { it.name }) { "core-data nicht unter ${module.map { it.name }} — greift die Suche noch?" }
        ratsche("öffentliche Deklarationen in ${module.joinToString { it.name }}", GRENZE, oeffentlich(module, 100),
            "Was nur das Modul braucht, wird internal.")
    }

    @Test
    fun `die oeffentliche Flaeche der Bereiche waechst nicht`() {
        // Ein Bereich zeigt der App Routen und Ziele; was nur er selbst braucht, ist internal.
        // Noch öffentlich ist vieles, weil Graphen und Oberflächentests in app liegen.
        val GRENZE = 149
        val module = Quellen.module.filter { it.name.startsWith("feature-") }
        assert(module.size >= 7) { "Nur ${module.size} Bereiche — greift die Suche noch?" }
        ratsche("öffentliche Deklarationen der Bereiche", GRENZE, oeffentlich(module, 100),
            "Was nur der Bereich braucht, wird internal.")
    }

    @Test
    fun `die Activity haelt nicht mehr ViewModels`() {
        // Activity-weit nur, was über jedem Ziel liegt (AktivitaetsZustand) und die Pflichtmasken;
        // alles andere holt sein Ziel mit hiltViewModel() an seinem Eintrag.
        val GRENZE = 6
        val activity = Quellen.module.map { File(it, "src/main") }.filter { it.isDirectory }
            .flatMap { d -> d.walkTopDown().filter { it.isFile && it.name == "MainActivity.kt" }.toList() }
        assertEquals("genau eine MainActivity", 1, activity.size)
        val zahl = Regex("""\bby\s+viewModels\s*\(""").findAll(code(activity.single().readText())).count()
        ratsche("ViewModels an der Activity", GRENZE, zahl, "Ein ViewModel gehört an sein Ziel.")
    }

    @Test
    fun `kein voll qualifizierter Projektname im Code`() {
        // Ein Import zeigt die Abhängigkeit im Kopf der Datei; inline bleibt sie
        // unsichtbar und die Zeile lang. Kommentare und Zeichenketten zählen nicht.
        val voll = Regex("""(?<![\w.])ch\.brickinventoryapp(?:\.[a-z]\w*)+\.[A-Za-z_]\w*""")
        val dateien = produktivDateien() + Quellen.tests.walkTopDown().filter { it.isFile && it.extension == "kt" }
        assert(dateien.size > 500) { "Nur ${dateien.size} Dateien gefunden — greift die Suche noch?" }
        val funde = dateien.flatMap { f ->
            code(f.readText()).lines().map { it.replace(Regex("//.*"), "") }
                .filterNot { it.trimStart().startsWith("import ") || it.trimStart().startsWith("package ") }
                .filter { voll.containsMatchIn(it) }.map { "${f.name}: ${it.trim()}" }
        }
        assert(funde.isEmpty()) { "Voll qualifizierte Namen; importieren statt ausschreiben:\n  " + funde.joinToString("\n  ") }
    }

    @Test
    fun `voll qualifizierte Namen fremder Pakete werden weniger`() {
        // Ausgeschrieben nur bei echter Namensgleichheit, und dann besser mit `import … as`.
        val HAUPT = 223
        val TESTS = 0
        val voll = Regex("""(?<![\w.@])(?:androidx|android|kotlinx|kotlin|java|javax|okhttp3|okio|retrofit2|com|org|coil3|dagger)(?:\.[a-z]\w*)+\.[A-Z]\w*""")
        fun zaehle(dateien: Sequence<File>) = dateien.sumOf { f ->
            code(f.readText()).lines().map { it.replace(Regex("//.*"), "") }
                .filterNot { it.trimStart().startsWith("import ") || it.trimStart().startsWith("package ") }
                .sumOf { voll.findAll(it).count() }
        }
        val haupt = zaehle(produktivDateien().asSequence())
        val tests = zaehle(Quellen.tests.walkTopDown().filter { it.isFile && it.extension == "kt" })
        assertTrue("Keine voll qualifizierten Namen gefunden — greift das Muster noch?", haupt + tests > 0)
        ratsche("voll qualifizierte Namen im Hauptcode", HAUPT, haupt)
        ratsche("voll qualifizierte Namen in Tests", TESTS, tests)
    }
}
