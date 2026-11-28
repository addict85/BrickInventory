package ch.brickinventoryapp.dataapi.catalog

import java.net.URLEncoder

/**
 * URL building for external BrickLink links — pure JVM logic (no android.net.Uri),
 * so that it is checkable in JUnit unit tests.
 * The catalog link is meanwhile resolved by the server (`bricklink.url`), because only it knows whether a
 * number is a set, gear or book; setForSale() is the fallback for older servers.
 */
object BrickLinkUrls {

    /** Query-Parameter je BrickLink-Item-Typ. */
    private fun paramFor(type: String): String = when (type.uppercase()) {
        "GEAR"    -> "G"
        "BOOK"    -> "B"
        "MINIFIG" -> "M"
        else      -> "S"
    }

    /** Catalog page of an item with the "For Sale" tab opened (buy). */
    fun forSale(number: String, type: String = "SET"): String {
        val p = paramFor(type)
        val encoded = URLEncoder.encode(number, "UTF-8")
        return "https://www.bricklink.com/v2/catalog/catalogitem.page?$p=$encoded#T=$p&O={%22iconly%22:0}"
    }

    /**
     * Fallback for servers without a resolved bricklink field: assumes that the
     * Rebrickable number is also a set with the same number on BrickLink.
     * That is true for the great majority, but not for gear and books.
     */
    fun setForSale(setNumber: String): String = forSale(setNumber, "SET")

    /**
     * Fallback level when the item cannot be determined unambiguously —
     * especially for collectible minifigures, which BrickLink lists under a completely
     * different number (Rebrickable 71021-1 → BrickLink col325). This
     * mapping exists in neither of the two data sources; the search is
     * the best that can be offered.
     */
    fun searchFor(number: String): String {
        val bare = number.replace(Regex("-\\d+$"), "")
        return "https://www.bricklink.com/v2/search.page?q=" + URLEncoder.encode(bare, "UTF-8")
    }
}
