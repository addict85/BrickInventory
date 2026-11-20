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

/** Texte, Dateizugriff und Filterablage der geteilten Präsentationsschicht. */
@Module
@InstallIn(SingletonComponent::class)
object StateModule {

    // Die herausgelösten ViewModels sehen Texte nur über diese Schnittstelle
    // (Dateien über FileReader aus core-data) — so laufen sie im JVM-Test ohne Context.
    @Provides
    fun provideTexts(t: AppTexte): Texte = t

    @Provides
    fun provideAbmeldevorgang(a: Abmelden): Abmeldevorgang = a

    @Provides
    fun provideWarmUp(v: CollectionWarmUp): WarmUp = v

    @Provides
    fun provideFilterStore(a: ScopeFilterStore): FilterStore = a

    // Die ViewModels sehen nur Schnittstellen, damit Tests sie ohne Hilt ersetzen; die Umsetzungen sind Singletons.
    @Provides fun provideScope(b: ScopeService): Scope = b
    // Die Sitzung (core-session) lädt nach der Anmeldung über diese Schritte des Blickfelds.
    @Provides fun provideFilterquelle(b: ScopeService): Filterquelle = b
    @Provides fun provideAusgangsmelder(a: InitialObserver): Ausgangsmelder = a
    // Ein Merker für alle Reiter: Ein zweiter hätte die Stellen des ersten nicht.
    @Provides @Singleton fun provideScrollMemory(): ScrollMemory = ScrollStorage()
    @Provides fun provideMessages(m: AppMessages): Meldungen = m
    @Provides fun provideFilterwahl(f: AreaFilter): Filterwahl = f
}
