package ch.brickinventoryapp

import ch.brickinventoryapp.util.DatumJahr
import ch.brickinventoryapp.util.fmtDatum
import ch.brickinventoryapp.util.fmtStand
import ch.brickinventoryapp.util.fmtUhrzeit
import org.junit.Test

/**
 * Der gemeinsame Datumsformatierer — und der Grund, warum es ihn gibt.
 *
 * Es gab die Umwandlung zweimal: einmal ueber `iso.take(10).split("-")`
 * (SetDetailScreen), einmal ueber SimpleDateFormat mit dem festen Muster
 * "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'" (MinifigsScreen). Die zweite Fassung fiel bei
 * jedem Zeitstempel OHNE Millisekunden still auf null zurueck — dann stand gar
 * kein Datum da. Genau das prueft der erste Fall unten mit.
 *
 * Gegenproben (02.11.2026, kotlinc): in fmtDatum den Zweig `locale.language !=
 * "en"` immer genommen → rot „je Sprache eine Form wie im Web“; im en-Zweig `DatumJahr.OHNE`
 * wie VOLL behandelt → ebenso rot; in fmtStand das Datum wieder fest als
 * dd.MM.yyyy → rot „der Stand folgt derselben Form“. Englisch wieder „$t/$m/$jj“
 * (05.11.2026, kotlinc) → rot „je Sprache eine Form …“.
 */
class DatumFormatTest {

    private val DE = java.util.Locale.forLanguageTag("de-CH")

    /** Wie Intl.DateTimeFormat mit 2-stelligem Tag und Monat in der Webapp (fmtDatum). */
    @Test
    fun `je Sprache eine Form wie im Web`() {
        val tag = "2026-08-01T10:00:00Z"
        assert(fmtDatum(tag, DE) == "01.08.2026") { fmtDatum(tag, DE).toString() }
        assert(fmtDatum(tag, java.util.Locale.forLanguageTag("en-GB")) == "1 Aug 2026")
        assert(fmtDatum(tag, java.util.Locale.forLanguageTag("en-US")) == "Aug 1, 2026")
        assert(fmtDatum(tag, DE, DatumJahr.OHNE) == "01.08.") { fmtDatum(tag, DE, DatumJahr.OHNE).toString() }
        assert(fmtDatum(tag, java.util.Locale.forLanguageTag("en-GB"), DatumJahr.OHNE) == "1 Aug")
        // Keine Ziffernform „dd/mm“ im Englischen: Sie liest sich je nach Land verschieden.
        for (land in listOf("en-GB", "en-US")) {
            val l = java.util.Locale.forLanguageTag(land)
            for (j in DatumJahr.entries) {
                val s = fmtDatum(tag, l, j).orEmpty()
                assert(!Regex("""\d{1,2}/\d{1,2}""").containsMatchIn(s)) { "$land $j: $s" }
            }
        }
    }

    @Test
    fun `der Stand folgt derselben Form`() {
        val utc = java.time.ZoneOffset.UTC
        val millis = java.time.Instant.parse("2026-08-01T09:05:00Z").toEpochMilli()
        assert(fmtStand(millis, java.util.Locale.forLanguageTag("en-GB"), utc) == "1 Aug 2026 09:05") {
            fmtStand(millis, java.util.Locale.forLanguageTag("en-GB"), utc)
        }
        assert(fmtStand(millis, DE, utc) == "01.08.2026 09:05")
    }

    @Test
    fun `Zeitstempel mit und ohne Millisekunden ergeben dasselbe Datum`() {
        val erwartet = "03.09.2026"
        for (eingabe in listOf(
            "2026-09-03T15:00:32.194Z",   // mit Millisekunden
            "2026-09-03T15:00:32Z",       // ohne — die alte Fassung gab hier null
            "2026-09-03T15:00:32+02:00",  // mit Zonenversatz
            "2026-09-03",                 // nur der Tag
        )) {
            assert(fmtDatum(eingabe, DE) == erwartet) {
                "fmtDatum(\"$eingabe\") ergab ${fmtDatum(eingabe, DE)}, erwartet $erwartet"
            }
        }
    }

    @Test
    fun `zweistelliges Jahr auf Wunsch`() {
        assert(fmtDatum("2026-09-03", DE, DatumJahr.KURZ) == "03.09.26")
    }

    /**
     * Die Uhrzeit fuer das Protokoll — siehe fmtUhrzeit.
     *
     * ── Warum nicht auf eine feste Uhrzeit geprueft wird ────────────────────
     *
     * fmtUhrzeit rechnet ABSICHTLICH in die Zone des Geraets um (anders als
     * fmtDatum; die Begruendung steht dort). Eine Zusicherung wie
     * `== "17:00:32"` waere damit von der Zeitzone der Maschine abhaengig, auf
     * der der Test laeuft — gruen hier, rot im GitHub-Lauf oder umgekehrt. Ein
     * Test, der von der Umgebung abhaengt, wird beim ersten roten Lauf
     * abgeschaltet.
     *
     * Geprueft wird deshalb, was UNABHAENGIG von der Zone gilt: die Form, die
     * Sekunden (die verschiebt keine Zone — halbe Stunden gibt es, halbe
     * Minuten nicht), und dass eine Stunde Unterschied in der Eingabe eine
     * Stunde Unterschied in der Ausgabe ergibt.
     */
    @Test
    fun `Uhrzeit hat die richtige Form und rechnet konsistent`() {
        for (eingabe in listOf(
            "2026-09-03T15:00:32.194Z",   // mit Millisekunden
            "2026-09-03T15:00:32Z",       // ohne
            "2026-09-03T15:00:32+02:00",  // mit Zonenversatz
            "2026-09-03T15:00:32",        // ohne Zone — gilt als UTC
        )) {
            val u = fmtUhrzeit(eingabe)
            assert(u != null && Regex("""\d\d:\d\d:\d\d""").matches(u)) {
                "fmtUhrzeit(\"$eingabe\") ergab $u, erwartet HH:MM:SS"
            }
            // Nur die SEKUNDEN, nicht Minuten und Sekunden: Es gibt Zonen mit
            // halbstuendigem Versatz (Indien +05:30), dort verschiebt die
            // Umrechnung sehr wohl die Minute. Die erste Fassung dieser Zeile
            // pruefte ":00:32" und waere auf einer Maschine in Kalkutta rot
            // geworden — eine Zusicherung, die nur zufaellig gilt, weil hier
            // und im GitHub-Lauf UTC eingestellt ist.
            assert(u!!.endsWith(":32")) {
                "fmtUhrzeit(\"$eingabe\") ergab $u — die Sekunden aendert keine Zone"
            }
        }
        val frueh = fmtUhrzeit("2026-09-03T10:00:00Z")!!.take(2).toInt()
        val spaet = fmtUhrzeit("2026-09-03T11:00:00Z")!!.take(2).toInt()
        assert((spaet - frueh + 24) % 24 == 1) {
            "Eine Stunde Unterschied ergab $frueh → $spaet"
        }
    }

    @Test
    fun `unbrauchbare Uhrzeiten ergeben null, nicht Unsinn`() {
        for (eingabe in listOf(null, "", "gleich", "2026-09-03")) {
            assert(fmtUhrzeit(eingabe) == null) {
                "fmtUhrzeit(\"$eingabe\") ergab ${fmtUhrzeit(eingabe)}, erwartet null"
            }
        }
    }

    @Test
    fun `unbrauchbare Eingaben ergeben null, nicht Unsinn`() {
        for (eingabe in listOf(null, "", "morgen", "2026-9-3", "03.09.2026")) {
            assert(fmtDatum(eingabe, DE) == null) {
                "fmtDatum(\"$eingabe\") ergab ${fmtDatum(eingabe, DE)}, erwartet null"
            }
        }
    }
}
