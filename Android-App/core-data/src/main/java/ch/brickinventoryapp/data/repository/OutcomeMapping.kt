package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.outcome.Outcome

/** Transform the data of a success; state and buffer stay, an error stays the same. */
internal inline fun <T, R> Outcome<T>.mapData(f: (T) -> R): Outcome<R> = when (this) {
    is Outcome.Success -> Outcome.Success(f(data), state, buffered)
    is Outcome.Failure -> this
}
