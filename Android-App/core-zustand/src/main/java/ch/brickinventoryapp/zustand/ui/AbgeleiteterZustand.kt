package ch.brickinventoryapp.zustand.ui

import kotlinx.coroutines.ExperimentalForInheritanceCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/**
 * Ein Zustand, der nur aus anderen Zuständen gerechnet wird. Ohne stateIn läuft dafür
 * keine eigene Koroutine, und `value` ist auch ohne Sammler aktuell — Eagerly hielte
 * den Fluss sonst für die ganze Lebensdauer des ViewModels wach.
 */
@OptIn(ExperimentalForInheritanceCoroutinesApi::class)
fun <A, B, R> StateFlow<A>.abgeleitet(b: StateFlow<B>, rechne: (A, B) -> R): StateFlow<R> {
    val a = this
    return object : StateFlow<R> {
        override val value: R get() = rechne(a.value, b.value)
        override val replayCache: List<R> get() = listOf(value)
        override suspend fun collect(collector: FlowCollector<R>): Nothing {
            combine(a, b, rechne).distinctUntilChanged().collect(collector)
            awaitCancellation()
        }
    }
}

/** Dasselbe für einen einzelnen Zustand. */
@OptIn(ExperimentalForInheritanceCoroutinesApi::class)
fun <A, R> StateFlow<A>.abgeleitet(rechne: (A) -> R): StateFlow<R> {
    val a = this
    return object : StateFlow<R> {
        override val value: R get() = rechne(a.value)
        override val replayCache: List<R> get() = listOf(value)
        override suspend fun collect(collector: FlowCollector<R>): Nothing {
            a.map(rechne).distinctUntilChanged().collect(collector)
            awaitCancellation()
        }
    }
}
