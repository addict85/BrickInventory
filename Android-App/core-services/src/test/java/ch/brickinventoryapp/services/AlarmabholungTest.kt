package ch.brickinventoryapp.services

import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.domain.Geld
import java.time.Instant
import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.services.alarm.Alarmabholung
import ch.brickinventoryapp.model.domain.AlarmabrufView
import ch.brickinventoryapp.model.domain.PriceAlertView
import ch.brickinventoryapp.data.repository.Ergebnis
import kotlinx.coroutines.test.runTest
import org.junit.Test
import java.util.Locale

/**
 * What the hourly fetch DECIDES.
 *
 * ── Why this test exists ───────────────────────────────────────────────
 *
 * The worker itself only runs with Android. But the decisions inside it are
 * exactly the kind that do NOT stand out in production when they are wrong:
 *
 *   * If the marker isn't advanced, the same notification comes back
 *     every hour — and whoever dismissed it once takes the next one for
 *     a new one.
 *   * If a notification is sent on the very first run, a freshly set-up
 *     app opens with thresholds that were crossed weeks ago.
 *
 * All three are statements about a SEQUENCE of runs. In the source code
 * all you'd see is that a marker exists.
 *
 * That's why [Alarmabholung.fetch] takes the query as a parameter and
 * not the BrickRepository — the reasoning is there.
 */
class AlarmabholungTest {

    private fun alarm(sn: String = "10179-1", richtung: Alarmrichtung = Alarmrichtung.UNTER,
                      schwelle: Double = 200.0, preis: Double? = 100.0) =
        PriceAlertView(setNumber = sn, condition = Zustand.NEU, richtung = richtung,
                   schwelle = Geld.aus(schwelle)!!, currencyCode = Waehrung("EUR"),
                   ausgeloest = true, lastlyAt = Instant.parse("2026-09-19T17:00:00.000Z"),
                   lastlyPrice = preis.asMoney(), name = null, imageLocal = null, imageUrl = null, setImgUrl = null, besitzt = false)

    private fun antwort(vararg a: PriceAlertView, now: String? = "2026-09-19T18:00:00.000Z") =
        Ergebnis.Erfolg(AlarmabrufView(alerts = a.toList(), marke = now))

    @Test
    fun `the first pass only marks and reports nothing`() = runTest {
        // Empty and null MUST behave the SAME: on a device that
        // has already written the marker once, it can be empty.
        for (ohne in listOf(null, "", "   ")) {
            var askedWith: String? = "nicht gefragt"
            val e = Alarmabholung.fetch(ohne) { seit ->
                askedWith = seit
                antwort(alarm())
            }
            assert(e is Alarmabholung.Ergebnis.Markiert) {
                "marke=${ohne?.let { "\"$it\"" }}: $e statt Markiert — eine frisch " +
                    "eingerichtete App wuerde mit alten Schwellen aufschlagen"
            }
            assert((e as Alarmabholung.Ergebnis.Markiert).neueMarke == "2026-09-19T18:00:00.000Z")
            assert(askedWith == null) {
                "Eine leere Marke wurde als `since` mitgeschickt: $askedWith"
            }
        }
    }

    @Test
    fun `a further pass reports and advances the mark`() = runTest {
        var askedWith: String? = null
        val e = Alarmabholung.fetch("2026-09-19T17:30:00.000Z") { seit ->
            askedWith = seit
            antwort(alarm(), alarm(sn = "75192-1"))
        }
        assert(e is Alarmabholung.Ergebnis.Geholt) { "$e statt Geholt" }
        e as Alarmabholung.Ergebnis.Geholt
        assert(e.meldungen.size == 2) { "${e.meldungen.size} Meldungen statt zwei" }
        // The new marker is the SERVER's, not the one passed in and not
        // the phone's clock. Otherwise clock drift would decide
        // whether a notification arrives twice or not at all.
        assert(e.neueMarke == "2026-09-19T18:00:00.000Z") { "neueMarke=${e.neueMarke}" }
        assert(askedWith == "2026-09-19T17:30:00.000Z") { "gefragt mit $askedWith" }
    }

    @Test
    fun `an empty response is the normal case and still advances the mark`() = runTest {
        // Without this, the next run would query from the old timestamp again
        // — and the span would grow with every quiet hour.
        val e = Alarmabholung.fetch("2026-09-19T17:30:00.000Z") { antwort() }
        assert(e is Alarmabholung.Ergebnis.Geholt) { "$e statt Geholt" }
        e as Alarmabholung.Ergebnis.Geholt
        assert(e.meldungen.isEmpty())
        assert(e.neueMarke == "2026-09-19T18:00:00.000Z")
    }

    @Test
    fun `without a usable response the mark stays as it was`() = runTest {
        val kaputt = listOf<Pair<String, Ergebnis<AlarmabrufView>>>(
            "Netz weg" to Ergebnis.Fehler.Netz("offline"),
            "Server sagt nein" to Ergebnis.Fehler.Absage(),
            // An older server version doesn't know the field. Then rather no
            // marker at all than a wrong one — it stays with mail dispatch.
            "kein Zeitpunkt" to Ergebnis.Erfolg(AlarmabrufView(emptyList(), marke = null)),
            "leerer Zeitpunkt" to Ergebnis.Erfolg(AlarmabrufView(emptyList(), marke = "")),
        )
        for ((warum, r) in kaputt) {
            val e = Alarmabholung.fetch("2026-09-19T17:30:00.000Z") { r }
            assert(e is Alarmabholung.Ergebnis.Fehlgeschlagen) {
                "$warum: $e statt Fehlgeschlagen — die Meldung waere verloren"
            }
        }
    }

    @Test
    fun `the text names set, price and threshold — in the alert's currency`() {
        // Not in the current account currency: the threshold was set in
        // that currency, and 200 CHF is not 200 EUR.
        assert(Alarmabholung.text(alarm(), "faellt unter", "steigt ueber", DE_CH) ==
            "10179-1: EUR\u00a0100.00 (faellt unter EUR\u00a0200.00)")
        assert(Alarmabholung.text(alarm(richtung = Alarmrichtung.UEBER, schwelle = 300.0, preis = 350.5),
                                  "faellt unter", "steigt ueber", DE_CH) ==
            "10179-1: EUR\u00a0350.50 (steigt ueber EUR\u00a0300.00)")
        // Without a known price, the statement stays the threshold — a
        // made-up price would be worse than none.
        assert(Alarmabholung.text(alarm(preis = null), "faellt unter", "steigt ueber", DE_CH) ==
            "10179-1: faellt unter EUR\u00a0200.00")
    }

    /**
     * Counter-check: gegenproben/alarm-betrag-fest-us.patch (`Locale.US` again) → red
     * „the amounts are in the number format of the app language“.
     */
    @Test
    fun `the amounts are in the number format of the app language`() {
        val text = Alarmabholung.text(alarm(schwelle = 1200.0, preis = 999.5), "faellt unter", "steigt ueber",
            Locale.forLanguageTag("de-DE"))
        assert(text == "10179-1: 999,50\u00a0€ (faellt unter 1.200,00\u00a0€)") { text }
    }

    private companion object {
        val DE_CH: Locale = Locale.forLanguageTag("de-CH")
    }
}
