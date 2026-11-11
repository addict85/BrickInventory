package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.model.koroutinen.ApplicationScope
import ch.brickinventoryapp.model.koroutinen.Dispatcher
import ch.brickinventoryapp.model.koroutinen.BrickDispatchers
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

@Module
@InstallIn(SingletonComponent::class)
internal object KoroutinenModule {
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
