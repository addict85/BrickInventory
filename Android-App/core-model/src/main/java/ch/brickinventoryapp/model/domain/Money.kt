package ch.brickinventoryapp.model.domain

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * An amount in ten-thousandths, as the server holds it (NUMERIC(12,4), Web-App/src/infra/geld.ts):
 * integral, so that totals and comparisons do not hang on binary fractions. The currency stands on account
 * or response, not on every amount; a field next to it carries it where the server names it.
 */
@JvmInline
value class Money(val tenThousandths: Long) : Comparable<Money> {
    operator fun plus(other: Money) = Money(tenThousandths + other.tenThousandths)
    operator fun minus(other: Money) = Money(tenThousandths - other.tenThousandths)
    operator fun times(quantity: Int) = Money(tenThousandths * quantity)

    val positive: Boolean get() = tenThousandths > 0

    override fun compareTo(other: Money) = tenThousandths.compareTo(other.tenThousandths)

    fun asBigDecimal(): BigDecimal = BigDecimal.valueOf(tenThousandths, PLACES)

    /** To centimes, halves away from zero like the server's aufRappen(). */
    fun onRappen(): BigDecimal = asBigDecimal().setScale(2, RoundingMode.HALF_UP)

    /** For the wire format and for chart heights; calculation uses [tenThousandths]. */
    fun asDouble(): Double = tenThousandths / FACTOR.toDouble()

    override fun toString(): String = asBigDecimal().toPlainString()

    companion object {
        private const val PLACES = 4
        private const val FACTOR = 10_000L
        val NULL = Money(0)

        /** Like the server's inZehntel4(); what is not a finite number is not an amount. */
        fun from(amount: Double): Money? = if (amount.isFinite()) Money(Math.round(amount * FACTOR)) else null

        fun from(amount: BigDecimal): Money = Money(amount.setScale(PLACES, RoundingMode.HALF_UP).unscaledValue().toLong())

        /** An amount as the server's text („12.50“); unreadable means no amount. */
        fun fromText(text: String?): Money? = text?.trim()?.toBigDecimalOrNull()?.let { from(it) }
    }
}

fun Double?.asMoney(): Money? = this?.let { Money.from(it) }

/** For required fields: what is not a finite number counts as null instead of discarding the whole response. */
fun Double.asMoneyRequired(): Money = Money.from(this) ?: Money.NULL
