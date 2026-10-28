package ch.brickinventoryapp.util

/**
 * Was mit einer zwischengespeicherten Anleitung als Nächstes zu tun ist.
 *
 * Der Zustand hängt am Dateinamen, nicht an einer Grösse: Eine Zahl allein sagt
 * nicht, ob sie eine fertige Datei oder einen abgebrochenen Download beschreibt.
 * Nach einem vollständigen Download fragte `Range: bytes=<vorhanden>-` hinter dem
 * letzten Byte, und der Server antwortet zu Recht mit 416 (über die
 * Anleitungs-Route als 404, siehe Web-App/utils/dateiAusliefern.ts). Der laufende
 * Download schreibt deshalb in `<name>.part` und wird erst beim Abschluss
 * umbenannt; `<name>` existiert = vollständig. `rename` ist der eine Schritt, der
 * nicht halb passieren kann.
 *
 * So öffnet eine schon angesehene Anleitung ohne Netzanfrage, wie prunePdfCache es
 * verspricht.
 */
sealed class PdfSchritt {
    /** Die Datei liegt vollstaendig vor. Nichts holen. */
    object Fertig : PdfSchritt()

    /**
     * Ab diesem Byte holen. `ab == 0` heisst „von vorn, ohne Range-Kopfzeile" —
     * ein `Range: bytes=0-` waere zwar gueltig, aber es fragt nach einem
     * Teilstueck und bekaeme 206 statt 200. Fuer den ersten Versuch ist die
     * schlichte Anfrage die richtige.
     */
    data class Holen(val ab: Long) : PdfSchritt()
}

/**
 * @param fertigeGroesse Groesse der fertigen Datei, 0 wenn es sie nicht gibt.
 * @param teilGroesse    Groesse der Teildatei, 0 wenn es sie nicht gibt.
 */
fun pdfSchritt(fertigeGroesse: Long, teilGroesse: Long): PdfSchritt = when {
    // Die fertige Datei schlaegt alles. Liegt daneben noch eine Teildatei,
    // ist sie ein Ueberbleibsel und wird beim naechsten Aufraeumen entsorgt.
    fertigeGroesse > 0L -> PdfSchritt.Fertig
    teilGroesse > 0L    -> PdfSchritt.Holen(teilGroesse)
    else                -> PdfSchritt.Holen(0L)
}
