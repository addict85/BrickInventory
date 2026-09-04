package ch.brickinventoryapp

import ch.brickinventoryapp.util.fmtDatum
import org.junit.Test

/**
 * Der gemeinsame Datumsformatierer — und der Grund, warum es ihn gibt.
 *
 * Es gab die Umwandlung zweimal: einmal ueber `iso.take(10).split("-")`
 * (SetDetailScreen), einmal ueber SimpleDateFormat mit dem festen Muster
 * "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'" (MinifigsScreen). Die zweite Fassung fiel bei
 * jedem Zeitstempel OHNE Millisekunden still auf null zurueck — dann stand gar
 * kein Datum da. Genau das prueft der erste Fall unten mit.
 */
class DatumFormatTest {

    @Test
    fun `Zeitstempel mit und ohne Millisekunden ergeben dasselbe Datum`() {
        val erwartet = "03.09.2026"
        for (eingabe in listOf(
            "2026-09-03T15:00:32.194Z",   // mit Millisekunden
            "2026-09-03T15:00:32Z",       // ohne — die alte Fassung gab hier null
            "2026-09-03T15:00:32+02:00",  // mit Zonenversatz
            "2026-09-03",                 // nur der Tag
        )) {
            assert(fmtDatum(eingabe) == erwartet) {
                "fmtDatum(\"$eingabe\") ergab ${fmtDatum(eingabe)}, erwartet $erwartet"
            }
        }
    }

    @Test
    fun `zweistelliges Jahr auf Wunsch`() {
        assert(fmtDatum("2026-09-03", zweistelligesJahr = true) == "03.09.26")
    }

    @Test
    fun `unbrauchbare Eingaben ergeben null, nicht Unsinn`() {
        for (eingabe in listOf(null, "", "morgen", "2026-9-3", "03.09.2026")) {
            assert(fmtDatum(eingabe) == null) {
                "fmtDatum(\"$eingabe\") ergab ${fmtDatum(eingabe)}, erwartet null"
            }
        }
    }
}
