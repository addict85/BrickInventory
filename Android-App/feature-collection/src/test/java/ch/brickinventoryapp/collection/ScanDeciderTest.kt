package ch.brickinventoryapp.collection

import ch.brickinventoryapp.collection.ui.screens.ScanDecider
import ch.brickinventoryapp.collection.ui.screens.ScanDecider.Step
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The scanner's per-frame decisions: text recognition is throttled, the barcode reader is not,
 * and a value counts only after two reads in a row.
 *
 * Counter-checks:
 *   time check in ScanDecider.onBarcode removed → red “text recognition runs at most every 700 ms”
 *   onBarcode consults the clock before the barcode value → red “a barcode counts even right after
 *   text recognition”
 *   CONFIRM_NEEDED = 1 → red “a value counts only after two reads in a row” and “a barcode counts …”
 *   ocrEnabled ignored → red “without text recognition a frame without a barcode only aims”
 */
class ScanDeciderTest {

    private var time = 10_000L
    private val decider = ScanDecider(ocrEnabled = true) { time }

    @Test
    fun `text recognition runs at most every 700 ms`() {
        assertEquals(Step.ReadText, decider.onBarcode(null))
        time += 100
        assertEquals(Step.Status(confirming = false), decider.onBarcode(null))
        time += ScanDecider.OCR_INTERVAL_MS
        assertEquals(Step.ReadText, decider.onBarcode(null))
    }

    @Test
    fun `a barcode counts even right after text recognition`() {
        assertEquals(Step.ReadText, decider.onBarcode(null))
        time += 10
        assertEquals(Step.Status(confirming = true), decider.onBarcode("5702017152455"))
        time += 10
        assertEquals(Step.Found("5702017152455"), decider.onBarcode("5702017152455"))
    }

    @Test
    fun `a value counts only after two reads in a row`() {
        assertEquals(Step.Status(confirming = true), decider.onText("75192-1"))
        assertEquals(Step.Status(confirming = true), decider.onText("75193-1"))
        assertEquals(Step.Found("75193-1"), decider.onText("75193-1"))
        assertEquals(Step.Status(confirming = false), decider.onText(null))
    }

    @Test
    fun `without text recognition a frame without a barcode only aims`() {
        val withoutOcr = ScanDecider(ocrEnabled = false) { time }
        assertEquals(Step.Status(confirming = false), withoutOcr.onBarcode(null))
        time += ScanDecider.OCR_INTERVAL_MS
        assertEquals(Step.Status(confirming = false), withoutOcr.onBarcode(null))
    }
}
