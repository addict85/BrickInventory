package ch.brickinventoryapp.model.domain

/**
 * What the parts list has printed as PDF: the sets for the header and the rows.
 * A domain value, so that area and service do not know the request to the server.
 */
data class PartListJob(val sets: List<Set>, val rows: List<Row>) {
    data class Set(val number: String, val name: String?)

    /** [image] is server-relative where possible; [blNumber] stands in the PDF, [number] is the Rebrickable number. */
    data class Row(
        val number: String,
        val blNumber: String,
        val name: String?,
        val colorName: String?,
        val colorHex: String,
        val colorId: Int?,
        val quantity: Int,
        val figure: Boolean,
        val image: String,
        val imageLocal: String,
    )
}

/** A state of the PDF job at the server; [restSeconds] is its estimate, [error] its sentence. */
data class PdfJobStatus(val status: RunStatus, val error: String? = null, val restSeconds: Double? = null)
