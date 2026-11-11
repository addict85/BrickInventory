package ch.brickinventoryapp.finanzen.ui.pdf

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.io.InputStream
import java.io.OutputStream

/** Schreibt eine geladene PDF an ein Ziel, abseits des Hauptfadens (PdfBetrachterViewModel). */
fun interface PdfSchreiber {
    suspend fun schreibe(quelle: PdfQuelle, ziel: OutputStream)
}

/**
 * Kopiert in Stücken und prüft vor jedem, ob der Auftrag noch gilt. Eine Anleitung
 * hat bis zu 300 MB; bricht der Druckdialog ab, soll nicht der Rest noch kopiert werden.
 */
internal suspend fun kopiereAbbrechbar(ein: InputStream, aus: OutputStream, stueck: Int = 64 * 1024): Long {
    val puffer = ByteArray(stueck)
    var gesamt = 0L
    while (true) {
        currentCoroutineContext().ensureActive()
        val n = ein.read(puffer)
        if (n < 0) return gesamt
        aus.write(puffer, 0, n)
        gesamt += n
    }
}
