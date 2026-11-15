package ch.brickinventoryapp.model.fach

/**
 * Was die Teileliste als PDF drucken lässt: die Sets für den Kopf und die Zeilen.
 * Ein Fachwert, damit Bereich und Dienst die Anfrage an den Server nicht kennen.
 */
data class Teilelistenauftrag(val sets: List<Set>, val zeilen: List<Zeile>) {
    data class Set(val nummer: String, val name: String?)

    /** [bild] ist serverrelativ, wo es geht; [blNummer] steht im PDF, [nummer] ist die Rebrickable-Nummer. */
    data class Zeile(
        val nummer: String,
        val blNummer: String,
        val name: String?,
        val farbname: String?,
        val farbHex: String,
        val farbId: Int?,
        val menge: Int,
        val figur: Boolean,
        val bild: String,
        val bildLokal: String,
    )
}

/** Ein Stand des PDF-Auftrags am Server; [restSekunden] ist seine Schätzung, [fehler] sein Satz. */
data class PdfAuftragsstand(val status: Laufstatus, val fehler: String? = null, val restSekunden: Double? = null)
