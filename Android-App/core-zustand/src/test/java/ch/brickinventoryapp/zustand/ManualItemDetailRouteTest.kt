package ch.brickinventoryapp.zustand

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Die Detailansicht manueller Teile und Minifiguren ist ein eigener Screen, kein
 * Dialog mehr. Hin- und Rückweg der Route prüft RoutenRundwegTest (app).
 */
class ManualItemDetailRouteTest {

    @Test
    fun `der alte Dialog ist entfernt, nicht nur ungenutzt`() {
        // Toter Code, den niemand mehr aufruft, wandert beim nächsten Umbau
        // erfahrungsgemäss versehentlich zurück in Gebrauch.
        val src = File(Quellen.wurzel, "gemeinsam/ui/ManualItemComposables.kt").takeIf { it.exists() }
        assertTrue("ManualItemComposables.kt nicht gefunden", src != null)
        assertTrue("ManualItemDetailDialog gehört entfernt",
            !src!!.readText().contains("fun ManualItemDetailDialog"))
    }
}
