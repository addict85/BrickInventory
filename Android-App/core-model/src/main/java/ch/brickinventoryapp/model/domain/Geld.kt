package ch.brickinventoryapp.model.domain

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Ein Betrag in Zehntausendsteln, wie der Server ihn hält (NUMERIC(12,4), Web-App/src/infra/geld.ts):
 * ganzzahlig, damit Summen und Vergleiche nicht an Binärbrüchen hängen. Die Währung steht an Konto
 * oder Antwort, nicht an jedem Betrag; ein Feld daneben trägt sie, wo der Server sie nennt.
 */
@JvmInline
value class Geld(val tenThousandths: Long) : Comparable<Geld> {
    operator fun plus(anderes: Geld) = Geld(tenThousandths + anderes.tenThousandths)
    operator fun minus(anderes: Geld) = Geld(tenThousandths - anderes.tenThousandths)
    operator fun times(menge: Int) = Geld(tenThousandths * menge)

    val positive: Boolean get() = tenThousandths > 0

    override fun compareTo(other: Geld) = tenThousandths.compareTo(other.tenThousandths)

    fun asBigDecimal(): BigDecimal = BigDecimal.valueOf(tenThousandths, PLACES)

    /** Auf Rappen, halbe von der Null weg wie onRappen() des Servers. */
    fun onRappen(): BigDecimal = asBigDecimal().setScale(2, RoundingMode.HALF_UP)

    /** Für das Wire-Format und für Diagrammhöhen; gerechnet wird mit [tenThousandths]. */
    fun asDouble(): Double = tenThousandths / FACTOR.toDouble()

    override fun toString(): String = asBigDecimal().toPlainString()

    companion object {
        private const val PLACES = 4
        private const val FACTOR = 10_000L
        val NULL = Geld(0)

        /** Wie inZehntel4() des Servers; was keine endliche Zahl ist, ist kein Betrag. */
        fun aus(betrag: Double): Geld? = if (betrag.isFinite()) Geld(Math.round(betrag * FACTOR)) else null

        fun aus(betrag: BigDecimal): Geld = Geld(betrag.setScale(PLACES, RoundingMode.HALF_UP).unscaledValue().toLong())

        /** Ein Betrag als Text des Servers („12.50“); unlesbar heisst kein Betrag. */
        fun fromText(text: String?): Geld? = text?.trim()?.toBigDecimalOrNull()?.let { aus(it) }
    }
}

fun Double?.asMoney(): Geld? = this?.let { Geld.aus(it) }

/** Für Pflichtfelder: Was keine endliche Zahl ist, zählt als null, statt die ganze Antwort zu verwerfen. */
fun Double.asMoneyRequired(): Geld = Geld.aus(this) ?: Geld.NULL
