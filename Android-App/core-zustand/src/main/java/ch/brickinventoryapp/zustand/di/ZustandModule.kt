package ch.brickinventoryapp.zustand.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton
import ch.brickinventoryapp.zustand.ui.Abmelden
import ch.brickinventoryapp.zustand.ui.FilterAblage
import ch.brickinventoryapp.zustand.ui.SammlungVorwaermen
import ch.brickinventoryapp.zustand.ui.ScopeFilterAblage
import ch.brickinventoryapp.zustand.ui.viewmodel.AppDateiLeser
import ch.brickinventoryapp.zustand.ui.viewmodel.AppTexte
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.zustand.ui.viewmodel.Texte
import ch.brickinventoryapp.zustand.ui.Abmeldevorgang
import ch.brickinventoryapp.zustand.ui.Vorwaermung
import ch.brickinventoryapp.zustand.ui.AusgangsBeobachter
import ch.brickinventoryapp.zustand.ui.Ausgangsmelder
import ch.brickinventoryapp.zustand.ui.AblageKontowerte
import ch.brickinventoryapp.zustand.ui.Kontowerte
import ch.brickinventoryapp.zustand.ui.Blickfeld
import ch.brickinventoryapp.zustand.ui.BlickfeldDienst
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.model.ui.ScrollSpeicher
import ch.brickinventoryapp.zustand.ui.Sitzung
import ch.brickinventoryapp.zustand.ui.SitzungsDienst
import ch.brickinventoryapp.zustand.ui.SitzungsRepository
import ch.brickinventoryapp.zustand.ui.SitzungsZustand
import ch.brickinventoryapp.zustand.ui.viewmodel.AppMeldungen
import ch.brickinventoryapp.zustand.ui.viewmodel.BereichsFilter
import ch.brickinventoryapp.zustand.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen

/** Texte, Dateizugriff und Filterablage der geteilten Präsentationsschicht. */
@Module
@InstallIn(SingletonComponent::class)
object ZustandModule {

    // Die herausgelösten ViewModels sehen Texte und Dateien nur über diese
    // Schnittstellen — so laufen sie im JVM-Test ohne Context.
    @Provides
    fun provideTexte(t: AppTexte): Texte = t

    @Provides
    fun provideDateiLeser(l: AppDateiLeser): DateiLeser = l

    @Provides
    fun provideAbmeldevorgang(a: Abmelden): Abmeldevorgang = a

    @Provides
    fun provideVorwaermung(v: SammlungVorwaermen): Vorwaermung = v

    @Provides
    fun provideFilterAblage(a: ScopeFilterAblage): FilterAblage = a

    // Die ViewModels sehen nur Schnittstellen (M4); die Umsetzungen sind Singletons.
    @Provides fun provideSitzung(s: SitzungsZustand): Sitzung = s
    @Provides fun provideSitzungsRepository(d: SitzungsDienst): SitzungsRepository = d
    @Provides fun provideBlickfeld(b: BlickfeldDienst): Blickfeld = b
    @Provides fun provideKontowerte(k: AblageKontowerte): Kontowerte = k
    @Provides fun provideAusgangsmelder(a: AusgangsBeobachter): Ausgangsmelder = a
    // Ein Merker für alle Reiter: Ein zweiter hätte die Stellen des ersten nicht.
    @Provides @Singleton fun provideScrollMemory(): ScrollMemory = ScrollSpeicher()
    @Provides fun provideMeldungen(m: AppMeldungen): Meldungen = m
    @Provides fun provideFilterwahl(f: BereichsFilter): Filterwahl = f
}
