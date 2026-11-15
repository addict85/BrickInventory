package ch.brickinventoryapp.model.fach

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Ein Betrag in Zehntausendsteln, wie der Server ihn hält (NUMERIC(12,4), Web-App/src/infra/geld.ts):
 * ganzzahlig, damit Summen und Vergleiche nicht an Binärbrüchen hängen. Die Währung steht an Konto
 * oder Antwort, nicht an jedem Betrag; ein Feld daneben trägt sie, wo der Server sie nennt.
 */
@JvmInline
value class Geld(val zehntausendstel: Long) : Comparable<Geld> {
    operator fun plus(anderes: Geld) = Geld(zehntausendstel + anderes.zehntausendstel)
    operator fun minus(anderes: Geld) = Geld(zehntausendstel - anderes.zehntausendstel)
    operator fun times(menge: Int) = Geld(zehntausendstel * menge)

    val positiv: Boolean get() = zehntausendstel > 0

    override fun compareTo(other: Geld) = zehntausendstel.compareTo(other.zehntausendstel)

    fun alsBigDecimal(): BigDecimal = BigDecimal.valueOf(zehntausendstel, STELLEN)

    /** Auf Rappen, halbe von der Null weg wie aufRappen() des Servers. */
    fun aufRappen(): BigDecimal = alsBigDecimal().setScale(2, RoundingMode.HALF_UP)

    /** Für das Wire-Format und für Diagrammhöhen; gerechnet wird mit [zehntausendstel]. */
    fun alsDouble(): Double = zehntausendstel / FAKTOR.toDouble()

    override fun toString(): String = alsBigDecimal().toPlainString()

    companion object {
        private const val STELLEN = 4
        private const val FAKTOR = 10_000L
        val NULL = Geld(0)

        /** Wie inZehntel4() des Servers; was keine endliche Zahl ist, ist kein Betrag. */
        fun aus(betrag: Double): Geld? = if (betrag.isFinite()) Geld(Math.round(betrag * FAKTOR)) else null

        fun aus(betrag: BigDecimal): Geld = Geld(betrag.setScale(STELLEN, RoundingMode.HALF_UP).unscaledValue().toLong())

        /** Ein Betrag als Text des Servers („12.50“); unlesbar heisst kein Betrag. */
        fun ausText(text: String?): Geld? = text?.trim()?.toBigDecimalOrNull()?.let { aus(it) }
    }
}

fun Double?.alsGeld(): Geld? = this?.let { Geld.aus(it) }

/** Für Pflichtfelder: Was keine endliche Zahl ist, zählt als null, statt die ganze Antwort zu verwerfen. */
fun Double.alsGeldPflicht(): Geld = Geld.aus(this) ?: Geld.NULL
