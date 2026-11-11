package ch.brickinventoryapp.data.util

import java.net.URLEncoder

/**
 * URL-Bau für externe BrickLink-Links — pure JVM-Logik (kein android.net.Uri),
 * damit sie in JUnit-Unit-Tests prüfbar ist.
 * Den Katalog-Link löst inzwischen der Server auf (`bricklink.url`), weil nur er weiss, ob eine
 * Nummer ein Set, Gear oder Buch ist; setForSale() ist der Rückfall für ältere Server.
 */
object BrickLinkUrls {

    /** Query-Parameter je BrickLink-Item-Typ. */
    private fun paramFor(type: String): String = when (type.uppercase()) {
        "GEAR"    -> "G"
        "BOOK"    -> "B"
        "MINIFIG" -> "M"
        else      -> "S"
    }

    /** Katalogseite eines Artikels mit geöffnetem "For Sale"-Tab (Kaufen). */
    fun forSale(number: String, type: String = "SET"): String {
        val p = paramFor(type)
        val encoded = URLEncoder.encode(number, "UTF-8")
        return "https://www.bricklink.com/v2/catalog/catalogitem.page?$p=$encoded#T=$p&O={%22iconly%22:0}"
    }

    /**
     * Fallback für Server ohne aufgelöstes bricklink-Feld: nimmt an, dass die
     * Rebrickable-Nummer auch auf BrickLink ein Set mit gleicher Nummer ist.
     * Das stimmt für die grosse Mehrheit, aber eben nicht für Gear und Bücher.
     */
    fun setForSale(setNumber: String): String = forSale(setNumber, "SET")

    /**
     * Rückfallebene, wenn der Artikel nicht eindeutig bestimmbar ist —
     * insbesondere bei Sammelminifiguren, die BrickLink unter einer völlig
     * anderen Nummer führt (Rebrickable 71021-1 → BrickLink col325). Diese
     * Zuordnung existiert in keiner der beiden Datenquellen; die Suche ist
     * das Beste, was sich anbieten lässt.
     */
    fun searchFor(number: String): String {
        val bare = number.replace(Regex("-\\d+$"), "")
        return "https://www.bricklink.com/v2/search.page?q=" + URLEncoder.encode(bare, "UTF-8")
    }
}
