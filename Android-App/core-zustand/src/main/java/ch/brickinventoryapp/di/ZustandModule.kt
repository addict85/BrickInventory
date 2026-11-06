package ch.brickinventoryapp.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import ch.brickinventoryapp.ui.Abmelden
import ch.brickinventoryapp.ui.FilterAblage
import ch.brickinventoryapp.ui.SammlungVorwaermen
import ch.brickinventoryapp.ui.ScopeFilterAblage
import ch.brickinventoryapp.ui.viewmodel.AppDateiLeser
import ch.brickinventoryapp.ui.viewmodel.AppTexte
import ch.brickinventoryapp.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.ui.viewmodel.Texte
import ch.brickinventoryapp.ui.Abmeldevorgang
import ch.brickinventoryapp.ui.Vorwaermung
import ch.brickinventoryapp.ui.AusgangsBeobachter
import ch.brickinventoryapp.ui.Ausgangsmelder
import ch.brickinventoryapp.ui.BestandsVerteiler
import ch.brickinventoryapp.ui.Bestandssignal
import ch.brickinventoryapp.ui.Blickfeld
import ch.brickinventoryapp.ui.BlickfeldDienst
import ch.brickinventoryapp.ui.ScrollMemory
import ch.brickinventoryapp.ui.ScrollSpeicher
import ch.brickinventoryapp.ui.Sitzung
import ch.brickinventoryapp.ui.SitzungsDienst
import ch.brickinventoryapp.ui.SitzungsRepository
import ch.brickinventoryapp.ui.SitzungsZustand
import ch.brickinventoryapp.ui.viewmodel.AppMeldungen
import ch.brickinventoryapp.ui.viewmodel.BereichsFilter
import ch.brickinventoryapp.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.ui.viewmodel.Meldungen

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
    @Provides fun provideBestandssignal(b: BestandsVerteiler): Bestandssignal = b
    @Provides fun provideAusgangsmelder(a: AusgangsBeobachter): Ausgangsmelder = a
    @Provides fun provideScrollMemory(s: ScrollSpeicher): ScrollMemory = s
    @Provides fun provideMeldungen(m: AppMeldungen): Meldungen = m
    @Provides fun provideFilterwahl(f: BereichsFilter): Filterwahl = f
}
