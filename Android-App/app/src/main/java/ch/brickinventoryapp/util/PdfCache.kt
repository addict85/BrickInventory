package ch.brickinventoryapp.util

/**
 * Was mit einer zwischengespeicherten Anleitung als Naechstes zu tun ist.
 *
 * ── Der Befund, aus dem diese Datei kam ─────────────────────────────────────
 *
 * Marcos Meldung: „Nach ein paar Mal die Anleitung abrufen aus der App
 * erscheint folgende Meldung" — „Fehler beim Laden: HTTP 404".
 *
 * Der PDF-Viewer laedt fortsetzbar. Lag im Cache schon etwas, schickte er
 * `Range: bytes=<vorhanden>-`. Nach einem VOLLSTAENDIGEN Download ist
 * `vorhanden` aber genau die Dateigroesse — der Bereich beginnt hinter dem
 * letzten Byte, und der Server antwortet zu Recht mit 416 (auf dem Weg durch
 * die Anleitungs-Route wurde daraus eine 404, siehe
 * Web-App/utils/dateiAusliefern.ts).
 *
 * Dass es „nach ein paar Mal" auftrat und nicht beim zweiten Oeffnen, liegt am
 * Cache-Budget: prunePdfCache raeumt die aelteste Anleitung weg, sobald 500 MB
 * ueberschritten sind. Wer zwischendurch genug andere Anleitungen ansah, fand
 * seine eigene geloescht vor und lud sie neu — bis sie einmal liegen blieb.
 *
 * ── Warum der Zustand jetzt am DATEINAMEN haengt ────────────────────────────
 *
 * Eine Zahl allein sagt nicht, ob sie eine fertige Datei oder einen
 * abgebrochenen Download beschreibt. Der laufende Download schreibt deshalb in
 * `<name>.part` und wird erst beim Abschluss auf `<name>` umbenannt. Damit
 * gilt: `<name>` existiert = vollstaendig. Das ist keine Vermutung ueber
 * Groessen, sondern eine Tatsache ueber den Ablauf — und `rename` ist auf
 * einem Dateisystem der eine Schritt, der nicht halb passieren kann.
 *
 * Nebenwirkung, die der frueheren ABSICHT entspricht: Eine schon angesehene
 * Anleitung oeffnet jetzt ohne jede Netzanfrage. Der Kommentar an
 * prunePdfCache versprach das seit jeher („erneutes Oeffnen ohne
 * Neudownload") — nur tat der Code es nie.
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
