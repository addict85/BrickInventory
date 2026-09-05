package ch.brickinventoryapp.util

/**
 * Die BrickLink-Wunschliste („Wanted List") als XML — reine JVM-Logik.
 *
 * ── Woher das kommt ─────────────────────────────────────────────────────────
 *
 * Die Webapp kann in der temporären Teileliste je Teil eintragen, wie viele
 * davon man SCHON HAT, und exportiert daraus die Differenz als XML, das
 * BrickLink direkt als Wunschliste einliest (08-init.js, plExportBricklink).
 * Die App hatte die Teileliste samt PDF-Export, aber weder das Feld
 * „vorhanden" noch diesen Export — wer unterwegs ein Set durchgeht, konnte die
 * fehlenden Teile nicht bestellen, ohne sich an den Rechner zu setzen.
 *
 * ── Warum die Logik hier steht und nicht im Bildschirm ──────────────────────
 *
 * Sie ist ohne Android prüfbar: rein aus Zahlen und Zeichenketten. Im
 * Bildschirm läge sie hinter einem Compose-Baum, den die Tests hier nicht
 * ausführen können (kein Android-SDK, siehe Quellen.kt). Dasselbe Muster wie
 * BrickLinkUrls.kt nebenan.
 */
object BrickLinkWunschliste {

    /**
     * Ein fehlender Posten.
     *
     * @param typ    BrickLink-Artikelart: "P" für ein Teil, "M" für eine Minifigur.
     * @param teil   Die BrickLink-Nummer.
     * @param farbe  BrickLink-Farbnummer. Bei "M" bedeutungslos und wird
     *               weggelassen — BrickLink kennt für eine ganze Minifigur
     *               keine Farbe.
     * @param menge  Wie viele fehlen (immer > 0; siehe [ausBestand]).
     */
    data class Posten(val typ: String, val teil: String, val farbe: Int?, val menge: Int)

    /** Die drei Zustände, die BrickLink im Feld CONDITION kennt. */
    const val ZUSTAND_EGAL = "X"
    const val ZUSTAND_NEU = "N"
    const val ZUSTAND_GEBRAUCHT = "U"

    /**
     * Was fehlt: gebraucht minus vorhanden, alles mit Rest > 0.
     *
     * Fehlt ein Eintrag in [vorhanden], gilt 0 — genau wie die Webapp, deren
     * Eingabefelder mit 0 vorbelegt sind.
     */
    fun ausBestand(
        gebraucht: List<Posten>,
        vorhanden: Map<String, Int>,
        schluessel: (Posten) -> String,
    ): List<Posten> = gebraucht.mapNotNull { p ->
        val rest = p.menge - (vorhanden[schluessel(p)] ?: 0)
        if (rest > 0) p.copy(menge = rest) else null
    }

    /**
     * Gleiche Posten zusammenfassen.
     *
     * Nötig, weil eine Minifigur vor dem Export in ihre Teile aufgelöst wird:
     * Zwei verschiedene Figuren aus zwei verschiedenen Sets enthalten oft
     * dasselbe Teil in derselben Farbe. Ohne das Zusammenfassen stünde es
     * mehrfach in der Liste, und BrickLink zählt beim Einlesen nicht zusammen,
     * sondern legt zwei Einträge an.
     *
     * Die Reihenfolge des ERSTEN Auftretens bleibt erhalten (LinkedHashMap),
     * damit die Ausgabe bei gleicher Eingabe gleich bleibt — ein Export, der
     * sich bei jedem Aufruf umsortiert, ist nicht vergleichbar.
     */
    fun zusammenfassen(posten: List<Posten>): List<Posten> {
        val nach = LinkedHashMap<String, Posten>()
        for (p in posten) {
            val k = "${p.typ}|${p.teil}|${p.farbe ?: 0}"
            val vorher = nach[k]
            nach[k] = if (vorher == null) p else vorher.copy(menge = vorher.menge + p.menge)
        }
        return nach.values.toList()
    }

    /**
     * Das XML, wie BrickLink es beim Hochladen einer Wunschliste erwartet.
     *
     * Aufbau und Reihenfolge der Felder sind aus der Webapp übernommen, damit
     * beide Ausgaben dieselbe Datei ergeben.
     *
     * COLOR steht NICHT bei einer ganzen Minifigur ("M"): BrickLink führt
     * Minifiguren farblos, und ein Farbfeld dort lässt den Import scheitern.
     *
     * Anders als die Webapp werden Sonderzeichen maskiert. BrickLink-Nummern
     * enthalten praktisch nie welche, die Ausgabe ist also im Regelfall
     * dieselbe — aber ein einziges `&` in einer Nummer erzeugte sonst eine
     * Datei, die kein XML-Leser annimmt, und der Fehler wäre erst bei
     * BrickLink sichtbar.
     */
    fun xml(posten: List<Posten>, zustand: String): String = buildString {
        append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<INVENTORY>\n")
        for (p in posten) {
            append("  <ITEM>\n")
            append("    <ITEMTYPE>").append(maskiert(p.typ)).append("</ITEMTYPE>\n")
            append("    <ITEMID>").append(maskiert(p.teil)).append("</ITEMID>\n")
            if (p.typ != "M" && p.farbe != null) {
                append("    <COLOR>").append(p.farbe).append("</COLOR>\n")
            }
            append("    <MINQTY>").append(p.menge).append("</MINQTY>\n")
            append("    <CONDITION>").append(maskiert(zustand)).append("</CONDITION>\n")
            append("  </ITEM>\n")
        }
        append("</INVENTORY>")
    }

    private fun maskiert(s: String): String = s
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
}
