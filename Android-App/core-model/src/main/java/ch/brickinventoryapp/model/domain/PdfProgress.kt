package ch.brickinventoryapp.model.domain

/** What a running PDF export is doing right now. */

enum class PdfStep { STARTET, IMAGES_LOAD, CREATED, COMPLETION, DOWNLOAD }

/**
 * The state of a running PDF export as a domain value; the sentence for it is formed by the
 * UI in its language. [restSeconds] exists only while creating, from the
 * server's estimate; at most 0 means „almost done“.
 */
data class PdfProgress(val schritt: PdfStep, val restSeconds: Int? = null)
