package ch.brickinventoryapp.model

import ch.brickinventoryapp.model.util.DateYear
import ch.brickinventoryapp.model.util.fmtDatum
import ch.brickinventoryapp.model.util.fmtStatus
import ch.brickinventoryapp.model.util.fmtClockTime
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset
import java.util.Locale

/**
 * The shared date formatter — and the reason why it exists.
 *
 * The conversion existed twice: once via `iso.take(10).split("-")`
 * (SetDetailScreen), once via SimpleDateFormat with the fixed pattern
 * "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'" (MinifigsScreen). The second version silently fell
 * back to null for every timestamp WITHOUT milliseconds — then no date
 * stood there at all. Exactly that is checked by the first case below as well.
 *
 * Counter-checks: in fmtDatum the branch `locale.language !=
 * "en"` always taken → red “one form per language as in the web”; in the en branch `DateYear.OHNE`
 * treated like VOLL → red as well; in fmtStatus the date again fixed as
 * dd.MM.yyyy → red “the state follows the same form”. English again „$t/$m/$jj“
 * → red “one form per language …”. timeOfDayFormat() again fixed „HH:mm“ → red “the time
 * follows the device's 12 or 24 hour setting” (counter-checks/uhrzeit-fest-24-stunden.patch,
 * measured with kotlinc).
 */
class DateFormatTest {

    private val DE = Locale.forLanguageTag("de-CH")

    /** Like Intl.DateTimeFormat with 2-digit day and month in the web app (fmtDatum). */
    @Test
    fun `one form per language as in the web`() {
        val tag = "2026-08-01T10:00:00Z"
        assert(fmtDatum(tag, DE) == "01.08.2026") { fmtDatum(tag, DE).toString() }
        assert(fmtDatum(tag, Locale.forLanguageTag("en-GB")) == "1 Aug 2026")
        assert(fmtDatum(tag, Locale.forLanguageTag("en-US")) == "Aug 1, 2026")
        assert(fmtDatum(tag, DE, DateYear.WITHOUT) == "01.08.") { fmtDatum(tag, DE, DateYear.WITHOUT).toString() }
        assert(fmtDatum(tag, Locale.forLanguageTag("en-GB"), DateYear.WITHOUT) == "1 Aug")
        // No digit form „dd/mm“ in English: it reads differently depending on the country.
        for (land in listOf("en-GB", "en-US")) {
            val l = Locale.forLanguageTag(land)
            for (j in DateYear.entries) {
                val s = fmtDatum(tag, l, j).orEmpty()
                assert(!Regex("""\d{1,2}/\d{1,2}""").containsMatchIn(s)) { "$land $j: $s" }
            }
        }
    }

    @Test
    fun `the state follows the same form`() {
        val utc = ZoneOffset.UTC
        val millis = Instant.parse("2026-08-01T09:05:00Z").toEpochMilli()
        assert(fmtStatus(millis, Locale.forLanguageTag("en-GB"), utc) == "1 Aug 2026 09:05") {
            fmtStatus(millis, Locale.forLanguageTag("en-GB"), utc)
        }
        assert(fmtStatus(millis, DE, utc) == "01.08.2026 09:05")
    }

    /**
     * A fixed „HH:mm“ showed a device set to 12 hours a different clock than the status bar.
     * The device's setting decides, the language only the day-period words.
     */
    @Test
    fun `the time follows the device's 12 or 24 hour setting`() {
        val utc = ZoneOffset.UTC
        val millis = Instant.parse("2026-08-01T21:05:00Z").toEpochMilli()
        val us = Locale.forLanguageTag("en-US")
        assert(fmtStatus(millis, us, utc, twentyFour = false) == "Aug 1, 2026 9:05 PM") {
            fmtStatus(millis, us, utc, twentyFour = false)
        }
        assert(fmtStatus(millis, us, utc, twentyFour = true) == "Aug 1, 2026 21:05")
        assert(fmtStatus(millis, DE, utc, twentyFour = true, year = DateYear.WITHOUT) == "01.08. 21:05") {
            fmtStatus(millis, DE, utc, twentyFour = true, year = DateYear.WITHOUT)
        }
        val twelve = fmtStatus(millis, DE, utc, twentyFour = false)
        assert(twelve.startsWith("01.08.2026 9:05 ")) { twelve }
        val clock = fmtClockTime("2026-08-01T21:05:09Z", us, twentyFour = false)!!
        assert(Regex("""^\d{1,2}:05:09 (AM|PM)$""").matches(clock)) { clock }
    }

    @Test
    fun `timestamps with and without milliseconds give the same date`() {
        val expected = "03.09.2026"
        for (input in listOf(
            "2026-09-03T15:00:32.194Z",   // with milliseconds
            "2026-09-03T15:00:32Z",       // without — the old version gave null here
            "2026-09-03T15:00:32+02:00",  // with zone offset
            "2026-09-03",                 // only the day
        )) {
            assert(fmtDatum(input, DE) == expected) {
                "fmtDatum(\"$input\") ergab ${fmtDatum(input, DE)}, erwartet $expected"
            }
        }
    }

    @Test
    fun `two-digit year on request`() {
        assert(fmtDatum("2026-09-03", DE, DateYear.SHORT) == "03.09.26")
    }

    /**
     * The time for the log — see fmtClockTime.
     *
     * ── Why there is no check against a fixed time ──────────────────────────
     *
     * fmtClockTime converts DELIBERATELY into the device's zone (unlike
     * fmtDatum; the reasoning stands there). An assertion like
     * `== "17:00:32"` would thus depend on the time zone of the machine on
     * which the test runs — green here, red in the GitHub job or vice versa. A
     * test that depends on the environment gets switched off at the first red
     * run.
     *
     * Therefore what is checked is what holds INDEPENDENTLY of the zone: the form, the
     * seconds (no zone shifts them — half hours exist, half
     * minutes do not), and that one hour difference in the input gives one
     * hour difference in the output.
     */
    @Test
    fun `time has the right form and computes consistently`() {
        for (input in listOf(
            "2026-09-03T15:00:32.194Z",   // with milliseconds
            "2026-09-03T15:00:32Z",       // without
            "2026-09-03T15:00:32+02:00",  // with zone offset
            "2026-09-03T15:00:32",        // without zone — counts as UTC
        )) {
            val u = fmtClockTime(input)
            assert(u != null && Regex("""\d\d:\d\d:\d\d""").matches(u)) {
                "fmtClockTime(\"$input\") ergab $u, erwartet HH:MM:SS"
            }
            // Only the SECONDS, not minutes and seconds: there are zones with
            // half-hour offset (India +05:30), there the conversion
            // does shift the minute. The first version of this line
            // checked ":00:32" and would have turned red on a machine in Kolkata
            // — an assertion that holds only by chance because here
            // and in the GitHub job UTC is set.
            assert(u!!.endsWith(":32")) {
                "fmtClockTime(\"$input\") ergab $u — die Sekunden aendert keine Zone"
            }
        }
        val early = fmtClockTime("2026-09-03T10:00:00Z")!!.take(2).toInt()
        val late = fmtClockTime("2026-09-03T11:00:00Z")!!.take(2).toInt()
        assert((late - early + 24) % 24 == 1) {
            "Eine Stunde Unterschied ergab $early → $late"
        }
    }

    @Test
    fun `unusable times give null, not nonsense`() {
        for (input in listOf(null, "", "gleich", "2026-09-03")) {
            assert(fmtClockTime(input) == null) {
                "fmtClockTime(\"$input\") ergab ${fmtClockTime(input)}, erwartet null"
            }
        }
    }

    @Test
    fun `unusable inputs give null, not nonsense`() {
        for (input in listOf(null, "", "morgen", "2026-9-3", "03.09.2026")) {
            assert(fmtDatum(input, DE) == null) {
                "fmtDatum(\"$input\") ergab ${fmtDatum(input, DE)}, erwartet null"
            }
        }
    }
}
