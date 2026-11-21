package ch.brickinventoryapp.model.domain

/**
 * What the parts list has printed as PDF: the sets for the header and the rows.
 * A domain value, so that area and service do not know the request to the server.
 */
data class Teilelistenauftrag(val sets: List<Set>, val zeilen: List<Zeile>) {
    data class Set(val nummer: String, val name: String?)

    /** [bild] is server-relative where possible; [blNumber] stands in the PDF, [nummer] is the Rebrickable number. */
    data class Zeile(
        val nummer: String,
        val blNumber: String,
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

/** A state of the PDF job at the server; [restSeconds] is its estimate, [fehler] its sentence. */
data class PdfJobStatus(val status: Laufstatus, val fehler: String? = null, val restSeconds: Double? = null)
