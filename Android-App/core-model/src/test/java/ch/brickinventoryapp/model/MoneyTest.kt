package ch.brickinventoryapp.model

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Herkunft
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.util.DateYear
import ch.brickinventoryapp.model.util.fmtDatum
import ch.brickinventoryapp.model.util.zeitpunkt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.math.BigDecimal
import java.time.Instant
import java.util.Locale

/**
 * Money calculates in ten-thousandths like the server (Web-App/src/infra/geld.ts), points in time
 * read every form the server writes, and the calendar day stays that of the server.
 *
 * Counter-checks (patches under gegenproben/):
 *   geld-schneidet-ab        Geld.aus truncates instead of rounding → red “an amount is rounded to four places …”
 *   geld-rappen-halb-gerade  onRappen with HALF_EVEN → red “rounding to centimes goes half away from zero”
 *   tag-mit-versatz          Instant.kalendertag with +02:00 instead of UTC → red “the calendar day is the server's …”
 */
class MoneyTest {

    @Test
    fun `an amount is rounded to four places like the server's inZehntel4`() {
        assertEquals(Geld(10_050), Geld.aus(1.005))
        assertEquals(Geld(1_203_333), Geld.aus(120.3333))
        assertEquals(Geld(-1_000), Geld.aus(-0.1))
        assertNull("keine Zahl ist kein Betrag", Geld.aus(Double.NaN))
        assertNull(null.asMoney())
        assertEquals(Geld(1_250_000), Geld.fromText("125"))
        assertNull(Geld.fromText("12,50"))
        assertEquals(Geld(1), Geld.aus(BigDecimal("0.00005")))
    }

    @Test
    fun `sums and quantities stay exact where Double would deviate`() {
        val sum = Geld.aus(0.1)!! + Geld.aus(0.2)!!
        assertEquals(Geld.aus(0.3), sum)
        assertEquals("120,3333 × 2 bleibt 240,67", BigDecimal("240.67"), (Geld.aus(120.3333)!! * 2).onRappen())
        assertEquals(Geld(-5_000), Geld.aus(1.0)!! - Geld.aus(1.5)!!)
    }

    @Test
    fun `rounding to centimes goes half away from zero`() {
        assertEquals(BigDecimal("1.01"), Geld(10_050).onRappen())
        assertEquals(BigDecimal("0.03"), Geld(250).onRappen())
        assertEquals(BigDecimal("-0.03"), Geld(-250).onRappen())
    }

    @Test
    fun `a point in time reads timestamps with zone, without zone and a bare day`() {
        assertEquals(Instant.parse("2026-09-03T15:00:32.194Z"), zeitpunkt("2026-09-03T15:00:32.194Z"))
        assertEquals(Instant.parse("2026-09-03T13:00:00Z"), zeitpunkt("2026-09-03T15:00:00+02:00"))
        assertEquals(Instant.parse("2026-09-03T15:00:00Z"), zeitpunkt("2026-09-03 15:00:00"))
        assertEquals(Instant.parse("2026-09-03T00:00:00Z"), zeitpunkt("2026-09-03"))
        assertNull(zeitpunkt("gestern"))
        assertNull(zeitpunkt(" "))
    }

    @Test
    fun `the calendar day is the server's, not that of the device zone`() {
        // Shortly before midnight UTC: in a zone east of UTC it would already be the next day.
        assertEquals("03.09.2026", fmtDatum(Instant.parse("2026-09-03T23:30:00Z"), Locale.GERMANY))
        assertEquals("03.09.26", fmtDatum(zeitpunkt("2026-09-03"), Locale.GERMANY, DateYear.SHORT))
        assertNull(fmtDatum(null as Instant?, Locale.GERMANY))
    }

    @Test
    fun `the origin of a figure knows set and manual, unknown counts as set`() {
        assertEquals(Herkunft.MANUELL, Herkunft.aus("manual"))
        assertEquals(Herkunft.SET, Herkunft.aus("set"))
        assertEquals(Herkunft.SET, Herkunft.aus(null))
        assertEquals(Herkunft.SET, Herkunft.aus("bricklink"))
    }
}
