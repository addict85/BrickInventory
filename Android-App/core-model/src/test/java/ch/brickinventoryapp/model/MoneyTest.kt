package ch.brickinventoryapp.model

import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.Origin
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.util.DateYear
import ch.brickinventoryapp.model.util.fmtDatum
import ch.brickinventoryapp.model.util.parseInstant
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
 * Counter-checks (patches under counter-checks/):
 *   geld-schneidet-ab        Geld.aus truncates instead of rounding → red “an amount is rounded to four places …”
 *   geld-rappen-halb-gerade  onRappen with HALF_EVEN → red “rounding to centimes goes half away from zero”
 *   tag-mit-versatz          Instant.kalendertag with +02:00 instead of UTC → red “the calendar day is the server's …”
 */
class MoneyTest {

    @Test
    fun `an amount is rounded to four places like the server's inZehntel4`() {
        assertEquals(Money(10_050), Money.from(1.005))
        assertEquals(Money(1_203_333), Money.from(120.3333))
        assertEquals(Money(-1_000), Money.from(-0.1))
        assertNull("keine Zahl ist kein Betrag", Money.from(Double.NaN))
        assertNull(null.asMoney())
        assertEquals(Money(1_250_000), Money.fromText("125"))
        assertNull(Money.fromText("12,50"))
        assertEquals(Money(1), Money.from(BigDecimal("0.00005")))
    }

    @Test
    fun `sums and quantities stay exact where Double would deviate`() {
        val sum = Money.from(0.1)!! + Money.from(0.2)!!
        assertEquals(Money.from(0.3), sum)
        assertEquals("120,3333 × 2 bleibt 240,67", BigDecimal("240.67"), (Money.from(120.3333)!! * 2).onRappen())
        assertEquals(Money(-5_000), Money.from(1.0)!! - Money.from(1.5)!!)
    }

    @Test
    fun `rounding to centimes goes half away from zero`() {
        assertEquals(BigDecimal("1.01"), Money(10_050).onRappen())
        assertEquals(BigDecimal("0.03"), Money(250).onRappen())
        assertEquals(BigDecimal("-0.03"), Money(-250).onRappen())
    }

    @Test
    fun `a point in time reads timestamps with zone, without zone and a bare day`() {
        assertEquals(Instant.parse("2026-09-03T15:00:32.194Z"), parseInstant("2026-09-03T15:00:32.194Z"))
        assertEquals(Instant.parse("2026-09-03T13:00:00Z"), parseInstant("2026-09-03T15:00:00+02:00"))
        assertEquals(Instant.parse("2026-09-03T15:00:00Z"), parseInstant("2026-09-03 15:00:00"))
        assertEquals(Instant.parse("2026-09-03T00:00:00Z"), parseInstant("2026-09-03"))
        assertNull(parseInstant("gestern"))
        assertNull(parseInstant(" "))
    }

    @Test
    fun `the calendar day is the server's, not that of the device zone`() {
        // Shortly before midnight UTC: in a zone east of UTC it would already be the next day.
        assertEquals("03.09.2026", fmtDatum(Instant.parse("2026-09-03T23:30:00Z"), Locale.GERMANY))
        assertEquals("03.09.26", fmtDatum(parseInstant("2026-09-03"), Locale.GERMANY, DateYear.SHORT))
        assertNull(fmtDatum(null as Instant?, Locale.GERMANY))
    }

    @Test
    fun `the origin of a figure knows set and manual, unknown counts as set`() {
        assertEquals(Origin.MANUAL, Origin.from("manual"))
        assertEquals(Origin.SET, Origin.from("set"))
        assertEquals(Origin.SET, Origin.from(null))
        assertEquals(Origin.SET, Origin.from("bricklink"))
    }
}
