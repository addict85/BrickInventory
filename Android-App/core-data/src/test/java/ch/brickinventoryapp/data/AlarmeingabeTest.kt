package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.alarm.Alarmeingabe
import ch.brickinventoryapp.model.domain.Geld
import org.junit.Test

/**
 * What becomes of what is typed into the threshold field.
 *
 * ── Why this is worth its own check ─────────────────────────────────────────
 *
 * This conversion carries the most expensive decision of the price alert: `null`
 * means DELETE. Every text that accidentally becomes `null` here
 * deletes an alert someone is just typing — and silently, because
 * a delete is not an error.
 *
 * Saving happens while TYPING, not when leaving the field; that is why
 * intermediate states like „249." also run through this function.
 */
class AlarmeingabeTest {

    @Test
    fun `a valid threshold comes through as an amount`() {
        assert(Alarmeingabe.zahl("200") == Geld(2_000_000))
        assert(Alarmeingabe.zahl("249.90") == Geld(2_499_000))
        assert(Alarmeingabe.zahl(" 249.90 ") == Geld(2_499_000)) { "Leerzeichen sollten egal sein" }
    }

    @Test
    fun `the comma of the German keyboard counts as a point`() {
        // Without this line „249,90" would be no number, thus a delete — the
        // alert would disappear while typing.
        assert(Alarmeingabe.zahl("249,90") == Geld(2_499_000)) {
            "249,90 ergab ${Alarmeingabe.zahl("249,90")}"
        }
    }

    @Test
    fun `empty and half typed mean delete`() {
        // Empty is the natural gesture to get rid of an alert. A half
        // beginning is no number and thus the same.
        for (roh in listOf("", "   ", "-", "abc", ",")) {
            assert(Alarmeingabe.zahl(roh) == null) {
                "\"$roh\" ergab ${Alarmeingabe.zahl(roh)} statt null"
            }
        }
    }

    @Test
    fun `a point at the end is a number, not a delete`() {
        // ── What I first claimed wrongly ─────────────────────────────────
        //
        // „249." is not a delete:
        // Double.parseDouble("249.") is 249.0 — Java accepts the point at the
        // end. The web app likewise (parseFloat("249.") is 249).
        //
        // This check now stands here so that the right answer
        // is recorded and nobody (me) assumes the plausible one
        // again.
        assert(Alarmeingabe.zahl("249.") == Geld(2_490_000)) {
            "249. ergab ${Alarmeingabe.zahl("249.")}"
        }
    }

    @Test
    fun `zero and negative are no alert`() {
        // A threshold of 0 is no threshold but an alert that never
        // or always reports. The server rejects it as well
        // (pruefeEingabe in utils/preisalarm.ts).
        for (roh in listOf("0", "0.00", "-5", "-0.01")) {
            assert(Alarmeingabe.zahl(roh) == null) {
                "\"$roh\" ergab ${Alarmeingabe.zahl(roh)} statt null"
            }
        }
    }

    @Test
    fun `the quiet period is long enough for an intermediate state`() {
        // The intermediate state that matters is not „249." (that is
        // a valid number, see above), but „2" and „24": whoever wants to type
        // „249" passes by there. Without a quiet period a threshold at 2 would remain
        // in the end — and it reports immediately, because almost every set
        // lies above it.
        //
        // 350 ms is the search's quiet period; a search only SHOWS, an alert
        // CREATES SOMETHING and therefore gets more.
        assert(Alarmeingabe.RUHE_MS >= 500L) {
            "RUHE_MS steht auf ${Alarmeingabe.RUHE_MS} ms — zu kurz, um eine " +
                "Tippbewegung von \"2\" ueber \"24\" nach \"249\" zu ueberdauern."
        }
    }
}
