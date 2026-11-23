package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.alarm.AlarmInput
import ch.brickinventoryapp.model.domain.Money
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
 * intermediate states like „249.“ also run through this function.
 */
class AlarmInputTest {

    @Test
    fun `a valid threshold comes through as an amount`() {
        assert(AlarmInput.number("200") == Money(2_000_000))
        assert(AlarmInput.number("249.90") == Money(2_499_000))
        assert(AlarmInput.number(" 249.90 ") == Money(2_499_000)) { "Spaces should not matter" }
    }

    @Test
    fun `the comma of the German keyboard counts as a point`() {
        // Without this line „249,90“ would be no number, thus a delete — the
        // alert would disappear while typing.
        assert(AlarmInput.number("249,90") == Money(2_499_000)) {
            "249,90 ergab ${AlarmInput.number("249,90")}"
        }
    }

    @Test
    fun `empty and half typed mean delete`() {
        // Empty is the natural gesture to get rid of an alert. A half
        // beginning is no number and thus the same.
        for (raw in listOf("", "   ", "-", "abc", ",")) {
            assert(AlarmInput.number(raw) == null) {
                "\"$raw\" gave ${AlarmInput.number(raw)} instead of null"
            }
        }
    }

    @Test
    fun `a point at the end is a number, not a delete`() {
        // ── What I first claimed wrongly ─────────────────────────────────
        //
        // „249.“ is not a delete:
        // Double.parseDouble("249.") is 249.0 — Java accepts the point at the
        // end. The web app likewise (parseFloat("249.") is 249).
        //
        // This check now stands here so that the right answer
        // is recorded and nobody (me) assumes the plausible one
        // again.
        assert(AlarmInput.number("249.") == Money(2_490_000)) {
            "249. ergab ${AlarmInput.number("249.")}"
        }
    }

    @Test
    fun `zero and negative are no alert`() {
        // A threshold of 0 is no threshold but an alert that never
        // or always reports. The server rejects it as well
        // (pruefeEingabe in `utils/preisalarm.ts`).
        for (raw in listOf("0", "0.00", "-5", "-0.01")) {
            assert(AlarmInput.number(raw) == null) {
                "\"$raw\" gave ${AlarmInput.number(raw)} instead of null"
            }
        }
    }

    @Test
    fun `the quiet period is long enough for an intermediate state`() {
        // The intermediate state that matters is not „249.“ (that is
        // a valid number, see above), but „2“ and „24“: whoever wants to type
        // „249“ passes by there. Without a quiet period a threshold at 2 would remain
        // in the end — and it reports immediately, because almost every set
        // lies above it.
        //
        // 350 ms is the search's quiet period; a search only SHOWS, an alert
        // CREATES SOMETHING and therefore gets more.
        assert(AlarmInput.QUIET_MS >= 500L) {
            "QUIET_MS is at ${AlarmInput.QUIET_MS} ms — too short to outlast a " +
                "typing motion from \"2\" via \"24\" to \"249\"."
        }
    }
}
