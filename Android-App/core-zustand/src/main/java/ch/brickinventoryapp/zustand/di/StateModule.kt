package ch.brickinventoryapp.zustand.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton
import ch.brickinventoryapp.zustand.ui.Abmelden
import ch.brickinventoryapp.zustand.ui.FilterStore
import ch.brickinventoryapp.zustand.ui.CollectionWarmUp
import ch.brickinventoryapp.zustand.ui.ScopeFilterStore
import ch.brickinventoryapp.zustand.ui.viewmodel.AppTexte
import ch.brickinventoryapp.zustand.ui.viewmodel.Texte
import ch.brickinventoryapp.sitzung.Abmeldevorgang
import ch.brickinventoryapp.sitzung.WarmUp
import ch.brickinventoryapp.sitzung.Filterquelle
import ch.brickinventoryapp.zustand.ui.InitialObserver
import ch.brickinventoryapp.zustand.ui.Ausgangsmelder
import ch.brickinventoryapp.zustand.ui.Scope
import ch.brickinventoryapp.zustand.ui.ScopeService
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.model.ui.ScrollStorage
import ch.brickinventoryapp.zustand.ui.viewmodel.AppMessages
import ch.brickinventoryapp.zustand.ui.viewmodel.AreaFilter
import ch.brickinventoryapp.zustand.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen

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
    // Die Sitzung (core-sitzung) lädt nach der Anmeldung über diese Schritte des Blickfelds.
    @Provides fun provideFilterquelle(b: ScopeService): Filterquelle = b
    @Provides fun provideAusgangsmelder(a: InitialObserver): Ausgangsmelder = a
    // Ein Merker für alle Reiter: Ein zweiter hätte die Stellen des ersten nicht.
    @Provides @Singleton fun provideScrollMemory(): ScrollMemory = ScrollStorage()
    @Provides fun provideMessages(m: AppMessages): Meldungen = m
    @Provides fun provideFilterwahl(f: AreaFilter): Filterwahl = f
}
