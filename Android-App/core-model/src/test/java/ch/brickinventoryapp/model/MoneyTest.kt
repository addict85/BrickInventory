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
 * Geld rechnet in Zehntausendsteln wie der Server (Web-App/src/infra/geld.ts), Zeitpunkte
 * lesen jede Form, die der Server schreibt, und der Kalendertag bleibt der des Servers.
 *
 * Gegenproben (Patches unter gegenproben/):
 *   geld-schneidet-ab        Geld.aus schneidet statt zu runden → rot „ein Betrag wird auf vier Stellen gerundet …“
 *   geld-rappen-halb-gerade  onRappen mit HALF_EVEN → rot „auf Rappen gerundet wird halb von der Null weg“
 *   tag-mit-versatz          Instant.kalendertag mit +02:00 statt UTC → rot „der Kalendertag ist der des Servers …“
 */
class MoneyTest {

    @Test
    fun `ein Betrag wird auf vier Stellen gerundet wie inZehntel4 des Servers`() {
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
    fun `Summen und Mengen bleiben exakt, wo Double abwiche`() {
        val sum = Geld.aus(0.1)!! + Geld.aus(0.2)!!
        assertEquals(Geld.aus(0.3), sum)
        assertEquals("120,3333 × 2 bleibt 240,67", BigDecimal("240.67"), (Geld.aus(120.3333)!! * 2).onRappen())
        assertEquals(Geld(-5_000), Geld.aus(1.0)!! - Geld.aus(1.5)!!)
    }

    @Test
    fun `auf Rappen gerundet wird halb von der Null weg`() {
        assertEquals(BigDecimal("1.01"), Geld(10_050).onRappen())
        assertEquals(BigDecimal("0.03"), Geld(250).onRappen())
        assertEquals(BigDecimal("-0.03"), Geld(-250).onRappen())
    }

    @Test
    fun `ein Zeitpunkt liest Zeitstempel mit Zone, ohne Zone und einen blossen Tag`() {
        assertEquals(Instant.parse("2026-09-03T15:00:32.194Z"), zeitpunkt("2026-09-03T15:00:32.194Z"))
        assertEquals(Instant.parse("2026-09-03T13:00:00Z"), zeitpunkt("2026-09-03T15:00:00+02:00"))
        assertEquals(Instant.parse("2026-09-03T15:00:00Z"), zeitpunkt("2026-09-03 15:00:00"))
        assertEquals(Instant.parse("2026-09-03T00:00:00Z"), zeitpunkt("2026-09-03"))
        assertNull(zeitpunkt("gestern"))
        assertNull(zeitpunkt(" "))
    }

    @Test
    fun `der Kalendertag ist der des Servers, nicht der der Geraetezone`() {
        // Kurz vor Mitternacht UTC: In einer Zone östlich von UTC wäre es schon der nächste Tag.
        assertEquals("03.09.2026", fmtDatum(Instant.parse("2026-09-03T23:30:00Z"), Locale.GERMANY))
        assertEquals("03.09.26", fmtDatum(zeitpunkt("2026-09-03"), Locale.GERMANY, DateYear.SHORT))
        assertNull(fmtDatum(null as Instant?, Locale.GERMANY))
    }

    @Test
    fun `die Herkunft einer Figur kennt Set und manuell, Unbekanntes zaehlt als Set`() {
        assertEquals(Herkunft.MANUELL, Herkunft.aus("manual"))
        assertEquals(Herkunft.SET, Herkunft.aus("set"))
        assertEquals(Herkunft.SET, Herkunft.aus(null))
        assertEquals(Herkunft.SET, Herkunft.aus("bricklink"))
    }
}
