package ch.brickinventoryapp.state.di

import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.model.ui.ScrollStorage
import ch.brickinventoryapp.session.FilterSource
import ch.brickinventoryapp.session.LogoutProcess
import ch.brickinventoryapp.session.WarmUp
import ch.brickinventoryapp.state.ui.CollectionWarmUp
import ch.brickinventoryapp.state.ui.FilterStore
import ch.brickinventoryapp.state.ui.InitialObserver
import ch.brickinventoryapp.state.ui.Logout
import ch.brickinventoryapp.state.ui.OutboxNotifier
import ch.brickinventoryapp.state.ui.Scope
import ch.brickinventoryapp.state.ui.ScopeFilterStore
import ch.brickinventoryapp.state.ui.ScopeService
import ch.brickinventoryapp.state.ui.viewmodel.AppMessages
import ch.brickinventoryapp.state.ui.viewmodel.AppTexts
import ch.brickinventoryapp.state.ui.viewmodel.AreaFilter
import ch.brickinventoryapp.state.ui.viewmodel.FilterChoice
import ch.brickinventoryapp.state.ui.viewmodel.Messages
import ch.brickinventoryapp.state.ui.viewmodel.Texts
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/** Texts, file access and filter store of the shared presentation layer. */
@Module
@InstallIn(SingletonComponent::class)
object StateModule {

    // The extracted ViewModels only see texts via this interface
    // (files via FileReader from core-data) — this way they run in the JVM test without a context.
    @Provides
    fun provideTexts(t: AppTexts): Texts = t

    @Provides
    fun provideLogoutProcess(a: Logout): LogoutProcess = a

    @Provides
    fun provideWarmUp(v: CollectionWarmUp): WarmUp = v

    @Provides
    fun provideFilterStore(a: ScopeFilterStore): FilterStore = a

    // The ViewModels only see interfaces, so tests can swap them out without Hilt; the implementations are singletons.
    @Provides fun provideScope(b: ScopeService): Scope = b
    // The session (core-session) loads after sign-in via these steps of the Blickfeld.
    @Provides fun provideFilterSource(b: ScopeService): FilterSource = b
    @Provides fun provideOutboxNotifier(a: InitialObserver): OutboxNotifier = a
    // One holder for all tabs: a second one wouldn't have the first one's positions.
    @Provides @Singleton fun provideScrollMemory(): ScrollMemory = ScrollStorage()
    @Provides fun provideMessages(m: AppMessages): Messages = m
    @Provides fun provideFilterChoice(f: AreaFilter): FilterChoice = f
}
