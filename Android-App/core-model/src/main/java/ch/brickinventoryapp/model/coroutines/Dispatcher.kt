package ch.brickinventoryapp.model.coroutines

import javax.inject.Qualifier

// Here instead of in core-data: an area asks for a dispatcher without seeing the
// data layer and its Hilt modules for it. Bound in core-data (KoroutinenModule).

/** Which place of execution is meant. */
enum class BrickDispatchers { IO, Default, Main }

/**
 * Whoever needs a dispatcher gets it through this instead of hard-wired: a
 * test passes a StandardTestDispatcher and controls time with runTest.
 */
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
annotation class Dispatcher(val wert: BrickDispatchers)

/**
 * Work that shall outlive the screen (startup cleanup, token swap,
 * DataStore mirror): one scope for the whole app instead of many unbound ones.
 */
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
annotation class ApplicationScope
