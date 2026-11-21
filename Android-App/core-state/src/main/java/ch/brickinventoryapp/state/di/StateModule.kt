package ch.brickinventoryapp.state.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton
import ch.brickinventoryapp.state.ui.Abmelden
import ch.brickinventoryapp.state.ui.FilterStore
import ch.brickinventoryapp.state.ui.CollectionWarmUp
import ch.brickinventoryapp.state.ui.ScopeFilterStore
import ch.brickinventoryapp.state.ui.viewmodel.AppTexte
import ch.brickinventoryapp.state.ui.viewmodel.Texte
import ch.brickinventoryapp.session.Abmeldevorgang
import ch.brickinventoryapp.session.WarmUp
import ch.brickinventoryapp.session.Filterquelle
import ch.brickinventoryapp.state.ui.InitialObserver
import ch.brickinventoryapp.state.ui.Ausgangsmelder
import ch.brickinventoryapp.state.ui.Scope
import ch.brickinventoryapp.state.ui.ScopeService
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.model.ui.ScrollStorage
import ch.brickinventoryapp.state.ui.viewmodel.AppMessages
import ch.brickinventoryapp.state.ui.viewmodel.AreaFilter
import ch.brickinventoryapp.state.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.state.ui.viewmodel.Meldungen

/** Texts, file access and filter store of the shared presentation layer. */
@Module
@InstallIn(SingletonComponent::class)
object StateModule {

    // The extracted ViewModels only see texts via this interface
    // (files via FileReader from core-data) — this way they run in the JVM test without a context.
    @Provides
    fun provideTexts(t: AppTexte): Texte = t

    @Provides
    fun provideAbmeldevorgang(a: Abmelden): Abmeldevorgang = a

    @Provides
    fun provideWarmUp(v: CollectionWarmUp): WarmUp = v

    @Provides
    fun provideFilterStore(a: ScopeFilterStore): FilterStore = a

    // The ViewModels only see interfaces, so tests can swap them out without Hilt; the implementations are singletons.
    @Provides fun provideScope(b: ScopeService): Scope = b
    // The session (core-session) loads after sign-in via these steps of the Blickfeld.
    @Provides fun provideFilterquelle(b: ScopeService): Filterquelle = b
    @Provides fun provideAusgangsmelder(a: InitialObserver): Ausgangsmelder = a
    // One holder for all tabs: a second one wouldn't have the first one's positions.
    @Provides @Singleton fun provideScrollMemory(): ScrollMemory = ScrollStorage()
    @Provides fun provideMessages(m: AppMessages): Meldungen = m
    @Provides fun provideFilterwahl(f: AreaFilter): Filterwahl = f
}
