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
}
