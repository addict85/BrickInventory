package ch.brickinventoryapp.finanzen.ui

import java.util.UUID

/**
 * Adresse und Titel offener PDFs, im Prozess statt in der Route: Die Route landet im
 * gespeicherten Zustand der Activity, eine Gutschein-Adresse trägt ein Ticket und ihr
 * Titel die Gutscheinnummer. Nach einem Prozess-Tod ist der Eintrag weg, der
 * Betrachter geht dann zurück; ein altes Ticket gälte ohnehin nicht mehr.
 */
internal object PdfAuswahl {
    data class Pdf(val url: String, val titel: String)

    private const val HOECHSTENS = 8
    private val offen = object : LinkedHashMap<String, Pdf>() {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Pdf>?) = size > HOECHSTENS
    }

    /** Legt das PDF ab und gibt den Schlüssel für die Route zurück. */
    fun lege(url: String, titel: String): String = synchronized(offen) {
        UUID.randomUUID().toString().also { offen[it] = Pdf(url, titel) }
    }

    fun hole(schluessel: String): Pdf? = synchronized(offen) { offen[schluessel] }
}
