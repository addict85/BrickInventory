package ch.brickinventoryapp.model.koroutinen

import javax.inject.Qualifier

// Hier statt in core-data: Ein Bereich fragt nach einem Dispatcher, ohne dafür die
// Datenschicht und ihre Hilt-Module zu sehen. Gebunden wird in core-data (KoroutinenModule).

/** Welcher Ausführungsort gemeint ist. */
enum class BrickDispatchers { IO, Default, Main }

/**
 * Wer einen Dispatcher braucht, bekommt ihn hierüber statt fest verdrahtet: Ein
 * Test gibt einen StandardTestDispatcher und steuert die Zeit mit runTest.
 */
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
annotation class Dispatcher(val wert: BrickDispatchers)

/**
 * Arbeit, die den Bildschirm überleben soll (Startaufräumen, Tokentausch,
 * DataStore-Spiegel): ein Bereich für die ganze App statt vieler ungebundener.
 */
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
annotation class ApplicationScope
