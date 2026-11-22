package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.model.coroutines.ApplicationScope
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import javax.inject.Inject
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
internal object CoroutinesModule {
    @Provides
    @Dispatcher(BrickDispatchers.IO)
    fun io(): CoroutineDispatcher = Dispatchers.IO

    @Provides
    @Dispatcher(BrickDispatchers.Default)
    fun compute(): CoroutineDispatcher = Dispatchers.Default

    @Provides
    @Dispatcher(BrickDispatchers.Main)
    fun main(): CoroutineDispatcher = Dispatchers.Main

    // SupervisorJob: a failed job does not drag the others down.
    @Provides
    @Singleton
    @ApplicationScope
    fun applicationArea(@Dispatcher(BrickDispatchers.IO) io: CoroutineDispatcher): CoroutineScope =
        CoroutineScope(SupervisorJob() + io)
}

/**
 * For classes that Android creates itself (Application, services) and that are therefore
 * supplied via a field instead of a constructor: a type without a qualifier.
 */
class Scopes @Inject constructor(
    @param:ApplicationScope val application: CoroutineScope,
    @param:Dispatcher(BrickDispatchers.IO) val io: CoroutineDispatcher,
    @param:Dispatcher(BrickDispatchers.Main) val main: CoroutineDispatcher,
)
