package ch.brickinventoryapp.session

import kotlinx.coroutines.ExperimentalForInheritanceCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/**
 * A state computed only from other states. Without stateIn no separate coroutine
 * runs for it, and `value` is up to date even without a collector — Eagerly would otherwise keep
 * the flow alive for the whole lifetime of the ViewModel.
 */
@OptIn(ExperimentalForInheritanceCoroutinesApi::class)
fun <A, B, R> StateFlow<A>.derived(b: StateFlow<B>, compute: (A, B) -> R): StateFlow<R> {
    val a = this
    return object : StateFlow<R> {
        override val value: R get() = compute(a.value, b.value)
        override val replayCache: List<R> get() = listOf(value)
        override suspend fun collect(collector: FlowCollector<R>): Nothing {
            combine(a, b, compute).distinctUntilChanged().collect(collector)
            awaitCancellation()
        }
    }
}

/** The same for a single state. */
@OptIn(ExperimentalForInheritanceCoroutinesApi::class)
fun <A, R> StateFlow<A>.derived(compute: (A) -> R): StateFlow<R> {
    val a = this
    return object : StateFlow<R> {
        override val value: R get() = compute(a.value)
        override val replayCache: List<R> get() = listOf(value)
        override suspend fun collect(collector: FlowCollector<R>): Nothing {
            a.map(compute).distinctUntilChanged().collect(collector)
            awaitCancellation()
        }
    }
}
