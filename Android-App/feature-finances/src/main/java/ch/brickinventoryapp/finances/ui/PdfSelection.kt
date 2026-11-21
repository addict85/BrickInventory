package ch.brickinventoryapp.finances.ui

import java.util.UUID

/**
 * Address and title of open PDFs, in the process rather than in the route: the route ends up in
 * the activity's saved state, a voucher address carries a ticket and its
 * title the voucher number. After a process death the item is gone, the
 * viewer then goes back; an old ticket would no longer be valid anyway.
 */
internal object PdfSelection {
    data class Pdf(val url: String, val titel: String)

    private const val AT_MOST = 8
    private val offen = object : LinkedHashMap<String, Pdf>() {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Pdf>?) = size > AT_MOST
    }

    /** Stores the PDF and returns the key for the route. */
    fun put(url: String, titel: String): String = synchronized(offen) {
        UUID.randomUUID().toString().also { offen[it] = Pdf(url, titel) }
    }

    fun fetch(schluessel: String): Pdf? = synchronized(offen) { offen[schluessel] }
}
