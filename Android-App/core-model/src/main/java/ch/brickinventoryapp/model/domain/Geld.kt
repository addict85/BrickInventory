package ch.brickinventoryapp.model.domain

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * An amount in ten-thousandths, as the server holds it (NUMERIC(12,4), Web-App/src/infra/geld.ts):
 * integral, so that totals and comparisons do not hang on binary fractions. The currency stands on account
 * or response, not on every amount; a field next to it carries it where the server names it.
 */
@JvmInline
value class Geld(val tenThousandths: Long) : Comparable<Geld> {
    operator fun plus(anderes: Geld) = Geld(tenThousandths + anderes.tenThousandths)
    operator fun minus(anderes: Geld) = Geld(tenThousandths - anderes.tenThousandths)
    operator fun times(menge: Int) = Geld(tenThousandths * menge)

    val positive: Boolean get() = tenThousandths > 0

    override fun compareTo(other: Geld) = tenThousandths.compareTo(other.tenThousandths)

    fun asBigDecimal(): BigDecimal = BigDecimal.valueOf(tenThousandths, PLACES)

    /** To centimes, halves away from zero like the server's aufRappen(). */
    fun onRappen(): BigDecimal = asBigDecimal().setScale(2, RoundingMode.HALF_UP)

    /** For the wire format and for chart heights; calculation uses [tenThousandths]. */
    fun asDouble(): Double = tenThousandths / FACTOR.toDouble()

    override fun toString(): String = asBigDecimal().toPlainString()

    companion object {
        private const val PLACES = 4
        private const val FACTOR = 10_000L
        val NULL = Geld(0)

        /** Like the server's inZehntel4(); what is not a finite number is not an amount. */
        fun aus(betrag: Double): Geld? = if (betrag.isFinite()) Geld(Math.round(betrag * FACTOR)) else null

        fun aus(betrag: BigDecimal): Geld = Geld(betrag.setScale(PLACES, RoundingMode.HALF_UP).unscaledValue().toLong())

        /** An amount as the server's text („12.50“); unreadable means no amount. */
        fun fromText(text: String?): Geld? = text?.trim()?.toBigDecimalOrNull()?.let { aus(it) }
    }
}

fun Double?.asMoney(): Geld? = this?.let { Geld.aus(it) }

/** For required fields: what is not a finite number counts as null instead of discarding the whole response. */
fun Double.asMoneyRequired(): Geld = Geld.aus(this) ?: Geld.NULL
