package ch.brickinventoryapp.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Inject
import javax.inject.Qualifier
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** Welcher Ausführungsort gemeint ist; die Bindung an `Dispatchers` steht nur hier. */
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

@Module
@InstallIn(SingletonComponent::class)
object KoroutinenModule {
    @Provides
    @Dispatcher(BrickDispatchers.IO)
    fun io(): CoroutineDispatcher = Dispatchers.IO

    @Provides
    @Dispatcher(BrickDispatchers.Default)
    fun rechnen(): CoroutineDispatcher = Dispatchers.Default

    @Provides
    @Dispatcher(BrickDispatchers.Main)
    fun haupt(): CoroutineDispatcher = Dispatchers.Main

    // SupervisorJob: Ein gescheiterter Auftrag reisst die anderen nicht mit.
    @Provides
    @Singleton
    @ApplicationScope
    fun anwendungsBereich(@Dispatcher(BrickDispatchers.IO) io: CoroutineDispatcher): CoroutineScope =
        CoroutineScope(SupervisorJob() + io)
}

/**
 * Für Klassen, die Android selbst anlegt (Application, Dienste) und die darum
 * per Feld statt per Konstruktor beliefert werden: ein Typ ohne Qualifier.
 */
class Anwendungsbereiche @Inject constructor(
    @param:ApplicationScope val anwendung: CoroutineScope,
    @param:Dispatcher(BrickDispatchers.IO) val io: CoroutineDispatcher,
    @param:Dispatcher(BrickDispatchers.Main) val haupt: CoroutineDispatcher,
)
